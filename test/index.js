import BIP32Creator from '../src/esm/index.js'
import tape from 'tape'
import fixtures from './fixtures/index.json' assert { type: "json" }
const { valid, invalid } = fixtures 
import * as ecc from "tiny-secp256k1";
import * as tools from "uint8array-tools";
const BIP32 = BIP32Creator(ecc)
let LITECOIN = {
  wif: 0xb0,
  bip32: {
    public: 0x019da462,
    private: 0x019d9cfe
  }
}

// TODO: amend the JSON
let validAll = []
  valid.forEach((f) => {
  f.master.network = f.network
  f.master.children = f.children
  f.master.comment = f.comment
  f.children.forEach((fc) => {
    fc.network = f.network
    validAll.push(fc)
  })
  delete f.children
  validAll.push(f.master)
})

function verify (t, hd, prv, f, network) {
  t.equal(tools.toHex(hd.chainCode), f.chainCode)
  t.equal(hd.depth, f.depth >>> 0)
  t.equal(hd.index, f.index >>> 0)
  t.equal(hd.compressed, true)
  t.equal(tools.toHex(hd.fingerprint), f.fingerprint)
  t.equal(tools.toHex(hd.identifier), f.identifier)
  t.equal(tools.toHex(hd.publicKey), f.pubKey)
  if (prv) t.equal(hd.toBase58(), f.base58Priv)
  if (prv) t.equal(tools.toHex(hd.privateKey), f.privKey)
  if (prv) t.equal(hd.toWIF(), f.wif)
  if (!prv) t.throws(() => hd.toWIF(), /Missing private key/)
  if (!prv) t.equal(hd.privateKey, undefined)
  t.equal(hd.neutered().toBase58(), f.base58)
  t.equal(hd.isNeutered(), !prv)

  if (!f.children) return
  if (!prv && f.children.some(x => x.hardened)) return

  // test deriving path from master
  f.children.forEach((cf) => {
    let chd = hd.derivePath(cf.path)
    verify(t, chd, prv, cf, network)

    let chdNoM = hd.derivePath(cf.path.slice(2)) // no m/
    verify(t, chdNoM, prv, cf, network)
  })

  // test deriving path from successive children
  let shd = hd
  f.children.forEach((cf) => {
    if (cf.m === undefined) return
    if (cf.hardened) {
      shd = shd.deriveHardened(cf.m)
    } else {
      // verify any publicly derived children
      if (cf.base58) verify(t, shd.neutered().derive(cf.m), false, cf, network)

      shd = shd.derive(cf.m)
      verify(t, shd, prv, cf, network)
    }

    t.throws(() => {
      shd.derivePath('m/0')
    }, /Expected master, got child/)

    verify(t, shd, prv, cf, network)
  })
}

validAll.forEach((ff) => {
  tape(ff.comment || ff.base58Priv, (t) => {
    let network
    if (ff.network === 'litecoin') network = LITECOIN

    let hd = BIP32.fromBase58(ff.base58Priv, network)
    verify(t, hd, true, ff, network)

    hd = BIP32.fromBase58(ff.base58, network)
    verify(t, hd, false, ff, network)

    if (ff.seed) {
      let seed = Buffer.from(ff.seed, 'hex')
      hd = BIP32.fromSeed(seed, network)
      verify(t, hd, true, ff, network)
    }

    t.end()
  })
})

tape('invalid ecc library throws', (t) => {
  t.throws(() => {
    BIP32Creator({ isPoint: () => false })
  }, /ecc library invalid/)
  // Run with no schnorr and check it doesn't throw
  BIP32Creator({ ...ecc, signSchnorr: null, verifySchnorr: null })
  t.end()
})

tape('fromBase58 throws', (t) => {
  invalid.fromBase58.forEach((f) => {
    t.throws(() => {
      let network
      if (f.network === 'litecoin') network = LITECOIN

      BIP32.fromBase58(f.string, network)
    }, new RegExp(f.exception))
  })

  t.end()
})

tape('works for Private -> public (neutered)', (t) => {
  let f = valid[1]
  let c = f.master.children[0]

  let master = BIP32.fromBase58(f.master.base58Priv)
  let child = master.derive(c.m).neutered()

  t.plan(1)
  t.equal(child.toBase58(), c.base58)
})

tape('works for Private -> public (neutered, hardened)', (t) => {
  let f = valid[0]
  let c = f.master.children[0]

  let master = BIP32.fromBase58(f.master.base58Priv)
  let child = master.deriveHardened(c.m).neutered()

  t.plan(1)
  t.equal(c.base58, child.toBase58())
})

tape('works for Public -> public', (t) => {
  let f = valid[1]
  let c = f.master.children[0]

  let master = BIP32.fromBase58(f.master.base58)
  let child = master.derive(c.m)

  t.plan(2)
  t.equal(c.base58, child.toBase58())

  const hdNeutered = BIP32.fromPublicKey(Buffer.from(f.master.pubKey, 'hex'), Buffer.from(f.master.chainCode, 'hex'))
  t.equal(child.toBase58(), hdNeutered.derive(c.m).toBase58())
})

tape('throws on Public -> public (hardened)', (t) => {
  let f = valid[0]
  let c = f.master.children[0]

  let master = BIP32.fromBase58(f.master.base58)

  t.plan(1)
  t.throws(() => {
    master.deriveHardened(c.m)
  }, /Missing private key for hardened child key/)
})

tape('throws on wrong types', (t) => {
  let f = valid[0]
  let master = BIP32.fromBase58(f.master.base58)

  invalid.derive.forEach((fx) => {
    t.throws(() => {
      master.derive(fx.index)
    }, fx.exception)
  })

  invalid.deriveHardened.forEach((fx) => {
    t.throws(() => {
      master.deriveHardened(fx.index)
    }, fx.exception)
  })

  invalid.derivePath.forEach((fx) => {
    t.throws(() => {
      master.derivePath(fx.derivationPath)
    }, fx.exception)
  })

  let ZERO = Buffer.alloc(32, 0)
  let ONES = Buffer.alloc(32, 1)

  t.throws(() => {
    BIP32.fromPrivateKey(Buffer.alloc(2), ONES)
  }, /ValiError: Invalid length: Expected 32 but received 2/)

  t.throws(() => {
    BIP32.fromPrivateKey(ZERO, ONES)
  }, /Private key not in range \[1, n\)/)

  t.end()
})

tape('works when private key has leading zeros', (t) => {
  let key = 'xprv9s21ZrQH143K3ckY9DgU79uMTJkQRLdbCCVDh81SnxTgPzLLGax6uHeBULTtaEtcAvKjXfT7ZWtHzKjTpujMkUd9dDb8msDeAfnJxrgAYhr'
  let hdkey = BIP32.fromBase58(key)

  t.plan(2)
  t.equal(tools.toHex(hdkey.privateKey), '00000055378cf5fafb56c711c674143f9b0ee82ab0ba2924f19b64f5ae7cdbfd')
  let child = hdkey.derivePath('m/44\'/0\'/0\'/0/0\'')
  t.equal(tools.toHex(child.privateKey), '3348069561d2a0fb925e74bf198762acc47dce7db27372257d2d959a9e6f8aeb')
})

tape('fromSeed', (t) => {
  // TODO
//    'throws if IL is not within interval [1, n - 1] | IL === n || IL === 0'
  invalid.fromSeed.forEach((f) => {
    t.throws(() => {
      BIP32.fromSeed(Buffer.from(f.seed, 'hex'))
    }, new RegExp(f.exception))
  })

  t.end()
})

tape('ecdsa', (t) => {
  let seed = Buffer.alloc(32, 1)
  let hash = Buffer.alloc(32, 2)
  let signature = Buffer.from('9636ee2fac31b795a308856b821ebe297dda7b28220fb46ea1fbbd7285977cc04c82b734956246a0f15a9698f03f546d8d96fe006c8e7bd2256ca7c8229e6f5c', 'hex')
  let schnorrsig = Buffer.from('2fae8b517cb0e7302ca48a4109d1819e3d75af96bd58d297023e3058c4e98ff812fe6ae32a2b2bc4abab10f88f7fe56efbafc8a4e4fa437af78926f528b0585e', 'hex')
  let signatureLowR = Buffer.from('0587a40b391b76596c257bf59565b24eaff2cc42b45caa2640902e73fb97a6e702c3402ab89348a7dae1bf171c3e172fa60353d7b01621a94cb7caca59b995db', 'hex')
  let node = BIP32.fromSeed(seed)

  t.plan(11)
  t.equal(tools.toHex(node.sign(hash)), tools.toHex(signature))
  t.equal(tools.toHex(node.sign(hash, true)), tools.toHex(signatureLowR))
  t.equal(tools.toHex(node.signSchnorr(hash)), tools.toHex(schnorrsig))
  t.equal(node.verify(hash, signature), true)
  t.equal(node.verify(seed, signature), false)
  t.equal(node.verify(hash, signatureLowR), true)
  t.equal(node.verify(seed, signatureLowR), false)
  t.equal(node.verifySchnorr(hash, schnorrsig), true)
  t.equal(node.verifySchnorr(seed, schnorrsig), false)

  const neuteredNode = node.neutered()
  t.throws(() => neuteredNode.sign(hash), /Missing private key/)
  t.throws(() => neuteredNode.signSchnorr(hash), /Missing private key/)
})

tape('ecdsa - no schnorr', (t) => {
  let seed = Buffer.alloc(32, 1)
  let hash = Buffer.alloc(32, 2)
  const tweak = Buffer.alloc(32, 3)

  const bip32NoSchnorr = BIP32Creator({ ...ecc, signSchnorr: null, verifySchnorr: null })
  const node = bip32NoSchnorr.fromSeed(seed)

  t.plan(5)
  t.throws(() => node.signSchnorr(hash), /signSchnorr not supported by ecc library/)
  t.throws(() => node.verifySchnorr(hash), /verifySchnorr not supported by ecc library/)

  const tweakedNode = node.tweak(tweak)
  t.throws(() => tweakedNode.signSchnorr(hash), /signSchnorr not supported by ecc library/)
  t.throws(() => tweakedNode.verifySchnorr(hash), /verifySchnorr not supported by ecc library/)

  const signer = node.neutered().tweak(tweak)
  t.throws(() => signer.verifySchnorr(hash), /verifySchnorr not supported by ecc library/)
})

tape('ecc without tweak support', (t) => {
  let seed = Buffer.alloc(32, 1)
  const tweak = Buffer.alloc(32, 3)

  const bip32NoTweak = BIP32Creator({ ...ecc, xOnlyPointAddTweak: null, privateNegate: null })
  const node = bip32NoTweak.fromSeed(seed)
  const nodeWithoutPrivKey = bip32NoTweak.fromPublicKey(node.publicKey, node.chainCode)

  t.plan(2)
  t.throws(() => node.tweak(tweak), /privateNegate not supported by ecc library/)
  t.throws(() => nodeWithoutPrivKey.tweak(tweak), /xOnlyPointAddTweak not supported by ecc library/)
})

tape('tweak', (t) => {
  const seed = Buffer.alloc(32, 1)
  const hash = Buffer.alloc(32, 2)
  const tweak = Buffer.alloc(32, 3)
  const signature = Buffer.from('5a38c6652feb5166c9c91cfa5fa4a4c7cec27445d4619499df8afdd05ebc823246d644b0c7d3b960625393df537f900528ec4b14e6ddab8fd0c7e87c98cfe9d0', 'hex')
  const schnorrsig = Buffer.from('20506478d341d0ab1afd32671eb1550b1c5329ad5179a19712212b857f06b3210d949964cd513ff25719e2e9b0087d5a9745afd5d38641ce0dfa86f67c86de63', 'hex')
  const signatureLowR = Buffer.from('5a38c6652feb5166c9c91cfa5fa4a4c7cec27445d4619499df8afdd05ebc823246d644b0c7d3b960625393df537f900528ec4b14e6ddab8fd0c7e87c98cfe9d0', 'hex')
  const signer = BIP32.fromSeed(seed).tweak(tweak)

  t.plan(9)
  t.equal(tools.toHex(signer.sign(hash)), tools.toHex(signature))
  t.equal(tools.toHex(signer.sign(hash, true)), tools.toHex(signatureLowR))
  t.equal(tools.toHex(signer.signSchnorr(hash)), tools.toHex(schnorrsig))
  t.equal(signer.verify(hash, signature), true)
  t.equal(signer.verify(seed, signature), false)
  t.equal(signer.verify(hash, signatureLowR), true)
  t.equal(signer.verify(seed, signatureLowR), false)
  t.equal(signer.verifySchnorr(hash, schnorrsig), true)
  t.equal(signer.verifySchnorr(seed, schnorrsig), false)
})

tape('tweak - neutered', (t) => {
  const seed = Buffer.alloc(32, 1)
  const hash = Buffer.alloc(32, 2)
  const tweak = Buffer.alloc(32, 3)
  const signature = Buffer.from('5a38c6652feb5166c9c91cfa5fa4a4c7cec27445d4619499df8afdd05ebc823246d644b0c7d3b960625393df537f900528ec4b14e6ddab8fd0c7e87c98cfe9d0', 'hex')
  const schnorrsig = Buffer.from('20506478d341d0ab1afd32671eb1550b1c5329ad5179a19712212b857f06b3210d949964cd513ff25719e2e9b0087d5a9745afd5d38641ce0dfa86f67c86de63', 'hex')
  const signatureLowR = Buffer.from('5a38c6652feb5166c9c91cfa5fa4a4c7cec27445d4619499df8afdd05ebc823246d644b0c7d3b960625393df537f900528ec4b14e6ddab8fd0c7e87c98cfe9d0', 'hex')
  const signer = BIP32.fromSeed(seed).neutered().tweak(tweak)

  t.plan(8)
  t.throws(() => signer.sign(hash), /Missing private key/)
  t.throws(() => signer.signSchnorr(hash), /Missing private key/)
  
  t.equal(signer.verify(hash, signature), true)
  t.equal(signer.verify(seed, signature), false)
  t.equal(signer.verify(hash, signatureLowR), true)
  t.equal(signer.verify(seed, signatureLowR), false)
  t.equal(signer.verifySchnorr(hash, schnorrsig), true)
  t.equal(signer.verifySchnorr(seed, schnorrsig), false)
})

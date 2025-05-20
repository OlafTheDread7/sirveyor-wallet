const express = require('express');
const router = express.Router();
const bip39 = require('bip39');
const CardanoWasm = require('@emurgo/cardano-serialization-lib-nodejs');

router.get('/', async (req, res) => {
  try {
    const mnemonic = bip39.generateMnemonic();
    const entropy = await bip39.mnemonicToEntropy(mnemonic);
    const rootKey = CardanoWasm.Bip32PrivateKey.from_bip39_entropy(
      Buffer.from(entropy, 'hex'),
      Buffer.from('')
    );

    const accountKey = rootKey
      .derive(1852 | 0x80000000)
      .derive(1815 | 0x80000000)
      .derive(0 | 0x80000000);

    const utxoPubKey = accountKey.derive(0).derive(0).to_public();
    const stakePubKey = accountKey.derive(2).derive(0).to_public();

    const baseAddr = CardanoWasm.BaseAddress.new(
      0,  // Testnet = 0, Mainnet = 1
      CardanoWasm.Credential.from_keyhash(utxoPubKey.to_raw_key().hash()),
      CardanoWasm.Credential.from_keyhash(stakePubKey.to_raw_key().hash())
    );

    const address = baseAddr.to_address().to_bech32();
    res.json({ mnemonic, address });
  } catch (err) {
    console.error('❌ Wallet generation error:', err.message);
    res.status(500).json({ error: 'Failed to generate wallet' });
  }
});

module.exports = router;

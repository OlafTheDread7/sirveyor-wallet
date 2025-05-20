const express = require('express');
const router = express.Router();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bip39 = require('bip39');
const CardanoWasm = require('@emurgo/cardano-serialization-lib-nodejs');

const BLOCKFROST_API_KEY = 'preprodYwHmUmlUrkhyD48GAjMUUK6BKvL7gBmJ';
const BLOCKFROST_BASE_URL = 'https://cardano-preprod.blockfrost.io/api/v0';
const WALLET_DIR = path.join(__dirname, '..', 'wallets');

function decryptMnemonic(walletName, password) {
  const filePath = path.join(WALLET_DIR, `${walletName}.json`);
  if (!fs.existsSync(filePath)) return null;

  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const encrypted = Buffer.from(data.encrypted, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-ctr', crypto.createHash('sha256').update(password).digest(), Buffer.alloc(16, 0));
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}
router.post('/', async (req, res) => {
  const { walletName, password, recipient, amountLovelace } = req.body;
  if (!walletName || !password || !recipient || !amountLovelace) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  try {
    const mnemonic = decryptMnemonic(walletName, password);
    if (!mnemonic || !bip39.validateMnemonic(mnemonic)) {
      return res.status(400).json({ error: 'Invalid mnemonic' });
    }

    const entropy = bip39.mnemonicToEntropy(mnemonic);
    const rootKey = CardanoWasm.Bip32PrivateKey.from_bip39_entropy(
      Buffer.from(entropy, 'hex'),
      Buffer.from('')
    );

    const accountKey = rootKey
      .derive(1852 | 0x80000000)
      .derive(1815 | 0x80000000)
      .derive(0 | 0x80000000);

    const utxoKey = accountKey.derive(0).derive(0);
    const stakeKey = accountKey.derive(2).derive(0).to_public();

    const senderAddr = CardanoWasm.BaseAddress.new(
      0,
      CardanoWasm.Credential.from_keyhash(utxoKey.to_public().to_raw_key().hash()),
      CardanoWasm.Credential.from_keyhash(stakeKey.to_raw_key().hash())
    ).to_address().to_bech32();

    const utxosRes = await axios.get(`${BLOCKFROST_BASE_URL}/addresses/${senderAddr}/utxos`, {
      headers: { project_id: BLOCKFROST_API_KEY }
    });

    const inputs = utxosRes.data.map(utxo => ({
      txHash: utxo.tx_hash,
      outputIndex: utxo.output_index,
      amount: utxo.amount.find(a => a.unit === 'lovelace').quantity
    }));

    const totalInput = inputs.reduce((sum, i) => sum + parseInt(i.amount), 0);
    const fee = 200000;
    const change = totalInput - fee - parseInt(amountLovelace);

    if (change < 0) return res.status(400).json({ error: 'Insufficient balance' });

    const txBuilderCfg = CardanoWasm.TransactionBuilderConfigBuilder.new()
      .fee_algo(CardanoWasm.LinearFee.new(CardanoWasm.BigNum.from_str('44'), CardanoWasm.BigNum.from_str('155381')))
      .coins_per_utxo_byte(CardanoWasm.BigNum.from_str('4310'))
      .key_deposit(CardanoWasm.BigNum.from_str('2000000'))
      .pool_deposit(CardanoWasm.BigNum.from_str('500000000'))
      .max_value_size(5000)
      .max_tx_size(16384)
      .build();

    const txBuilder = CardanoWasm.TransactionBuilder.new(txBuilderCfg);

    inputs.forEach(input => {
      const txInput = CardanoWasm.TransactionInput.new(
        CardanoWasm.TransactionHash.from_bytes(Buffer.from(input.txHash, 'hex')),
        input.outputIndex
      );
      const inputVal = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(input.amount));
      txBuilder.add_key_input(
        utxoKey.to_public().to_raw_key().hash(),
        txInput,
        inputVal
      );
    });

    txBuilder.add_output(
      CardanoWasm.TransactionOutput.new(
        CardanoWasm.Address.from_bech32(recipient),
        CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(amountLovelace.toString()))
      )
    );

    txBuilder.add_output(
      CardanoWasm.TransactionOutput.new(
        CardanoWasm.Address.from_bech32(senderAddr),
        CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(change.toString()))
      )
    );

    const txBody = txBuilder.build();
    const txHash = CardanoWasm.hash_transaction(txBody);

    const witnesses = CardanoWasm.TransactionWitnessSet.new();
    const vkeyWitnesses = CardanoWasm.Vkeywitnesses.new();
    const vkeyWitness = CardanoWasm.make_vkey_witness(txHash, utxoKey.to_raw_key());
    vkeyWitnesses.add(vkeyWitness);
    witnesses.set_vkeys(vkeyWitnesses);

    const signedTx = CardanoWasm.Transaction.new(txBody, witnesses);
    const txHex = Buffer.from(signedTx.to_bytes()).toString('hex');

    const submitRes = await axios.post(`${BLOCKFROST_BASE_URL}/tx/submit`, Buffer.from(txHex, 'hex'), {
      headers: {
        'Content-Type': 'application/cbor',
        project_id: BLOCKFROST_API_KEY
      }
    });

    res.json({ txHash: submitRes.data });
  } catch (err) {
    console.error('Send ADA error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Transaction failed' });
  }
});

module.exports = router;

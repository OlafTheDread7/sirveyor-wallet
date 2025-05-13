require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const bip39 = require('bip39');
const CardanoWasm = require('@emurgo/cardano-serialization-lib-nodejs');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// 🔐 XOR encryption helpers
function xorEncrypt(text, password) {
  return Buffer.from(
    text.split('').map((char, i) =>
      String.fromCharCode(char.charCodeAt(0) ^ password.charCodeAt(i % password.length))
    ).join('')
  ).toString('base64');
}

function xorDecrypt(encoded, password) {
  const decoded = Buffer.from(encoded, 'base64').toString();
  return decoded.split('').map((char, i) =>
    String.fromCharCode(char.charCodeAt(0) ^ password.charCodeAt(i % password.length))
  ).join('');
}

// 🔐 Generate wallet
app.get('/generate-wallet', async (req, res) => {
  try {
    const mnemonic = bip39.generateMnemonic(256);
    const entropy = bip39.mnemonicToEntropy(mnemonic);
    const rootKey = CardanoWasm.Bip32PrivateKey.from_bip39_entropy(
      Buffer.from(entropy, 'hex'), Buffer.from('')
    );

    const accountKey = rootKey.derive(1852 | 0x80000000)
                              .derive(1815 | 0x80000000)
                              .derive(0 | 0x80000000);
    const utxoPubKey = accountKey.derive(0).derive(0).to_public();
    const stakePubKey = accountKey.derive(2).derive(0).to_public();

    const baseAddr = CardanoWasm.BaseAddress.new(
      CardanoWasm.NetworkInfo.mainnet().network_id(),
      CardanoWasm.Credential.from_keyhash(utxoPubKey.to_raw_key().hash()),
      CardanoWasm.Credential.from_keyhash(stakePubKey.to_raw_key().hash())
    );

    const walletAddress = baseAddr.to_address().to_bech32();
    res.json({ mnemonic, address: walletAddress });
  } catch (err) {
    console.error('❌ Wallet generation failed:', err);
    res.status(500).json({ error: 'Wallet generation failed' });
  }
});

// 💾 Save wallet
app.post('/save-wallet', (req, res) => {
  try {
    const { mnemonic, password, walletId } = req.body;
    if (!mnemonic || !password || !walletId) {
      return res.status(400).json({ error: 'mnemonic, password, and walletId are required' });
    }
    const encrypted = xorEncrypt(mnemonic, password);
    const filePath = path.join(__dirname, 'wallets', `${walletId}.json`);
    fs.writeFileSync(filePath, JSON.stringify({ encrypted }));
    res.json({ success: true, message: `Wallet saved as ${walletId}.json` });
  } catch (err) {
    console.error('❌ Save wallet failed:', err);
    res.status(500).json({ error: 'Failed to save wallet' });
  }
});

// 🔓 Decrypt wallet
app.post('/decrypt-wallet', (req, res) => {
  try {
    const { walletId, password } = req.body;
    if (!walletId || !password) {
      return res.status(400).json({ error: 'walletId and password are required' });
    }
    const filePath = path.join(__dirname, 'wallets', `${walletId}.json`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Wallet not found' });
    }
    const encryptedData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const mnemonic = xorDecrypt(encryptedData.encrypted, password);
    res.json({ mnemonic });
  } catch (err) {
    console.error('❌ Decrypt wallet failed:', err);
    res.status(500).json({ error: 'Failed to decrypt wallet' });
  }
});

// 💸 Send ADA (Live via Blockfrost)
app.post('/send-ada', async (req, res) => {
  try {
    const { walletId, password, recipient, amountAda } = req.body;
    if (!walletId || !password || !recipient || !amountAda) {
      return res.status(400).json({ error: 'walletId, password, recipient, and amountAda are required' });
    }

    const filePath = path.join(__dirname, 'wallets', `${walletId}.json`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Wallet not found' });
    }

    const { encrypted } = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const mnemonic = xorDecrypt(encrypted, password);
    const entropy = bip39.mnemonicToEntropy(mnemonic);
    const rootKey = CardanoWasm.Bip32PrivateKey.from_bip39_entropy(
      Buffer.from(entropy, 'hex'), Buffer.from('')
    );

    const accountKey = rootKey.derive(1852 | 0x80000000)
                              .derive(1815 | 0x80000000)
                              .derive(0 | 0x80000000);

    const utxoKey = accountKey.derive(0).derive(0);
    const utxoPubKey = utxoKey.to_public();
    const senderAddr = CardanoWasm.BaseAddress.new(
      CardanoWasm.NetworkInfo.mainnet().network_id(),
      CardanoWasm.Credential.from_keyhash(utxoPubKey.to_raw_key().hash()),
      CardanoWasm.Credential.from_keyhash(accountKey.derive(2).derive(0).to_public().to_raw_key().hash())
    ).to_address().to_bech32();

    // 🧠 Get UTXOs from Blockfrost
    const utxosRes = await axios.get(`https://cardano-mainnet.blockfrost.io/api/v0/addresses/${senderAddr}/utxos`, {
      headers: { project_id: process.env.BLOCKFROST_API_KEY }
    });

    if (utxosRes.data.length === 0) {
      return res.status(400).json({ error: 'No UTXOs found. Wallet might be empty.' });
    }

    const txBuilder = CardanoWasm.TransactionBuilder.new(
      CardanoWasm.TransactionBuilderConfigBuilder.new()
        .fee_algo(CardanoWasm.LinearFee.new(CardanoWasm.BigNum.from_str("44"), CardanoWasm.BigNum.from_str("155381")))
        .coins_per_utxo_word(CardanoWasm.BigNum.from_str("34482"))
        .key_deposit(CardanoWasm.BigNum.from_str("2000000"))
        .pool_deposit(CardanoWasm.BigNum.from_str("500000000"))
        .max_tx_size(16384)
        .max_value_size(5000)
        .prefer_pure_change(true)
        .build()
    );

    const lovelaceToSend = CardanoWasm.BigNum.from_str((parseFloat(amountAda) * 1_000_000).toFixed(0));
    const receiverAddr = CardanoWasm.Address.from_bech32(recipient);

    txBuilder.add_output(CardanoWasm.TransactionOutput.new(receiverAddr, CardanoWasm.Value.new(lovelaceToSend)));

    for (let utxo of utxosRes.data) {
      const input = CardanoWasm.TransactionInput.new(
        CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxo.tx_hash, 'hex')),
        utxo.output_index
      );
      const value = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(utxo.amount[0].quantity));
      txBuilder.add_input(utxoKey.to_public().to_raw_key().hash(), input, value);
    }

    txBuilder.add_change_if_needed(CardanoWasm.Address.from_bech32(senderAddr));
    const txBody = txBuilder.build();
    const witnessSet = CardanoWasm.TransactionWitnessSet.new();

    const txHash = CardanoWasm.hash_transaction(txBody);
    const vkeyWitnesses = CardanoWasm.Vkeywitnesses.new();
    const witness = CardanoWasm.make_vkey_witness(txHash, utxoKey.to_raw_key());
    vkeyWitnesses.add(witness);
    witnessSet.set_vkeys(vkeyWitnesses);

    const tx = CardanoWasm.Transaction.new(txBody, witnessSet);
    const cborHex = Buffer.from(tx.to_bytes()).toString('hex');

    const submitRes = await axios.post('https://cardano-mainnet.blockfrost.io/api/v0/tx/submit', Buffer.from(cborHex, 'hex'), {
      headers: {
        'Content-Type': 'application/cbor',
        project_id: process.env.BLOCKFROST_API_KEY
      }
    });

    res.json({ success: true, txHash: submitRes.data });
  } catch (err) {
    console.error('❌ ADA send failed:', err);
    res.status(500).json({ error: 'Failed to send ADA' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 SirVeyor Wallet backend running on port ${PORT}`);
});

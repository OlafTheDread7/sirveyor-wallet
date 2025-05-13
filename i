import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bip39 from 'bip39';
import * as CardanoWasm from '@emurgo/cardano-serialization-lib-nodejs';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/generate-wallet', async (req, res) => {
  try {
    const mnemonic = bip39.generateMnemonic(256);
    const entropy = bip39.mnemonicToEntropy(mnemonic);
    const rootKey = CardanoWasm.Bip32PrivateKey.from_bip39_entropy(
      Buffer.from(entropy, 'hex'),
      Buffer.from('')
    );

    const accountKey = rootKey
      .derive(1852 | 0x80000000)  // purpose
      .derive(1815 | 0x80000000)  // coin type (ADA)
      .derive(0 | 0x80000000);    // account #0

    const utxoPubKey = accountKey.derive(0).derive(0).to_public();
    const stakePubKey = accountKey.derive(2).derive(0).to_public();

    const baseAddr = CardanoWasm.BaseAddress.new(
      CardanoWasm.NetworkInfo.mainnet().network_id(),
      CardanoWasm.StakeCredential.from_keyhash(utxoPubKey.to_raw_key().hash()),
      CardanoWasm.StakeCredential.from_keyhash(stakePubKey.to_raw_key().hash())
    );

    const walletAddress = baseAddr.to_address().to_bech32();

    res.json({ mnemonic, address: walletAddress });
  } catch (err) {
    console.error('Wallet generation failed:', err);
    res.status(500).json({ error: 'Wallet generation failed' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 SirVeyor Wallet API running on port ${PORT}`);
});

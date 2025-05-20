const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WALLET_DIR = path.join(__dirname, '..', 'wallets');
if (!fs.existsSync(WALLET_DIR)) fs.mkdirSync(WALLET_DIR);

router.post('/', (req, res) => {
  const { walletName, mnemonic, password } = req.body;
  if (!walletName || !mnemonic || !password) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  try {
    const cipher = crypto.createCipher('aes-256-ctr', password);
    const encrypted = Buffer.concat([
      cipher.update(mnemonic, 'utf8'),
      cipher.final()
    ]);

    const filePath = path.join(WALLET_DIR, `${walletName}.json`);
    const walletData = {
      encrypted: encrypted.toString('hex'),
      created_at: new Date().toISOString()
    };

    fs.writeFileSync(filePath, JSON.stringify(walletData, null, 2));
    res.json({ success: true, message: `Wallet '${walletName}' saved.` });
  } catch (err) {
    console.error('Save wallet error:', err.message);
    res.status(500).json({ error: 'Failed to save wallet' });
  }
});

module.exports = router;

// routes/decryptWallet.js
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');

router.post('/', (req, res) => {
  const { walletName, password } = req.body;
  if (!walletName || !password) {
    return res.status(400).json({ error: 'Missing walletName or password' });
  }

  try {
    const row = db.prepare('SELECT encrypted FROM wallets WHERE id = ?').get(walletName);

    if (!row) {
      return res.status(404).json({ error: 'Wallet not found' });
    }

    const encrypted = Buffer.from(row.encrypted, 'hex');
    const decipher = crypto.createDecipher('aes-256-ctr', password);
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]).toString('utf8');

    res.json({ mnemonic: decrypted });
  } catch (err) {
    console.error('Decrypt wallet error:', err.message);
    res.status(500).json({ error: 'Failed to decrypt wallet' });
  }
});

module.exports = router;

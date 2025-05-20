const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const WALLET_DIR = path.join(__dirname, '..', 'wallets');

router.post('/', (req, res) => {
  const { oldName, newName } = req.body;
  if (!oldName || !newName) {
    return res.status(400).json({ error: 'Missing oldName or newName' });
  }

  const oldPath = path.join(WALLET_DIR, `${oldName}.json`);
  const newPath = path.join(WALLET_DIR, `${newName}.json`);

  try {
    if (!fs.existsSync(oldPath)) {
      return res.status(404).json({ error: `Wallet '${oldName}' not found` });
    }

    if (fs.existsSync(newPath)) {
      return res.status(409).json({ error: `Wallet '${newName}' already exists` });
    }

    fs.renameSync(oldPath, newPath);
    res.json({ success: true, message: `Wallet renamed from '${oldName}' to '${newName}'` });
  } catch (err) {
    console.error('Rename wallet error:', err.message);
    res.status(500).json({ error: 'Failed to rename wallet' });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const WALLET_DIR = path.join(__dirname, '..', 'wallets');

router.delete('/', (req, res) => {
  const { walletName } = req.body;
  if (!walletName) {
    return res.status(400).json({ error: 'Missing wallet name' });
  }

  try {
    const filePath = path.join(WALLET_DIR, `${walletName}.json`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Wallet not found' });
    }

    fs.unlinkSync(filePath);
    res.json({ success: true, message: `Wallet '${walletName}' deleted.` });
  } catch (err) {
    console.error('Delete wallet error:', err.message);
    res.status(500).json({ error: 'Failed to delete wallet' });
  }
});

module.exports = router;

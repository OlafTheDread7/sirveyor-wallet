const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const WALLET_DIR = path.join(__dirname, '..', 'wallets');

router.get('/', (req, res) => {
  try {
    if (!fs.existsSync(WALLET_DIR)) {
      return res.json({ wallets: [] });
    }

    const files = fs.readdirSync(WALLET_DIR);
    const wallets = files
      .filter(file => file.endsWith('.json'))
      .map(file => {
        const raw = fs.readFileSync(path.join(WALLET_DIR, file), 'utf8');
        const parsed = JSON.parse(raw);
        return {
          name: path.basename(file, '.json'),
          created_at: parsed.created_at || null
        };
      });

    res.json({ wallets });
  } catch (err) {
    console.error('List wallets error:', err.message);
    res.status(500).json({ error: 'Failed to list wallets' });
  }
});

module.exports = router;

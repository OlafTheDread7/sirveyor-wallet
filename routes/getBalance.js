const express = require('express');
const router = express.Router();
const axios = require('axios');

const BLOCKFROST_API_KEY = 'preprodYwHmUmlUrkhyD48GAjMUUK6BKvL7gBmJ';
const BLOCKFROST_BASE_URL = 'https://cardano-preprod.blockfrost.io/api/v0';

router.get('/', async (req, res) => {
  const { address } = req.query;
  if (!address) return res.status(400).json({ error: 'Missing address' });

  try {
    const response = await axios.get(`${BLOCKFROST_BASE_URL}/addresses/${address}`, {
      headers: { project_id: BLOCKFROST_API_KEY }
    });

    const amountArray = response.data.amount;
    const lovelaceObj = amountArray.find(a => a.unit === 'lovelace');
    const balance = lovelaceObj ? lovelaceObj.quantity : '0';

    res.json({ address, balance });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch balance' });
  }
});

module.exports = router;

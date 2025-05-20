// index.js
const express = require('express');
const cors = require('cors');

const generateWallet = require('./routes/generateWallet');
const getBalance = require('./routes/getBalance');
const saveWallet = require('./routes/saveWallet');
const sendAda = require('./routes/sendAda');
const decryptWallet = require('./routes/decryptWallet');
const listWallets = require('./routes/listWallets');
const deleteWallet = require('./routes/deleteWallet');
const renameWallet = require('./routes/renameWallet');

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

app.use('/generate-wallet', generateWallet);
app.use('/get-balance', getBalance);
app.use('/save-wallet', saveWallet);
app.use('/send-ada', sendAda);
app.use('/decrypt-wallet', decryptWallet);
app.use('/list-wallets', listWallets);
app.use('/delete-wallet', deleteWallet);
app.use('/rename-wallet', renameWallet);

app.listen(port, () => {
  console.log(`✅ Server running at http://localhost:${port}`);
});

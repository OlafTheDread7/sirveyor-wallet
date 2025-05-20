const express = require('express');
const router = express.Router();
const fs = require('fs').promises; // Use promises for cleaner async/await
const path = require('path');
const crypto = require('crypto');
const bip39 = require('bip39');
const axios = require('axios');
const CardanoWasm = require('@emurgo/cardano-serialization-lib-nodejs');

// Environment variables for sensitive data
const BLOCKFROST_API_KEY = process.env.BLOCKFROST_API_KEY || 'preprodYwHmUmlUrkhyD48GAjMUUK6BKvL7gBmJ';
const BLOCKFROST_BASE_URL = 'https://cardano-preprod.blockfrost.io/api/v0';
const WALLET_DIR = path.join(__dirname, '..', 'wallets');

const LOVELACE_PER_ADA = 1000000;
const FEE_MULTIPLIER = 1.1; // Add a buffer for fees

async function getProtocolParams() {
    try {
        const response = await axios.get(`${BLOCKFROST_BASE_URL}/epochs/latest/protocol_parameters`, {
            headers: { project_id: BLOCKFROST_API_KEY },
        });
        return response.data;
    } catch (error) {
        console.error('Error fetching protocol parameters:', error);
        throw new Error('Failed to fetch protocol parameters');
    }
}

async function buildAndSignTransaction(utxos, recipient, amountLovelace, senderAddress, privateKeyHex, protocolParams) {
    const txBuilder = CardanoWasm.TransactionBuilder.new(
        CardanoWasm.TransactionBuilderConfigBuilder.new()
            .fee_algo(CardanoWasm.LinearFee.new(CardanoWasm.BigNum.from_str(protocolParams.min_fee_a), CardanoWasm.BigNum.from_str(protocolParams.min_fee_b)))
            .pool_deposit(CardanoWasm.BigNum.from_str(protocolParams.pool_deposit))
            .key_deposit(CardanoWasm.BigNum.from_str(protocolParams.key_deposit))
            .coins_per_utxo_word(CardanoWasm.BigNum.from_str(protocolParams.coins_per_utxo_word))
            .max_value_size(protocolParams.max_val_size)
            .max_tx_size(protocolParams.max_tx_size)
            .build()
    );

    let totalInputLovelace = CardanoWasm.BigNum.from_str('0');
    for (const utxo of utxos) {
        const transactionId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxo.tx_hash, 'hex'));
        const outputIndex = utxo.tx_index;
        const amount = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(utxo.amount[0].quantity));
        const input = CardanoWasm.TransactionInput.new(transactionId, outputIndex);
        txBuilder.add_input(input, amount);
        totalInputLovelace = totalInputLovelace.checked_add(CardanoWasm.BigNum.from_str(utxo.amount[0].quantity));
    }

    const recipientAddress = CardanoWasm.Address.from_bech32(recipient);
    txBuilder.add_output(CardanoWasm.TransactionOutput.new(recipientAddress, CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(amountLovelace))));

    const changeAddress = CardanoWasm.Address.from_bech32(senderAddress);
    txBuilder.add_change(changeAddress);

    const txBody = txBuilder.build();
    const txHash = CardanoWasm.hash_transaction(txBody);

    const privateKey = CardanoWasm.PrivateKey.from_hex(privateKeyHex);
    const transactionWitnessSet = CardanoWasm.TransactionWitnessSet.new();
    const vkeyWitnesses = CardanoWasm.Vkeywitnesses.new();
    vkeyWitnesses.add(CardanoWasm.make_vkey_witness(txHash, privateKey));
    transactionWitnessSet.set_vkeys(vkeyWitnesses);

    const signedTx = CardanoWasm.Transaction.new(txBody, transactionWitnessSet, undefined);
    return Buffer.from(signedTx.to_bytes()).toString('hex');
}

async function submitTransaction(signedTransactionHex) {
    try {
        const response = await axios.post(
            `${BLOCKFROST_BASE_URL}/tx/submit`,
            signedTransactionHex,
            {
                headers: {
                    'project_id': BLOCKFROST_API_KEY,
                    'Content-Type': 'application/cbor'
                }
            }
        );
        return response.data.tx_id;
    } catch (error) {
        console.error('Error submitting transaction:', error.response ? error.response.data : error.message);
        throw new Error(`Failed to submit transaction: ${error.response ? JSON.stringify(error.response.data) : error.message}`);
    }
}

router.post('/', async (req, res) => {
    const { walletName, password, recipient, amountLovelace } = req.body;

    if (!walletName || !password || !recipient || !amountLovelace) {
        return res.status(400).json({ error: 'Missing fields' });
    }

    const amountToSend = parseInt(amountLovelace, 10);
    if (isNaN(amountToSend) || amountToSend <= 0) {
        return res.status(400).json({ error: 'Invalid amount' });
    }

    try {
        const filePath = path.join(WALLET_DIR, `${walletName}.json`);
        let encryptedData;
        try {
            const fileContent = await fs.readFile(filePath, 'utf8');
            encryptedData = JSON.parse(fileContent);
        } catch (error) {
            return res.status(404).json({ error: 'Wallet not found' });
        }

        if (!encryptedData.encrypted) {
            return res.status(400).json({ error: 'Invalid wallet file format' });
        }

        const encryptedBuffer = Buffer.from(encryptedData.encrypted, 'hex');
        const decipher = crypto.createDecipher('aes-256-ctr', password);
        const decrypted = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
        const mnemonic = decrypted.toString('utf8');

        if (!bip39.validateMnemonic(mnemonic)) {
            return res.status(400).json({ error: 'Invalid mnemonic' });
        }

        const entropy = await bip39.mnemonicToEntropy(mnemonic);
        const rootKey = CardanoWasm.Bip32PrivateKey.from_bip39_entropy(Buffer.from(entropy, 'hex'), Buffer.from(''));

        const accountKey = rootKey.derive(1852 | 0x80000000)
            .derive(1815 | 0x80000000)
            .derive(0 | 0x80000000);
        const utxoPrivateKey = accountKey.derive(0).derive(0);
        const utxoPublicKey = utxoPrivateKey.to_public();
        const stakeKey = accountKey.derive(2).derive(0).to_public();

        const senderAddr = CardanoWasm.BaseAddress.new(
            0,
            CardanoWasm.Credential.from_keyhash(utxoPublicKey.to_raw_key().hash()),
            CardanoWasm.Credential.from_keyhash(stakeKey.to_raw_key().hash())
        ).to_address().to_bech32();

        const utxosRes = await axios.get(`${BLOCKFROST_BASE_URL}/addresses/${senderAddr}/utxos`, {
            headers: { project_id: BLOCKFROST_API_KEY }
        });

        if (!utxosRes.data || utxosRes.data.length === 0) {
            return res.status(400).json({ error: 'No UTXOs found for this wallet' });
        }

        const protocolParams = await getProtocolParams();
        const privateKeyHex = Buffer.from(utxoPrivateKey.as_bytes()).toString('hex');

        // Simple UTXO selection - select all UTXOs for now
        const selectedUtxos = utxosRes.data;

        if (selectedUtxos.length === 0) {
            return res.status(400).json({ error: 'No suitable UTXOs found' });
        }

        const signedTransaction = await buildAndSignTransaction(
            selectedUtxos,
            recipient,
            amountToSend.toString(),
            senderAddr,
            privateKeyHex,
            protocolParams
        );

        const txId = await submitTransaction(signedTransaction);

        res.status(200).json({ txId, message: 'Transaction submitted successfully' });

    } catch (error) {
        console.error('Transaction error:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

// sendAda.js
const Cardano = require('@emurgo/cardano-serialization-lib-nodejs');
const bip39 = require('bip39');
const fs = require('fs');
const axios = require('axios');
require('dotenv').config();

function mnemonicToRootKey(mnemonic) {
  const entropy = bip39.mnemonicToEntropy(mnemonic);
  return Cardano.Bip32PrivateKey.from_bip39_entropy(
    Buffer.from(entropy, 'hex'),
    Buffer.from('')
  );
}

function deriveBaseAddress(rootKey) {
  const accountKey = rootKey
    .derive(1852 | 0x80000000)
    .derive(1815 | 0x80000000)
    .derive(0 | 0x80000000);

  const utxoPubKey = accountKey.derive(0).derive(0).to_public();
  const stakePubKey = accountKey.derive(2).derive(0).to_public();

  const baseAddr = Cardano.BaseAddress.new(
    Cardano.NetworkInfo.mainnet().network_id(),
    Cardano.Credential.from_keyhash(utxoPubKey.to_raw_key().hash()),
    Cardano.Credential.from_keyhash(stakePubKey.to_raw_key().hash())
  );

  return {
    address: baseAddr.to_address().to_bech32(),
    paymentKey: accountKey.derive(0).derive(0),
  };
}
async function getUtxos(address, blockfrostKey) {
  const url = `https://cardano-mainnet.blockfrost.io/api/v0/addresses/${address}/utxos`;
  const response = await axios.get(url, {
    headers: { project_id: blockfrostKey },
  });
  return response.data;
}

function createTransaction(utxos, toAddress, lovelaceAmount, paymentKey, senderAddress) {
  const txBuilder = Cardano.TransactionBuilder.new(
    Cardano.TransactionBuilderConfigBuilder.new()
      .fee_algo(Cardano.LinearFee.new(Cardano.BigNum.from_str('44'), Cardano.BigNum.from_str('155381')))
      .coins_per_utxo_word(Cardano.BigNum.from_str('34482'))
      .pool_deposit(Cardano.BigNum.from_str('500000000'))
      .key_deposit(Cardano.BigNum.from_str('2000000'))
      .max_value_size(5000)
      .max_tx_size(16384)
      .build()
  );

  utxos.forEach((utxo) => {
    const input = Cardano.TransactionInput.new(
      Cardano.TransactionHash.from_bytes(Buffer.from(utxo.tx_hash, 'hex')),
      utxo.output_index
    );

    const outputAmount = Cardano.Value.new(Cardano.BigNum.from_str(utxo.amount[0].quantity));
    const output = Cardano.TransactionOutput.new(
      Cardano.Address.from_bech32(senderAddress),
      outputAmount
    );

    const txInput = Cardano.TransactionUnspentOutput.new(input, output);
    txBuilder.add_input(paymentKey.to_public().to_raw_key(), txInput.input(), txInput.output().amount());
  });

  const outputToReceiver = Cardano.TransactionOutput.new(
    Cardano.Address.from_bech32(toAddress),
    Cardano.Value.new(Cardano.BigNum.from_str(lovelaceAmount.toString()))
  );
  txBuilder.add_output(outputToReceiver);
  txBuilder.add_change_if_needed(Cardano.Address.from_bech32(senderAddress));

  return txBuilder.build();
}
function signAndSubmitTx(txBody, paymentKey) {
  const txHash = Cardano.hash_transaction(txBody);
  const witnesses = Cardano.TransactionWitnessSet.new();
  const vkeyWitnesses = Cardano.Vkeywitnesses.new();

  const vkeyWitness = Cardano.make_vkey_witness(txHash, paymentKey);
  vkeyWitnesses.add(vkeyWitness);
  witnesses.set_vkeys(vkeyWitnesses);

  const tx = Cardano.Transaction.new(txBody, witnesses);
  const txBytes = Buffer.from(tx.to_bytes()).toString('hex');

  return axios.post('https://cardano-mainnet.blockfrost.io/api/v0/tx/submit', Buffer.from(txBytes, 'hex'), {
    headers: {
      'Content-Type': 'application/cbor',
      project_id: BLOCKFROST_API_KEY,
    },
  });
}
async function sendAda({ mnemonic, password, toAddress, amount }) {
  const seed = decryptMnemonic(mnemonic, password);
  const rootKey = Cardano.Bip32PrivateKey.from_bip39_entropy(
    Buffer.from(seed, 'hex'),
    Buffer.from('')
  );

  const accountKey = rootKey.derive(1852 | 0x80000000)
                            .derive(1815 | 0x80000000)
                            .derive(0 | 0x80000000);
  const paymentKey = accountKey.derive(0).derive(0);
  const senderAddress = Cardano.BaseAddress.new(
    Cardano.NetworkInfo.mainnet().network_id(),
    Cardano.StakeCredential.from_keyhash(paymentKey.to_public().to_raw_key().hash()),
    Cardano.StakeCredential.from_keyhash(paymentKey.to_public().to_raw_key().hash())
  ).to_address().to_bech32();

  const utxos = await getUtxos(senderAddress, BLOCKFROST_API_KEY);
  const txBody = createTransaction(utxos, toAddress, amount, paymentKey, senderAddress);
  const result = await signAndSubmitTx(txBody, paymentKey);

  return result.data;
}

module.exports = { sendAda };

/**
 * x402 Payment Client — correct format matching @x402/evm SDK
 * Usage: WALLET_PRIVATE_KEY=0x... node scripts/x402-pay.js
 */
require('dotenv').config({ override: true });
const { createWalletClient, createPublicClient, http, getAddress } = require('viem');
const { base } = require('viem/chains');
const { privateKeyToAccount } = require('viem/accounts');

const ENDPOINT = process.env.ENDPOINT || 'https://api.memoryapi.org/x402/memory';
const AGENT_ID = process.env.AGENT_ID || 'bazaar-settlement';
const QUERY = process.env.QUERY || 'bazaar indexing test';

function createNonce() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getEvmChainId(network) {
  const match = /^eip155:(\d+)$/.exec(network);
  return match ? parseInt(match[1]) : null;
}

async function main() {
  const METHOD = process.env.METHOD || 'GET';
  const privateKey = process.env.WALLET_PRIVATE_KEY;
  if (!privateKey) {
    console.error('❌ Set WALLET_PRIVATE_KEY=0x... before running');
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`);
  console.log('💳 Payer:', account.address);

  const walletClient = createWalletClient({ account, chain: base, transport: http() });

  // Step 1: Get 402 payment requirements
  console.log('\n📡 Getting payment requirements...');
  const initUrl = METHOD === 'POST' ? ENDPOINT : `${ENDPOINT}?agent_id=${AGENT_ID}&query=${encodeURIComponent(QUERY)}`;
  const initOpts = METHOD === 'POST' ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'test', agent_id: AGENT_ID }) } : {};
  const res = await fetch(initUrl, initOpts);
  if (res.status !== 402) { console.error('Expected 402, got:', res.status); return; }

  const header = res.headers.get('payment-required');
  const data = JSON.parse(Buffer.from(header, 'base64').toString());
  const req = data.accepts[0];
  console.log('✅ Requirement:', parseInt(req.amount)/1000000, 'USDC →', req.payTo);
  console.log('   Name:', req.extra?.name, '| Version:', req.extra?.version);

  // Step 2: Sign using exact SDK format
  console.log('\n✍️  Signing EIP-3009 authorization...');
  const now = Math.floor(Date.now() / 1000);
  const nonce = createNonce();
  const chainId = getEvmChainId(req.network);

  const authorization = {
    from: account.address,
    to: getAddress(req.payTo),
    value: req.amount,
    validAfter: (now - 600).toString(),
    validBefore: (now + req.maxTimeoutSeconds).toString(),
    nonce
  };

  const signature = await walletClient.signTypedData({
    account,
    domain: {
      name: req.extra.name,
      version: req.extra.version,
      chainId,
      verifyingContract: getAddress(req.asset)
    },
    types: {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' }
      ]
    },
    primaryType: 'TransferWithAuthorization',
    message: {
      from: getAddress(account.address),
      to: getAddress(req.payTo),
      value: BigInt(req.amount),
      validAfter: BigInt(now - 600),
      validBefore: BigInt(now + req.maxTimeoutSeconds),
      nonce
    }
  });

  console.log('✅ Signed!');

  // Step 3: Build payment payload — v2 requires 'accepted' = full payment requirement
  const paymentPayload = {
    x402Version: data.x402Version,
    accepted: req,  // full payment requirement object for deepEqual match
    resource: data.resource,  // Required for CDP Bazaar indexing (must be HTTPS)
    extensions: data.extensions,  // Bazaar metadata copied from 402 response
    payload: { authorization, signature }
  };

  const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');

  // Step 4: Send paid request
  console.log('\n🚀 Sending payment...');
  const fetchOpts = {
    method: METHOD,
    headers: { 'PAYMENT-SIGNATURE': paymentHeader }
  };
  if (METHOD === 'POST') {
    fetchOpts.headers['Content-Type'] = 'application/json';
    fetchOpts.body = JSON.stringify({ content: 'bazaar indexing test', agent_id: AGENT_ID });
  }
  const url = METHOD === 'POST' ? ENDPOINT : `${ENDPOINT}?agent_id=${AGENT_ID}&query=${encodeURIComponent(QUERY)}`;
  const paidRes = await fetch(url, fetchOpts);

  const body = await paidRes.text();
  console.log('Status:', paidRes.status);
  console.log('Body:', body.substring(0, 300));
  // Decode payment-response to check Bazaar extension status
  const payResp = paidRes.headers.get('payment-response');
  if (payResp) {
    try {
      const decoded = JSON.parse(Buffer.from(payResp, 'base64').toString());
      console.log('\nPayment response:', JSON.stringify(decoded, null, 2));
    } catch(e) { console.log('Payment-response header (raw):', payResp.substring(0, 200)); }
  }

  if (paidRes.status >= 200 && paidRes.status < 300) {
    console.log('\n🎉 SUCCESS! Settlement complete — CDP Bazaar will index MemoryAPI shortly!');
  } else {
    console.log('\n⚠️  Status', paidRes.status, '— check format');
    // Decode full error from PAYMENT-REQUIRED header
    const errHeader = paidRes.headers.get('payment-required');
    if (errHeader) {
      try {
        const errData = JSON.parse(Buffer.from(errHeader, 'base64').toString());
        console.log('\nFull error:', JSON.stringify(errData, null, 2));
      } catch(e) { console.log('Raw header:', errHeader); }
    }
    console.log('\nPayload sent:', JSON.stringify(paymentPayload, null, 2));
  }
}

main().catch(console.error);
// This is appended - ignore, updating the main file

/**
 * Check CDP EXTENSION-RESPONSES during settle — translate endpoint (no OpenAI needed)
 */
require('dotenv').config({ override: true });
const { createWalletClient, http, getAddress } = require('viem');
const { base } = require('viem/chains');
const { privateKeyToAccount } = require('viem/accounts');

const ENDPOINT = 'https://api.memoryapi.org/x402/translate';

function createNonce() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function main() {
  const privateKey = process.env.WALLET_PRIVATE_KEY;
  if (!privateKey) { console.error('Set WALLET_PRIVATE_KEY'); process.exit(1); }

  const account = privateKeyToAccount(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`);
  const walletClient = createWalletClient({ account, chain: base, transport: http() });

  // Step 1: Get 402
  console.log('Getting 402...');
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Hello world', target: 'es' })
  });
  console.log('Initial status:', res.status);
  if (res.status !== 402) { console.error('Expected 402'); return; }

  const header = res.headers.get('payment-required');
  const data = JSON.parse(Buffer.from(header + '==', 'base64').toString());
  const req = data.accepts[0];
  console.log('Resource URL:', data.resource?.url);
  console.log('Extensions in 402:', JSON.stringify(data.extensions));

  // Step 2: Sign
  const now = Math.floor(Date.now() / 1000);
  const nonce = createNonce();
  const signature = await walletClient.signTypedData({
    account,
    domain: { name: req.extra.name, version: req.extra.version, chainId: 8453, verifyingContract: getAddress(req.asset) },
    types: { TransferWithAuthorization: [
      { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }
    ]},
    primaryType: 'TransferWithAuthorization',
    message: {
      from: getAddress(account.address), to: getAddress(req.payTo),
      value: BigInt(req.amount), validAfter: BigInt(now - 600),
      validBefore: BigInt(now + req.maxTimeoutSeconds), nonce
    }
  });

  const paymentPayload = {
    x402Version: data.x402Version,
    accepted: req,
    resource: data.resource,
    extensions: data.extensions,
    payload: { authorization: {
      from: account.address, to: req.payTo, value: req.amount,
      validAfter: (now - 600).toString(), validBefore: (now + req.maxTimeoutSeconds).toString(), nonce
    }, signature }
  };

  const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');
  console.log('\nSending payment with extensions:', !!paymentPayload.extensions);

  // Step 3: Pay
  const paidRes = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'PAYMENT-SIGNATURE': paymentHeader
    },
    body: JSON.stringify({ text: 'Hello world', target: 'es' })
  });

  console.log('Paid status:', paidRes.status);
  const body = await paidRes.text();
  console.log('Body:', body.substring(0, 200));

  const extResp = paidRes.headers.get('extension-responses');
  if (extResp) {
    console.log('\n🎉 EXTENSION-RESPONSES found on CLIENT side:', extResp.substring(0, 200));
  } else {
    console.log('\nNo extension-responses header on client side (check server logs)');
  }
}
main().catch(console.error);

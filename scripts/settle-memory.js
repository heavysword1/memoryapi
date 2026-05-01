require('dotenv').config({ override: true });
const { createWalletClient, http, getAddress } = require('viem');
const { base } = require('viem/chains');
const { privateKeyToAccount } = require('viem/accounts');

const ENDPOINT = process.env.ENDPOINT || 'https://api.memoryapi.org/x402/memory';
const METHOD = process.env.METHOD || 'GET';

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

  const url = METHOD === 'GET' ? `${ENDPOINT}?agent_id=bazaar-settle&query=test` : ENDPOINT;
  const opts = METHOD === 'POST' ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'bazaar settle test', agent_id: 'bazaar-settle' }) } : {};

  console.log(`Settling ${METHOD} ${ENDPOINT}...`);
  const res = await fetch(url, opts);
  if (res.status !== 402) { console.error('Expected 402, got:', res.status); return; }

  const header = res.headers.get('payment-required');
  const data = JSON.parse(Buffer.from(header + '==', 'base64').toString());
  const req = data.accepts[0];
  console.log('Resource URL:', data.resource?.url);
  console.log('Has Bazaar extension:', !!data.extensions?.bazaar);

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

  const paidOpts = { headers: { 'PAYMENT-SIGNATURE': Buffer.from(JSON.stringify(paymentPayload)).toString('base64') }, ...opts };
  if (METHOD === 'POST') paidOpts.method = 'POST';
  const paidRes = await fetch(url, paidOpts);
  const body = await paidRes.text();
  console.log('Status:', paidRes.status, '| Body:', body.substring(0, 100));
  if (paidRes.status >= 200 && paidRes.status < 300) {
    console.log('✅ Settlement complete — check pm2 logs for [CDP] EXTENSION-RESPONSES');
  }
}
main().catch(console.error);

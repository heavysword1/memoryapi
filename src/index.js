require('dotenv').config({ override: true });
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { paymentMiddleware, x402ResourceServer } = require('@x402/express');
const { bazaarResourceServerExtension, declareDiscoveryExtension } = require('@x402/extensions');
const { ExactEvmScheme } = require('@x402/evm/exact/server');
const { HTTPFacilitatorClient } = require('@x402/core/server');
const app = express();

// CORS — restrict to known origins in production
const allowedOrigins = [
  'https://memoryapi.org',
  'https://memory-landing-page.replit.app',
  'http://localhost:3000',
  'https://api.cdp.coinbase.com',
  'https://x402.org'
];
app.use(cors({
  origin: function(origin, callback) {
    // Allow MCP clients, curl, x402 facilitator (no origin) + known origins
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));

// Limit request body size to 50kb
app.use(express.json({ limit: '50kb' }));

// Global rate limiter — 100 requests per 15 minutes per IP
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests. Please slow down.' }
});
app.use(globalLimiter);

// Stricter limiter for key generation
const keyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { error: 'Too many key generation attempts.' }
});
app.use('/keys', keyLimiter);

// Stripe webhook needs raw body — must be before express.json()
app.use('/billing/webhook', express.raw({ type: 'application/json' }));

// x402 payment middleware — pay-per-request in USDC on Base
const PAY_TO = process.env.X402_WALLET_ADDRESS || '0xcC3b4828567E29E83526B18c689fccE3DeF73553';
const X402_NETWORK = process.env.X402_NETWORK || 'eip155:84532'; // Base Sepolia testnet
const X402_FACILITATOR_URL = process.env.X402_FACILITATOR_URL || 'https://x402.org/facilitator';

try {
  // Use @coinbase/x402 package for CDP facilitator auth if credentials provided
  let facilitatorClient;
  if (process.env.CDP_API_KEY_NAME && process.env.CDP_API_KEY_PRIVATE_KEY) {
    const { createFacilitatorConfig } = require('@coinbase/x402');
    const facilitatorConfig = createFacilitatorConfig(
      process.env.CDP_API_KEY_NAME,
      process.env.CDP_API_KEY_PRIVATE_KEY
    );
    facilitatorClient = new HTTPFacilitatorClient(facilitatorConfig);
    console.log('CDP auth configured for x402 mainnet');
  } else {
    facilitatorClient = new HTTPFacilitatorClient({ url: X402_FACILITATOR_URL });
    console.log('x402 using testnet facilitator');
  }
  const x402Server = new x402ResourceServer(facilitatorClient)
    .register(X402_NETWORK, new ExactEvmScheme())
    .registerExtension(bazaarResourceServerExtension);

  app.use(
    paymentMiddleware(
      {
        'POST /x402/memory': {
          accepts: [{ scheme: 'exact', price: '$0.001', network: X402_NETWORK, payTo: PAY_TO }],
          description: 'Store a memory for an AI agent',
          mimeType: 'application/json',
          extensions: { ...declareDiscoveryExtension({ input: { content: 'User prefers dark mode', agent_id: 'my-agent' }, inputSchema: { properties: { content: { type: 'string' }, agent_id: { type: 'string' } }, required: ["content", "agent_id"] }, bodyType: 'json', output: { example: { success: true, memory: { id: 'uuid' } } } }) }
        },
        'GET /x402/memory': {
          accepts: [{ scheme: 'exact', price: '$0.001', network: X402_NETWORK, payTo: PAY_TO }],
          description: 'Semantically search stored agent memories',
          mimeType: 'application/json',
          extensions: { ...declareDiscoveryExtension({ input: { query: 'what tools does the user prefer', agent_id: 'my-agent' }, inputSchema: { properties: { query: { type: 'string' }, agent_id: { type: 'string' } }, required: ["query", "agent_id"] }, output: { example: { success: true, results: [], count: 0 } } }) }
        },
      'POST /x402/docs/upload': {
          accepts: [{ scheme: 'exact', price: '$0.05', network: X402_NETWORK, payTo: PAY_TO }],
          description: 'Upload and ingest a PDF, TXT, or Markdown document for semantic search',
          mimeType: 'application/json',
          extensions: { ...declareDiscoveryExtension({ input: { agent_id: 'my-agent' }, inputSchema: { properties: { agent_id: { type: 'string' }, file: { type: 'string' } }, required: ['agent_id'] }, bodyType: 'json', output: { example: { success: true, document: { id: 'uuid', chunk_count: 12 } } } }) }
        },
      'GET /x402/docs/query': {
          accepts: [{ scheme: 'exact', price: '$0.01', network: X402_NETWORK, payTo: PAY_TO }],
          description: 'Semantically search within an uploaded document using natural language',
          mimeType: 'application/json',
          extensions: { ...declareDiscoveryExtension({ input: { doc_id: 'uuid', q: 'what are the payment terms', agent_id: 'my-agent' }, inputSchema: { properties: { doc_id: { type: 'string' }, q: { type: 'string' }, agent_id: { type: 'string' } }, required: ['doc_id', 'q', 'agent_id'] }, output: { example: { success: true, results: [], count: 0 } } }) }
        }
      },
      x402Server
    )
  );
  console.log(`x402 middleware initialized: ${X402_NETWORK} via ${X402_FACILITATOR_URL}`);
} catch (err) {
  console.error('x402 middleware init failed:', err.message);
  console.log('API running without x402 — configure CDP keys to enable');
}

// Routes
app.use('/memory', require('./routes/memory'));
app.use('/keys', require('./routes/keys'));
app.use('/mcp', require('./routes/mcp'));
app.use('/billing', require('./routes/billing'));
app.use('/x402', require('./routes/x402'));
app.use('/docs', require('./routes/docs'));
app.use('/x402/docs', require('./routes/x402-docs'));

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'MemoryAPI',
    version: '1.0.0'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`MemoryAPI running on port ${PORT}`);
});

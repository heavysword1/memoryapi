require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const app = express();

// CORS — restrict to known origins in production
const allowedOrigins = [
  'https://memoryapi.org',
  'https://memory-landing-page.replit.app',
  'http://localhost:3000'
];
app.use(cors({
  origin: function(origin, callback) {
    // Allow MCP clients and curl (no origin) + known origins
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

// Routes
app.use('/memory', require('./routes/memory'));
app.use('/keys', require('./routes/keys'));
app.use('/mcp', require('./routes/mcp'));

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

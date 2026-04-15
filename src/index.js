require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

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

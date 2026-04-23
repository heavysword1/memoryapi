const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { generateEmbedding } = require('../lib/openai');

// Prompt injection detection
const injectionPatterns = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /system\s*:\s*override/i,
  /\[INST\]/i,
  /<\|system\|>/i,
  /you\s+are\s+now\s+a/i,
  /forget\s+(everything|all)\s+(you|above)/i,
  /new\s+instructions?\s*:/i,
  /disregard\s+(all\s+)?(previous|prior)/i
];

function checkInjection(content) {
  return injectionPatterns.some(p => p.test(content));
}

// These routes are protected by x402 payment middleware (applied in index.js)
// By the time requests reach here, payment has been verified by x402

// POST /x402/memory — store a memory (pay per store)
router.post('/memory', async (req, res) => {
  try {
    const { content, metadata = {}, agent_id } = req.body;

    if (!agent_id) {
      return res.status(400).json({ error: 'agent_id is required.' });
    }

    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'content is required and must be a string.' });
    }

    if (content.length > 10000) {
      return res.status(400).json({ error: 'content exceeds maximum length of 10,000 characters.' });
    }

    if (checkInjection(content)) {
      return res.status(400).json({ error: 'Content contains potentially unsafe instruction patterns.' });
    }

    const embedding = await generateEmbedding(content);

    const { data, error } = await supabase
      .from('memories')
      .insert({
        agent_id,
        content,
        embedding,
        metadata: { ...metadata, payment: 'x402' }
      })
      .select('id, content, metadata, created_at')
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      memory: data
    });

  } catch (err) {
    console.error('POST /x402/memory error:', err);
    res.status(500).json({ error: 'Failed to store memory.' });
  }
});

// GET /x402/memory?query=...&agent_id=... — semantic search (pay per search)
router.get('/memory', async (req, res) => {
  try {
    const { agent_id } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const { query, threshold = 0.4 } = req.query;

    if (!agent_id) {
      return res.status(400).json({ error: 'agent_id is required.' });
    }

    if (!query) {
      return res.status(400).json({ error: 'query parameter is required.' });
    }

    if (query.length > 1000) {
      return res.status(400).json({ error: 'query must be under 1000 characters.' });
    }

    const embedding = await generateEmbedding(query);

    const { data, error } = await supabase.rpc('search_memories', {
      query_embedding: embedding,
      match_agent_id: agent_id,
      match_threshold: parseFloat(threshold) || 0.4,
      match_count: limit
    });

    if (error) throw error;

    res.json({
      success: true,
      results: data,
      count: data.length
    });

  } catch (err) {
    console.error('GET /x402/memory error:', err);
    res.status(500).json({ error: 'Failed to search memories.' });
  }
});

module.exports = router;

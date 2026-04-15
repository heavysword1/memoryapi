const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { generateEmbedding } = require('../lib/openai');
const authenticate = require('../middleware/auth');

// POST /memory — store a memory
router.post('/', authenticate, async (req, res) => {
  try {
    const { content, metadata = {} } = req.body;

    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'content is required and must be a string.' });
    }

    // Check memory limit
    const { keyRecord, agentId } = req;
    if (keyRecord.memory_count >= keyRecord.max_memories) {
      return res.status(403).json({ 
        error: `Memory limit reached (${keyRecord.max_memories}). Upgrade your plan.` 
      });
    }

    // Generate embedding
    const embedding = await generateEmbedding(content);

    // Store memory
    const { data, error } = await supabase
      .from('memories')
      .insert({
        agent_id: agentId,
        content,
        embedding,
        metadata
      })
      .select('id, content, metadata, created_at')
      .single();

    if (error) throw error;

    // Increment memory count
    await supabase
      .from('api_keys')
      .update({ memory_count: keyRecord.memory_count + 1 })
      .eq('id', keyRecord.id);

    res.status(201).json({ 
      success: true,
      memory: data
    });

  } catch (err) {
    console.error('POST /memory error:', err);
    res.status(500).json({ error: 'Failed to store memory.' });
  }
});

// GET /memory?query=...&limit=10&threshold=0.7 — semantic search
router.get('/', authenticate, async (req, res) => {
  try {
    const { query, limit = 10, threshold = 0.4 } = req.query;

    if (!query) {
      return res.status(400).json({ error: 'query parameter is required.' });
    }

    const embedding = await generateEmbedding(query);

    const { data, error } = await supabase.rpc('search_memories', {
      query_embedding: embedding,
      match_agent_id: req.agentId,
      match_threshold: parseFloat(threshold),
      match_count: parseInt(limit)
    });

    if (error) throw error;

    res.json({ 
      success: true,
      results: data,
      count: data.length
    });

  } catch (err) {
    console.error('GET /memory error:', err);
    res.status(500).json({ error: 'Failed to search memories.' });
  }
});

// GET /memory/list — list all memories (no semantic search)
router.get('/list', authenticate, async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;

    const { data, error } = await supabase
      .from('memories')
      .select('id, content, metadata, created_at')
      .eq('agent_id', req.agentId)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (error) throw error;

    res.json({ 
      success: true,
      memories: data,
      count: data.length
    });

  } catch (err) {
    console.error('GET /memory/list error:', err);
    res.status(500).json({ error: 'Failed to list memories.' });
  }
});

// DELETE /memory/:id — delete a memory
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('memories')
      .delete()
      .eq('id', id)
      .eq('agent_id', req.agentId);

    if (error) throw error;

    // Decrement memory count
    const newCount = Math.max(0, req.keyRecord.memory_count - 1);
    await supabase
      .from('api_keys')
      .update({ memory_count: newCount })
      .eq('id', req.keyRecord.id);

    res.json({ success: true, message: 'Memory deleted.' });

  } catch (err) {
    console.error('DELETE /memory error:', err);
    res.status(500).json({ error: 'Failed to delete memory.' });
  }
});

module.exports = router;

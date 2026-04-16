const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../lib/supabase');

// POST /keys — generate a new API key
router.post('/', async (req, res) => {
  try {
    const { agent_id, email, plan = 'free', admin_secret } = req.body;

    // Require admin secret for non-free plans
    if (plan !== 'free') {
      if (!admin_secret || admin_secret !== process.env.ADMIN_SECRET) {
        return res.status(403).json({ error: 'Admin secret required for paid plans.' });
      }
    }

    if (!agent_id) {
      return res.status(400).json({ error: 'agent_id is required.' });
    }

    // Generate key: mem_<prefix>.<secret>
    const prefix = 'mem_' + uuidv4().replace(/-/g, '').substring(0, 8);
    const secret = uuidv4().replace(/-/g, '');
    const fullKey = `${prefix}.${secret}`;

    // Hash the full key for storage
    const keyHash = await bcrypt.hash(fullKey, 10);

    // Plan limits
    const limits = {
      free: 100,
      starter: 10000,
      pro: 999999
    };

    const { data, error } = await supabase
      .from('api_keys')
      .insert({
        key_hash: keyHash,
        key_prefix: prefix,
        agent_id,
        owner_email: email || null,
        plan,
        max_memories: limits[plan] || 100
      })
      .select('id, key_prefix, agent_id, plan, max_memories, created_at')
      .single();

    if (error) throw error;

    // Return the full key ONCE — never stored in plaintext
    res.status(201).json({
      success: true,
      api_key: fullKey,
      message: 'Save this key securely — it will not be shown again.',
      details: data
    });

  } catch (err) {
    console.error('POST /keys error:', err);
    res.status(500).json({ error: 'Failed to generate API key.' });
  }
});

module.exports = router;

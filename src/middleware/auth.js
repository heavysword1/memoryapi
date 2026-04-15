const bcrypt = require('bcrypt');
const supabase = require('../lib/supabase');

async function authenticate(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ error: 'Missing API key. Include x-api-key header.' });
  }

  // Key format: prefix.secret (e.g. mem_abc123.secretpart)
  const parts = apiKey.split('.');
  if (parts.length !== 2) {
    return res.status(401).json({ error: 'Invalid API key format.' });
  }

  const prefix = parts[0];

  const { data: keyRecord, error } = await supabase
    .from('api_keys')
    .select('*')
    .eq('key_prefix', prefix)
    .single();

  if (error || !keyRecord) {
    return res.status(401).json({ error: 'Invalid API key.' });
  }

  const valid = await bcrypt.compare(apiKey, keyRecord.key_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid API key.' });
  }

  // Update last used
  await supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', keyRecord.id);

  req.agentId = keyRecord.agent_id;
  req.keyRecord = keyRecord;
  next();
}

module.exports = authenticate;

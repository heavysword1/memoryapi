const express = require('express');
const router = express.Router();
const multer = require('multer');
const pdfParse = require('pdf-parse');
const supabase = require('../lib/supabase');
const { generateEmbedding } = require('../lib/openai');
const authenticate = require('../middleware/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['application/pdf', 'text/plain', 'text/markdown'];
    if (allowed.includes(file.mimetype) || file.originalname.endsWith('.md')) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, TXT, and Markdown files are supported.'));
    }
  }
});

function chunkText(text, chunkSize = 800, overlap = 150) {
  const chunks = [];
  let start = 0;
  const cleaned = text.replace(/\s+/g, ' ').trim();
  while (start < cleaned.length) {
    const end = Math.min(start + chunkSize, cleaned.length);
    const chunk = cleaned.slice(start, end).trim();
    if (chunk.length > 50) chunks.push(chunk);
    start += chunkSize - overlap;
  }
  return chunks;
}

async function extractText(buffer, mimetype) {
  if (mimetype === 'application/pdf') {
    const data = await pdfParse(buffer);
    return data.text;
  }
  return buffer.toString('utf-8');
}

// POST /docs/upload
router.post('/upload', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded. Use multipart/form-data with field name "file".' });

    const { agentId } = req;
    const { metadata = '{}' } = req.body;
    let parsedMetadata = {};
    try { parsedMetadata = JSON.parse(metadata); } catch {}

    const text = await extractText(req.file.buffer, req.file.mimetype);
    if (!text || text.trim().length < 10) return res.status(400).json({ error: 'Could not extract text from file.' });
    if (text.length > 500000) return res.status(400).json({ error: 'File exceeds 500,000 character limit.' });

    const { data: doc, error: docError } = await supabase
      .from('documents')
      .insert({ agent_id: agentId, filename: req.file.originalname, file_type: req.file.mimetype, metadata: parsedMetadata })
      .select('id, filename, file_type, created_at')
      .single();

    if (docError) throw docError;

    const chunks = chunkText(text);
    const chunkRecords = [];

    for (let i = 0; i < chunks.length; i++) {
      const embedding = await generateEmbedding(chunks[i]);
      chunkRecords.push({ document_id: doc.id, agent_id: agentId, content: chunks[i], embedding, chunk_index: i });
    }

    const { error: chunkError } = await supabase.from('document_chunks').insert(chunkRecords);
    if (chunkError) throw chunkError;

    await supabase.from('documents').update({ chunk_count: chunks.length }).eq('id', doc.id);

    res.status(201).json({ success: true, document: { id: doc.id, filename: doc.filename, file_type: doc.file_type, chunk_count: chunks.length, created_at: doc.created_at } });

  } catch (err) {
    console.error('POST /docs/upload error:', err);
    res.status(500).json({ error: err.message || 'Failed to upload document.' });
  }
});

// GET /docs/query
router.get('/query', authenticate, async (req, res) => {
  try {
    const { doc_id, q } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 5, 20);

    if (!doc_id) return res.status(400).json({ error: 'doc_id is required.' });
    if (!q) return res.status(400).json({ error: 'q (query) is required.' });
    if (q.length > 1000) return res.status(400).json({ error: 'Query must be under 1000 characters.' });

    const { data: doc, error: docError } = await supabase
      .from('documents').select('id, filename').eq('id', doc_id).eq('agent_id', req.agentId).single();

    if (docError || !doc) return res.status(404).json({ error: 'Document not found.' });

    const embedding = await generateEmbedding(q);
    const { data, error } = await supabase.rpc('search_document_chunks', {
      query_embedding: embedding, match_document_id: doc_id, match_threshold: 0.4, match_count: limit
    });

    if (error) throw error;
    res.json({ success: true, document: doc.filename, query: q, results: data, count: data.length });

  } catch (err) {
    console.error('GET /docs/query error:', err);
    res.status(500).json({ error: 'Failed to query document.' });
  }
});

// GET /docs/list
router.get('/list', authenticate, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const { data, error } = await supabase
      .from('documents').select('id, filename, file_type, chunk_count, metadata, created_at')
      .eq('agent_id', req.agentId).order('created_at', { ascending: false }).limit(limit);

    if (error) throw error;
    res.json({ success: true, documents: data, count: data.length });

  } catch (err) {
    console.error('GET /docs/list error:', err);
    res.status(500).json({ error: 'Failed to list documents.' });
  }
});

// DELETE /docs/:id
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { error } = await supabase.from('documents').delete().eq('id', req.params.id).eq('agent_id', req.agentId);
    if (error) throw error;
    res.json({ success: true, message: 'Document deleted.' });
  } catch (err) {
    console.error('DELETE /docs error:', err);
    res.status(500).json({ error: 'Failed to delete document.' });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const multer = require('multer');
const pdfParse = require('pdf-parse');
const supabase = require('../lib/supabase');
const { generateEmbedding } = require('../lib/openai');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['application/pdf', 'text/plain', 'text/markdown'];
    if (allowed.includes(file.mimetype) || file.originalname.endsWith('.md')) cb(null, true);
    else cb(new Error('Only PDF, TXT, and Markdown files are supported.'));
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

// POST /x402/docs/upload — $0.05 USDC per upload (x402 paid)
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const { agent_id } = req.body;
    if (!agent_id) return res.status(400).json({ error: 'agent_id is required.' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const text = await extractText(req.file.buffer, req.file.mimetype);
    if (!text || text.trim().length < 10) return res.status(400).json({ error: 'Could not extract text from file.' });
    if (text.length > 500000) return res.status(400).json({ error: 'File exceeds 500,000 character limit.' });

    const { data: doc, error: docError } = await supabase
      .from('documents')
      .insert({ agent_id, filename: req.file.originalname, file_type: req.file.mimetype, metadata: { payment: 'x402' } })
      .select('id, filename, file_type, created_at').single();

    if (docError) throw docError;

    const chunks = chunkText(text);
    const chunkRecords = [];
    for (let i = 0; i < chunks.length; i++) {
      const embedding = await generateEmbedding(chunks[i]);
      chunkRecords.push({ document_id: doc.id, agent_id, content: chunks[i], embedding, chunk_index: i });
    }

    const { error: chunkError } = await supabase.from('document_chunks').insert(chunkRecords);
    if (chunkError) throw chunkError;
    await supabase.from('documents').update({ chunk_count: chunks.length }).eq('id', doc.id);

    res.status(201).json({ success: true, document: { id: doc.id, filename: doc.filename, chunk_count: chunks.length, created_at: doc.created_at } });
  } catch (err) {
    console.error('POST /x402/docs/upload error:', err);
    res.status(500).json({ error: err.message || 'Failed to upload document.' });
  }
});

// GET /x402/docs/query — $0.01 USDC per query (x402 paid)
router.get('/query', async (req, res) => {
  try {
    const { doc_id, q, agent_id } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 5, 20);

    if (!doc_id) return res.status(400).json({ error: 'doc_id is required.' });
    if (!q) return res.status(400).json({ error: 'q (query) is required.' });
    if (!agent_id) return res.status(400).json({ error: 'agent_id is required.' });

    const { data: doc, error: docError } = await supabase
      .from('documents').select('id, filename').eq('id', doc_id).eq('agent_id', agent_id).single();

    if (docError || !doc) return res.status(404).json({ error: 'Document not found.' });

    const embedding = await generateEmbedding(q);
    const { data, error } = await supabase.rpc('search_document_chunks', {
      query_embedding: embedding, match_document_id: doc_id, match_threshold: 0.4, match_count: limit
    });

    if (error) throw error;
    res.json({ success: true, document: doc.filename, query: q, results: data, count: data.length });
  } catch (err) {
    console.error('GET /x402/docs/query error:', err);
    res.status(500).json({ error: 'Failed to query document.' });
  }
});

module.exports = router;

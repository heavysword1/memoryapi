const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');

const LIBRETRANSLATE_URL = process.env.LIBRETRANSLATE_URL || 'http://127.0.0.1:5000';

// Supported languages
const SUPPORTED_LANGUAGES = ['en','es','fr','de','it','pt','zh','ja','ar','ru','ko'];

// POST /translate — translate text
router.post('/', authenticate, async (req, res) => {
  try {
    const { text, source = 'auto', target } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'text is required.' });
    }
    if (text.length > 5000) {
      return res.status(400).json({ error: 'text exceeds 5,000 character limit.' });
    }
    if (!target) {
      return res.status(400).json({ error: 'target language is required.' });
    }
    if (!SUPPORTED_LANGUAGES.includes(target)) {
      return res.status(400).json({ error: `Unsupported target language. Supported: ${SUPPORTED_LANGUAGES.join(', ')}` });
    }

    const response = await fetch(`${LIBRETRANSLATE_URL}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: text, source, target, format: 'text' })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Translation failed: ${err}`);
    }

    const data = await response.json();

    res.json({
      success: true,
      translated: data.translatedText,
      source: data.detectedLanguage?.language || source,
      target,
      characters: text.length
    });

  } catch (err) {
    console.error('POST /translate error:', err);
    res.status(500).json({ error: err.message || 'Translation failed.' });
  }
});

// GET /translate/languages — list supported languages
router.get('/languages', async (req, res) => {
  try {
    const response = await fetch(`${LIBRETRANSLATE_URL}/languages`);
    const languages = await response.json();
    res.json({ success: true, languages });
  } catch (err) {
    res.status(500).json({ error: 'LibreTranslate unavailable.' });
  }
});

module.exports = router;

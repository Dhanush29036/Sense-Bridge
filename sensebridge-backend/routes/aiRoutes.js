const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

/**
 * POST /api/ai/format-sentence
 * Converts an array of gesture words into a natural, grammatically correct sentence
 * using the Google Gemini API.
 */
router.post('/format-sentence', auth, async (req, res) => {
    const { words } = req.body;
    if (!words || !Array.isArray(words) || words.length === 0) {
        return res.status(400).json({ error: 'words array is required' });
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
        // Fallback: join words with basic grammar
        const sentence = buildFallbackSentence(words);
        return res.json({ sentence, source: 'fallback' });
    }

    try {
        const prompt = `You are an assistive communication AI. Convert these gesture words into one natural, grammatically correct English sentence. Words: [${words.join(', ')}]. Reply ONLY with the sentence, no explanation or quotes.`;

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.3, maxOutputTokens: 100 }
                })
            }
        );

        if (!response.ok) throw new Error(`Gemini API error: ${response.status}`);
        const data = await response.json();
        const sentence = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || buildFallbackSentence(words);
        return res.json({ sentence, source: 'gemini' });
    } catch (err) {
        console.error('[AI Route] Gemini error:', err.message);
        return res.json({ sentence: buildFallbackSentence(words), source: 'fallback' });
    }
});

// Simple rule-based sentence builder as fallback
function buildFallbackSentence(words) {
    if (words.length === 1) return words[0] + '.';
    const starters = ['I', 'Please', 'Can you'];
    const starter = starters[Math.floor(Math.random() * starters.length)];
    const rest = words.map(w => w.toLowerCase()).join(' ');
    return `${starter} ${rest}.`;
}

module.exports = router;

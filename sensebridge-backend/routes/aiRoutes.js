const express = require('express');
const router = express.Router();
const { protect: auth } = require('../middleware/auth');

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

// Advanced rule-based sentence builder — natural ASL-to-English grammar
function buildFallbackSentence(words) {
    if (!words.length) return '';
    if (words.length === 1) return words[0] + '.';

    const lower = words.map(w => w.toLowerCase());

    // Greeting patterns
    if (lower.includes('hello')) return `Hello! ${words.filter(w => w.toLowerCase() !== 'hello').join(' ')}.`;

    // Needs / wants patterns
    const needWords  = ['eat', 'drink', 'water', 'food'];
    const foundNeed  = lower.find(w => needWords.includes(w));
    if (foundNeed) return `I need ${lower.filter(w => !['i', 'want', 'need'].includes(w)).join(', ')}.`;

    // Social patterns
    if (lower.includes('sorry'))   return `I am sorry.`;
    if (lower.includes('please') && words.length > 1) return `Please ${lower.filter(w => w !== 'please').join(' ')}.`;
    if (lower.includes('thank') || lower.includes('thanks')) return 'Thank you!';

    // Request patterns — "I" + verb + object
    const politeStarters = ['please', 'can you', 'i need'];
    const hasI = lower.includes('i');
    const rest  = words.filter(w => !['i', 'yes', 'no', 'okay', 'wait', 'please'].includes(w.toLowerCase()));

    if (hasI && rest.length) return `I ${rest.map(w => w.toLowerCase()).join(' ')}.`;
    if (lower.includes('yes'))  return `Yes, ${lower.filter(w => w !== 'yes').join(' ')}.`;
    if (lower.includes('no'))   return `No, ${lower.filter(w => w !== 'no').join(' ')}.`;

    // Generic: capitalise first word, join rest lowercase
    const sentence = words[0] + ' ' + words.slice(1).map(w => w.toLowerCase()).join(' ');
    return sentence.endsWith('.') ? sentence : sentence + '.';
}

/**
 * POST /api/ai/transcribe-translate
 * Takes base64 audio and a target language. Uses Gemini 1.5 Flash to
 * detect the language, transcribe the audio, and translate it.
 * Overlap handling for multiple speakers.
 */
router.post('/transcribe-translate', auth, async (req, res) => {
    const { audioBase64, targetLang } = req.body;
    
    if (!audioBase64 || !targetLang) {
        return res.status(400).json({ error: 'audioBase64 and targetLang are required' });
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
        return res.status(503).json({ error: 'GEMINI_API_KEY is not configured on the server.' });
    }

    try {
        const prompt = `Listen to the attached audio. 
1. Identify the language being spoken.
2. Transcribe exactly what is being said in that native language.
3. Translate it into ${targetLang}.
4. If there is NO speech or only background noise, return empty strings.

Output STRICTLY in this JSON format:
{
  "sourceLang": "detected language code (e.g. es-ES, en-US) or unknown",
  "text": "native transcription",
  "translated": "translated text in ${targetLang}"
}`;

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: prompt },
                            {
                                inlineData: {
                                    mimeType: 'audio/webm',
                                    data: audioBase64
                                }
                            }
                        ]
                    }],
                    generationConfig: { temperature: 0.1, maxOutputTokens: 250 }
                })
            }
        );

        if (!response.ok) {
            const errBody = await response.text();
            throw new Error(`Gemini API error: ${response.status} - ${errBody}`);
        }
        
        const data = await response.json();
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '{}';
        
        let parsed = { sourceLang: 'unknown', text: '', translated: '' };
        try {
            // Remove markdown code blocks if Gemini returns them
            const cleanJson = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            parsed = JSON.parse(cleanJson);
        } catch (e) {
            console.error('[Transcribe] Failed to parse JSON:', rawText);
        }

        return res.json(parsed);
    } catch (err) {
        console.error('[AI Route] Transcribe error:', err.message);
        return res.status(500).json({ error: 'Failed to transcribe audio.' });
    }
});

module.exports = router;

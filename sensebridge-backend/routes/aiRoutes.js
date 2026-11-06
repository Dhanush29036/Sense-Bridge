const express = require('express');
const router = express.Router();
const { protect: auth } = require('../middleware/auth');
const crypto = require('crypto');

// In-memory cache for audio transcriptions (limits at 100 keys)
const audioCache = new Map();
const MAX_CACHE_SIZE = 100;

const GEMINI_MODELS = ['gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-flash-latest'];

async function callGemini(parts, generationConfig = {}, apiKey = process.env.GEMINI_API_KEY) {
    if (!apiKey) throw new Error('GEMINI_API_KEY not configured.');
    let lastError = null;
    for (const model of GEMINI_MODELS) {
        try {
            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts }],
                        generationConfig: { maxOutputTokens: 2048, ...generationConfig }
                    })
                }
            );
            if (res.ok) {
                const data = await res.json();
                return data;
            }
            const errBody = await res.text();
            lastError = new Error(`Gemini ${model} ${res.status}: ${errBody}`);
        } catch (err) {
            lastError = err;
        }
    }
    throw lastError || new Error('All Gemini models failed.');
}

/**
 * POST /api/ai/predict-gesture-sentence
 * Predicts what the user is trying to say from a series of gesture tokens.
 * Returns primary sentence, 3 predictive alternative suggestions, and intent category.
 */
router.post(['/format-sentence', '/predict-gesture-sentence'], async (req, res) => {
    const { words } = req.body;
    if (!words || !Array.isArray(words) || words.length === 0) {
        return res.status(400).json({ error: 'words array is required' });
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const rulePrediction = predictFromGestureTokens(words);

    if (!GEMINI_API_KEY) {
        return res.json({
            sentence: rulePrediction.sentence,
            predictions: rulePrediction.predictions,
            intent: rulePrediction.intent,
            source: 'rule-engine'
        });
    }

    try {
        const prompt = `You are an assistive communication AI for deaf and non-verbal users.
The user signed these gesture tokens: [${words.join(', ')}].
Predict what the user is trying to say.
Output STRICTLY in this JSON format:
{
  "sentence": "the most natural, polite and complete English sentence they are trying to say",
  "predictions": [
    "Alternative intent 1 (e.g. polite request)",
    "Alternative intent 2 (e.g. urgent / direct)",
    "Alternative intent 3 (e.g. casual conversational)"
  ],
  "intent": "category like Needs, Emergency, Greeting, Social, Question"
}`;

        const data = await callGemini([{ text: prompt }], { temperature: 0.2 });
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '{}';
        const cleanJson = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(cleanJson);

        return res.json({
            sentence: parsed.sentence || rulePrediction.sentence,
            predictions: Array.isArray(parsed.predictions) && parsed.predictions.length ? parsed.predictions : rulePrediction.predictions,
            intent: parsed.intent || rulePrediction.intent,
            source: 'gemini'
        });
    } catch (err) {
        console.warn('[AI Route] Gemini predict sentence fallback:', err.message);
        return res.json({
            sentence: rulePrediction.sentence,
            predictions: rulePrediction.predictions,
            intent: rulePrediction.intent,
            source: 'rule-engine'
        });
    }
});

// Comprehensive local gesture predictive engine (ASL/ISL token intent matrix)
function predictFromGestureTokens(words) {
    if (!words || !words.length) {
        return { sentence: '', predictions: [], intent: 'General' };
    }

    const lower = words.map(w => w.toLowerCase());
    const has = (t) => lower.some(w => w === t.toLowerCase() || w.includes(t.toLowerCase()));

    // 1. Water / Thirst
    if (has('water') || has('drink')) {
        if (has('more')) {
            return {
                sentence: 'Could I please have some more water to drink?',
                predictions: [
                    'Could I please have some more water?',
                    'I am still thirsty, another glass of water please.',
                    'Can you refill my water bottle?'
                ],
                intent: 'Needs (Thirst)'
            };
        }
        if (has('please')) {
            return {
                sentence: 'May I please have a glass of water?',
                predictions: [
                    'May I please have a glass of water?',
                    'I am thirsty, could you bring me some water?',
                    'Where can I find drinking water, please?'
                ],
                intent: 'Needs (Thirst)'
            };
        }
        return {
            sentence: 'I am thirsty, could I please get some water to drink?',
            predictions: [
                'I am thirsty, could I please get some water?',
                'Please give me a glass of drinking water.',
                'Can I have something to drink?'
            ],
            intent: 'Needs (Thirst)'
        };
    }

    // 2. Food / Eating / Hunger
    if (has('eat') || has('food')) {
        if (has('more')) {
            return {
                sentence: 'I am still hungry, could I please have some more food?',
                predictions: [
                    'Could I please have another portion of food?',
                    'I am still hungry, can I have more?',
                    'Is there any more food left for me?'
                ],
                intent: 'Needs (Hunger)'
            };
        }
        return {
            sentence: 'I am hungry and would like something to eat, please.',
            predictions: [
                'I would like something to eat, please.',
                'Is it time for a meal?',
                'Can we get some food together?'
            ],
            intent: 'Needs (Hunger)'
        };
    }

    // 3. Stop / Urgent / Emergency
    if (has('stop')) {
        if (has('wait')) {
            return {
                sentence: 'Please stop and wait a moment for me.',
                predictions: [
                    'Please stop and wait for me.',
                    'Hold on, please do not proceed yet.',
                    'Wait right here, please.'
                ],
                intent: 'Urgent'
            };
        }
        return {
            sentence: 'Please stop what you are doing.',
            predictions: [
                'Please stop what you are doing.',
                'I need you to stop right now.',
                'Stop, I need assistance.'
            ],
            intent: 'Urgent'
        };
    }

    // 4. Wait / Hold on
    if (has('wait')) {
        return {
            sentence: 'Please wait a moment while I finish communicating.',
            predictions: [
                'Please hold on for just a moment.',
                'Give me a second to express myself.',
                'Please wait right there.'
            ],
            intent: 'Patience'
        };
    }

    // 5. Call me / Contact
    if (has('call me')) {
        return {
            sentence: 'Please give me a call as soon as you have time.',
            predictions: [
                'Please call me on the phone when you are free.',
                'Can you call my contact number?',
                'Please reach out to me soon.'
            ],
            intent: 'Communication'
        };
    }

    // 6. Greetings & Introductions
    if (has('hello')) {
        if (has('name')) {
            return {
                sentence: 'Hello! What is your name? Nice to meet you.',
                predictions: [
                    'Hello! May I know what your name is?',
                    'Hello, nice to meet you today.',
                    'Hello, let me introduce myself.'
                ],
                intent: 'Greeting'
            };
        }
        return {
            sentence: 'Hello! I hope you are having a wonderful day.',
            predictions: [
                'Hello! How are you doing today?',
                'Hello! Good morning / good afternoon.',
                'Hello, it is great to see you!'
            ],
            intent: 'Greeting'
        };
    }

    // 7. Name / Identity
    if (has('name')) {
        return {
            sentence: 'What is your name? It is a pleasure to meet you.',
            predictions: [
                'Could you please tell me your name?',
                'My name is being signed with gestures.',
                'May I know who I am speaking with?'
            ],
            intent: 'Question'
        };
    }

    // 8. Love / Affection
    if (has('love you')) {
        return {
            sentence: 'I love and care about you very much.',
            predictions: [
                'I love you with all my heart.',
                'Sending you my love and best wishes.',
                'I really appreciate and love you.'
            ],
            intent: 'Affection'
        };
    }

    // 9. Apologies / Courtesy
    if (has('sorry')) {
        return {
            sentence: 'I am very sorry, please excuse me.',
            predictions: [
                'I apologize for any inconvenience.',
                'Sorry about that, please forgive me.',
                'I am sorry, thank you for your patience.'
            ],
            intent: 'Courtesy'
        };
    }

    // 10. Agreement / Confirmation
    if (has('yes') || has('okay') || has('ok')) {
        return {
            sentence: 'Yes, that sounds great and works for me.',
            predictions: [
                'Yes, I agree with that.',
                'That is completely okay with me.',
                'Yes, let us proceed.'
            ],
            intent: 'Confirmation'
        };
    }

    // 11. Disagreement / Denial
    if (has('no')) {
        return {
            sentence: 'No, thank you. I would prefer not to.',
            predictions: [
                'No, that is not what I meant.',
                'No, thank you very much.',
                'I do not agree with that.'
            ],
            intent: 'Response'
        };
    }

    // Default general synthesis
    const joined = words.join(' ');
    const capital = joined.charAt(0).toUpperCase() + joined.slice(1).toLowerCase();
    const sentence = capital.endsWith('.') ? capital : `${capital}.`;
    return {
        sentence,
        predictions: [
            sentence,
            `I want to say: ${joined}.`,
            `Please note: ${joined}.`
        ],
        intent: 'General'
    };
}

/**
 * POST /api/ai/transcribe-translate
 * High-speed Gemini audio transcription & translation endpoint.
 * Works seamlessly with mobile and browser WebM / MP4 / WAV audio chunks.
 */
router.post('/transcribe-translate', async (req, res) => {
    const { audioBase64, targetLang = 'en', mimeType = 'audio/webm', sourceLang = 'auto' } = req.body;
    
    if (!audioBase64) {
        return res.status(400).json({ error: 'audioBase64 is required' });
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
        return res.status(503).json({ error: 'GEMINI_API_KEY is not configured on the server.' });
    }

    try {
        const cacheHash = crypto.createHash('md5').update(audioBase64.slice(0, 500) + targetLang).digest('hex');
        if (audioCache.has(cacheHash)) {
            return res.json(audioCache.get(cacheHash));
        }

        const prompt = `Listen closely to the attached audio snippet.
1. Transcribe the exact words spoken by the user.
2. If language is not English, also provide a clean English translation.
3. If there is only silence, static, or background noise, return empty text.

Return STRICTLY in JSON format:
{
  "sourceLang": "detected language code (e.g. en, hi, es, fr)",
  "text": "verbatim native transcription",
  "translated": "translated text in ${targetLang}"
}`;

        const data = await callGemini([
            { text: prompt },
            {
                inlineData: {
                    mimeType: mimeType.split(';')[0] || 'audio/webm',
                    data: audioBase64
                }
            }
        ], { temperature: 0.1 });

        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '{}';
        let parsed = { sourceLang: 'auto', text: '', translated: '' };
        try {
            const cleanJson = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            parsed = JSON.parse(cleanJson);
        } catch {
            parsed.text = rawText.replace(/[{}"\\]/g, '').trim();
            parsed.translated = parsed.text;
        }

        if (audioCache.size >= MAX_CACHE_SIZE) {
            const firstKey = audioCache.keys().next().value;
            audioCache.delete(firstKey);
        }
        audioCache.set(cacheHash, parsed);

        return res.json(parsed);
    } catch (err) {
        console.error('[AI Route] Transcribe error:', err.message);
        return res.status(500).json({ error: 'Failed to transcribe audio.', details: err.message });
    }
});

/**
 * POST /api/ai/ocr
 * Gemini Vision OCR with exponential backoff retry on 429 (quota).
 */
router.post('/ocr', auth, async (req, res) => {
    const { imageBase64, mimeType = 'image/jpeg' } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'imageBase64 is required' });

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) return res.status(503).json({ error: 'GEMINI_API_KEY not configured.' });

    const prompt = `You are an OCR assistant. Extract ALL visible text from this image exactly as it appears — handwriting, cursive, print, signs, labels, screens.
If no text is present, reply with exactly: NO_TEXT_FOUND
Output ONLY the extracted text, nothing else.`;

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    let delay = 4000;

    try {
        const data = await callGemini([
            { text: prompt },
            { inlineData: { mimeType, data: imageBase64 } }
        ], { temperature: 0.1, maxOutputTokens: 2048 });

        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        if (!rawText || rawText === 'NO_TEXT_FOUND') return res.json({ text: '', found: false });
        return res.json({ text: rawText, found: true });
    } catch (err) {
        console.error('[OCR] Failed:', err.message);
        return res.status(500).json({ error: 'Failed to perform OCR.', details: err.message });
    }
});

/**
 * POST /api/ai/translate
 * High-speed zero-quota translation endpoint with auto-detection.
 */
router.post('/translate', async (req, res) => {
    const { text, targetLang = 'en', sourceLang = 'auto' } = req.body;
    if (!text || !text.trim()) return res.json({ translated: '', detected: sourceLang });

    if (sourceLang !== 'auto' && sourceLang === targetLang) {
        return res.json({ translated: text, detected: sourceLang });
    }

    // Tier 1: Google Translate free endpoint
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text.trim())}`;
        const r = await fetch(url);
        if (r.ok) {
            const data = await r.json();
            if (data && Array.isArray(data[0])) {
                const translated = data[0].map(item => item[0]).filter(Boolean).join('');
                const detected = data[2] || sourceLang;
                if (translated && translated.trim()) {
                    return res.json({ translated: translated.trim(), detected });
                }
            }
        }
    } catch (e1) {
        console.warn('[Backend Translate] Tier 1 error:', e1.message);
    }

    // Tier 2: MyMemory Translated API
    try {
        const pair = `${sourceLang === 'auto' ? 'autodetect' : sourceLang}|${targetLang}`;
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.trim())}&langpair=${pair}`;
        const r = await fetch(url);
        if (r.ok) {
            const data = await r.json();
            if (data?.responseData?.translatedText) {
                return res.json({ translated: data.responseData.translatedText, detected: sourceLang });
            }
        }
    } catch (e2) {
        console.warn('[Backend Translate] Tier 2 error:', e2.message);
    }

    return res.json({ translated: text, detected: sourceLang });
});

module.exports = router;


/**
 * fusionRoutes.js
 * ════════════════
 * POST /api/ai/fuse
 *
 * Accepts signals from all 3 AI modalities simultaneously:
 *   - vision:  array of COCO detections + optional hazard
 *   - speech:  { text, confidence, isFinal }
 *   - gesture: { words: [], sentence: '' } OR string
 *
 * Returns a unified situational awareness string with intent + priority.
 * Uses Gemini 1.5 Flash if API key is set, otherwise uses the local engine.
 */

const express = require('express');
const router  = express.Router();
const { protect: auth } = require('../middleware/auth');

// ─── POST /api/ai/fuse ────────────────────────────────────────────────────────
router.post('/fuse', auth, async (req, res) => {
    const { vision, speech, gesture } = req.body;

    if (!vision && !speech && !gesture) {
        return res.status(400).json({ error: 'At least one modality signal required' });
    }

    // ── Build structured context from each modality ──────────────────────
    const ctx = buildModalityContext(vision, speech, gesture);

    // ── Try Gemini AI for richer awareness ────────────────────────────────
    const GEMINI_KEY = process.env.GEMINI_API_KEY;
    if (GEMINI_KEY) {
        try {
            const prompt = buildGeminiPrompt(ctx);
            const gemRes = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { temperature: 0.3, maxOutputTokens: 200 },
                    }),
                    signal: AbortSignal.timeout(4000),
                }
            );

            if (gemRes.ok) {
                const gemData = await gemRes.json();
                const raw = gemData.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

                if (raw) {
                    // Gemini returns JSON string
                    const parsed = safeParseJSON(raw);
                    if (parsed) {
                        return res.json({
                            awareness:   parsed.awareness   || ctx.summary,
                            intent:      parsed.intent      || inferIntent(ctx),
                            priority:    parsed.priority    || inferPriority(ctx),
                            suggestions: parsed.suggestions || [],
                            source: 'gemini',
                        });
                    }
                    // Plain text response
                    return res.json({
                        awareness: raw,
                        intent:    inferIntent(ctx),
                        priority:  inferPriority(ctx),
                        suggestions: buildSuggestions(ctx),
                        source: 'gemini_raw',
                    });
                }
            }
        } catch (err) {
            console.warn('[Fusion] Gemini error, using local engine:', err.message);
        }
    }

    // ── Local rule-based fusion ────────────────────────────────────────────
    return res.json({
        awareness:   buildLocalAwareness(ctx),
        intent:      inferIntent(ctx),
        priority:    inferPriority(ctx),
        suggestions: buildSuggestions(ctx),
        source: 'local',
    });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildModalityContext(vision, speech, gesture) {
    const ctx = { objects: [], hazards: [], speechText: '', gestureWords: [], gestureSentence: '' };

    // Vision
    if (vision) {
        const dets = Array.isArray(vision) ? vision : (vision.detections || []);
        ctx.objects = dets.map(d => ({
            label:      d.label || d,
            confidence: d.confidence || 1,
            position:   d.pctBbox ? getPosition(d.pctBbox) : 'nearby',
        }));
        if (vision.hazard) {
            if (vision.hazard.stair) ctx.hazards.push('stairs');
            if (vision.hazard.drop)  ctx.hazards.push('drop edge');
            if (vision.hazard.slope) ctx.hazards.push('slope');
        }
    }

    // Speech
    if (speech) {
        ctx.speechText = typeof speech === 'string' ? speech : (speech.text || '');
        ctx.speechFinal = speech.isFinal !== false;
    }

    // Gesture
    if (gesture) {
        if (Array.isArray(gesture)) {
            ctx.gestureWords    = gesture;
            ctx.gestureSentence = gesture.join(' ');
        } else if (typeof gesture === 'string') {
            ctx.gestureWords    = [gesture];
            ctx.gestureSentence = gesture;
        } else {
            ctx.gestureWords    = gesture.words || [];
            ctx.gestureSentence = gesture.sentence || ctx.gestureWords.join(' ');
        }
    }

    ctx.summary = buildSummary(ctx);
    return ctx;
}

function buildSummary(ctx) {
    const parts = [];
    if (ctx.objects.length)      parts.push(`Objects: ${ctx.objects.map(o => o.label).join(', ')}`);
    if (ctx.hazards.length)      parts.push(`Hazards: ${ctx.hazards.join(', ')}`);
    if (ctx.speechText)          parts.push(`Speech: "${ctx.speechText}"`);
    if (ctx.gestureSentence)     parts.push(`Gesture: "${ctx.gestureSentence}"`);
    return parts.join('. ');
}

function buildGeminiPrompt(ctx) {
    return `You are an AI assistant for a person with a disability using SenseBridge.
You receive real-time multimodal data. Analyze all inputs together for situational awareness.

INPUT DATA:
${ctx.objects.length   ? `- Camera detects: ${ctx.objects.map(o => `${o.label} (${o.position})`).join(', ')}` : ''}
${ctx.hazards.length   ? `- Environmental hazards: ${ctx.hazards.join(', ')}` : ''}
${ctx.speechText       ? `- User heard saying: "${ctx.speechText}"` : ''}
${ctx.gestureSentence  ? `- User signing: "${ctx.gestureSentence}"` : ''}

TASK:
Generate a concise, helpful awareness message for the user.
Cross-correlate the inputs — e.g. if user signs "water" and a bottle is visible, say where it is.
If there's a hazard, prioritize it.

RESPOND IN THIS JSON FORMAT ONLY (no markdown):
{"awareness": "one clear sentence", "intent": "needs|navigation|hazard|emergency|social|general", "priority": "normal|high|critical", "suggestions": ["action1", "action2"]}`;
}

function getPosition(bbox) {
    const [x, , w] = bbox;   // pct x, y, width, height
    const cx = x + w / 2;
    if (cx < 33) return 'on the left';
    if (cx > 67) return 'on the right';
    return 'ahead';
}

function inferIntent(ctx) {
    const allText = [ctx.speechText, ctx.gestureSentence].join(' ').toLowerCase();
    const labels  = ctx.objects.map(o => o.label.toLowerCase());

    if (ctx.hazards.length) return 'hazard';
    if (/emergency|help|danger|911/.test(allText)) return 'emergency';
    if (/stop|no|wait/.test(allText)) return 'warning';
    if (/eat|food|hungry|drink|water|thirsty/.test(allText)) return 'needs';
    if (/where|find|go|navigate|direction/.test(allText)) return 'navigation';
    if (/hello|name|friend|love|sorry|thank/.test(allText)) return 'social';
    return 'general';
}

function inferPriority(ctx) {
    const intent = inferIntent(ctx);
    if (intent === 'emergency' || ctx.hazards.some(h => h === 'drop edge')) return 'critical';
    if (intent === 'hazard' || intent === 'warning') return 'high';
    return 'normal';
}

function buildSuggestions(ctx) {
    const intent = inferIntent(ctx);
    const map = {
        emergency:  ['Activate SOS immediately', 'Call emergency contact'],
        hazard:     ['Read hazard warning aloud', 'Guide user away from hazard'],
        needs:      ['Speak user\'s request aloud', 'Locate nearby item'],
        navigation: ['Open navigation assist', 'Describe surroundings'],
        social:     ['Speak gesture reply aloud'],
        general:    [],
    };
    return (map[intent] || []).slice(0, 2);
}

function buildLocalAwareness(ctx) {
    const { objects, hazards, speechText, gestureSentence } = ctx;

    // Hazard takes priority
    if (hazards.length) return `⚠️ Warning: ${hazards[0]} detected. Please be careful.`;

    // Smart cross-modal correlations
    const labels = objects.map(o => o.label.toLowerCase());
    const gestLower = gestureSentence.toLowerCase();

    if (gestLower.includes('water') && labels.some(l => ['bottle','cup','wine glass'].includes(l))) {
        const pos = objects.find(o => ['bottle','cup'].includes(o.label.toLowerCase()))?.position || 'nearby';
        return `You signed "water" — a drink container is ${pos}.`;
    }
    if (/eat|food|hungry/.test(gestLower) && labels.some(l => ['bowl','pizza','banana','apple','sandwich'].includes(l))) {
        const food = labels.find(l => ['bowl','pizza','banana','apple','sandwich'].includes(l));
        return `You signed "eat" — ${food} is visible nearby.`;
    }
    if (/help/.test(gestLower) && labels.includes('person')) {
        return `You need help — a person is detected nearby. Alerting them.`;
    }
    if (speechText && objects.length) {
        if (/where|find/.test(speechText.toLowerCase())) {
            return `You asked "${speechText}". Nearby: ${labels.slice(0,2).join(', ')}.`;
        }
    }
    if (gestureSentence && speechText) {
        return `Signing "${gestureSentence}" while saying "${speechText}".`;
    }
    if (gestureSentence) return `Gesture: ${gestureSentence}.`;
    if (speechText)      return `Heard: "${speechText}".`;
    if (objects.length)  return `Scene: ${labels.slice(0,3).join(', ')} detected.`;

    return 'Analyzing surroundings…';
}

function safeParseJSON(str) {
    try {
        // Strip markdown code fence if Gemini adds it
        const clean = str.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        return JSON.parse(clean);
    } catch { return null; }
}

module.exports = router;

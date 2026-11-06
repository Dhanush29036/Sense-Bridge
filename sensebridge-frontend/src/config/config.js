/**
 * config.js — SenseBridge Application Configuration
 * ===================================================
 * Central configuration store for:
 *   - Confidence thresholds (configurable per modality)
 *   - Application modes
 *   - Temporal filtering settings (response spam prevention)
 *   - Ablation study settings
 *   - Privacy settings
 *   - Accessibility settings
 *
 * All threshold defaults can be overridden via localStorage
 * (for researcher customization during experiments).
 *
 * Usage:
 *   import { getConfig, updateConfig, resetConfig } from '../config/config';
 *   const cfg = getConfig();
 *   if (detectionConfidence >= cfg.thresholds.vision) { ... }
 */

// ─── Default Configuration ───────────────────────────────────────────────────

const DEFAULT_CONFIG = {
    // Confidence thresholds — minimum confidence required to act on a prediction
    // These are NOT hard-coded into model inference; they gate the response layer.
    thresholds: {
        vision:  0.50,   // Object detection minimum confidence
        ocr:     0.60,   // OCR minimum confidence
        gesture: 0.60,   // Gesture recognition minimum confidence
        speech:  null,   // Speech: use model-native threshold (Web Speech API / Whisper)
    },

    // Temporal filtering — prevent response spam for repeated detections
    temporal: {
        // How long (ms) before the same detection is announced again
        cooldownMs: {
            vision:  5000,   // 5s between same object announcements
            ocr:     8000,   // 8s between same OCR text announcements
            gesture: 3000,   // 3s between same gesture announcements
            speech:  0,      // Speech: always announce (user-initiated)
        },
        // Significant confidence change threshold to re-announce
        // (re-announce if confidence changes by more than this amount)
        reannounceConfidenceDelta: 0.20,
    },

    // Application modes
    modes: {
        // Currently active mode
        current: 'navigation',  // 'navigation' | 'text' | 'speech' | 'gesture' | 'multimodal'
    },

    // Fusion engine settings (mirror Python-side defaults)
    fusion: {
        enabled:      true,
        cooldownS:    5.0,
        speechPauseS: 3.0,
        bufferSize:   5,
    },

    // UI display preferences
    ui: {
        showAIDetails:   false,   // Show confidence, latency, modality in UI
        highContrast:    false,
        largeText:       false,
        fontScale:       1.0,     // 1.0 = default, 1.2 = large, 1.5 = very large
        voiceFeedback:   true,
        vibrationFeedback: true,
    },

    // Research / Experiment mode (hidden from normal users)
    research: {
        enabled:          false,   // Must be explicitly enabled
        experimentLogging: false,  // Opt-in only
        showDashboard:    false,
        activeSessionId:  null,
        ablation: {
            vision:  true,
            ocr:     true,
            speech:  true,
            gesture: true,
            fusion:  true,
        },
    },

    // Privacy
    privacy: {
        storeFrames:    false,   // Do NOT store camera frames
        storeAudio:     false,   // Do NOT store audio recordings
        anonymizeIds:   true,    // Session IDs are UUIDs (no PII)
        researchOptIn:  false,   // Research logging is opt-in
    },
};

// ─── Storage Key ─────────────────────────────────────────────────────────────

const STORAGE_KEY = 'sensebridge_config_v2';

// ─── Config Functions ─────────────────────────────────────────────────────────

/**
 * Get the current config, merged with defaults.
 * @returns {Object}
 */
export function getConfig() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            return deepMerge(DEFAULT_CONFIG, parsed);
        }
    } catch (e) {
        console.warn('[Config] Failed to load from localStorage:', e);
    }
    return deepMerge({}, DEFAULT_CONFIG);
}

/**
 * Update specific config keys (deep merge).
 * @param {Object} updates - Partial config object to merge
 */
export function updateConfig(updates) {
    const current = getConfig();
    const merged = deepMerge(current, updates);
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch (e) {
        console.warn('[Config] Failed to save to localStorage:', e);
    }
    return merged;
}

/**
 * Reset configuration to defaults.
 */
export function resetConfig() {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
        console.warn('[Config] Failed to reset:', e);
    }
    return deepMerge({}, DEFAULT_CONFIG);
}

/**
 * Get confidence threshold for a modality.
 * @param {string} modality - 'vision' | 'ocr' | 'gesture' | 'speech'
 * @returns {number|null}
 */
export function getThreshold(modality) {
    const cfg = getConfig();
    return cfg.thresholds[modality] ?? null;
}

/**
 * Update confidence threshold for a modality.
 * @param {string} modality
 * @param {number} value - New threshold [0.0, 1.0]
 */
export function setThreshold(modality, value) {
    return updateConfig({ thresholds: { [modality]: value } });
}

/**
 * Enable or disable research mode.
 * Research mode is hidden from normal users.
 * @param {boolean} enabled
 */
export function setResearchMode(enabled) {
    return updateConfig({ research: { enabled, showDashboard: enabled } });
}

/**
 * Get the active ablation configuration.
 * @returns {Object}
 */
export function getAblationConfig() {
    const cfg = getConfig();
    return cfg.research.ablation;
}

/**
 * Set the active ablation configuration.
 * @param {Object} ablation
 */
export function setAblationConfig(ablation) {
    return updateConfig({ research: { ablation } });
}

// ─── Mode Constants ───────────────────────────────────────────────────────────

export const APP_MODES = {
    NAVIGATION: 'navigation',
    TEXT:       'text',
    SPEECH:     'speech',
    GESTURE:    'gesture',
    MULTIMODAL: 'multimodal',
};

export const MODE_LABELS = {
    navigation: '🧭 Navigation',
    text:       '📖 Read Text',
    speech:     '🎙️ Speech',
    gesture:    '🤚 Gesture',
    multimodal: '🧠 Multimodal',
};

// ─── Response Priority ────────────────────────────────────────────────────────

export const RESPONSE_PRIORITY = {
    OBSTACLE:    1,   // Immediate obstacle/safety (HIGHEST)
    USER_REQUEST:2,   // User-requested information
    NAVIGATION:  3,   // Navigation information
    OCR:         4,   // OCR / text information
    GENERAL:     5,   // General contextual information (LOWEST)
};

// ─── Temporal Filter (Response Spam Prevention) ───────────────────────────────

/**
 * TemporalFilter — prevents the same detection from being announced repeatedly.
 *
 * Rules:
 *   1. Do not re-announce if same object seen within cooldownMs
 *   2. Re-announce if confidence changed significantly (> reannounceConfidenceDelta)
 *   3. Re-announce if object disappeared and reappeared
 */
export class TemporalFilter {
    constructor() {
        this._lastSeen = new Map();   // label → { time, confidence }
    }

    /**
     * Check if this detection should be announced.
     * @param {string} label
     * @param {number} confidence
     * @param {string} modality
     * @returns {boolean} - true if should announce
     */
    shouldAnnounce(label, confidence, modality = 'vision') {
        const cfg = getConfig();
        const cooldown = cfg.temporal.cooldownMs[modality] ?? 5000;
        const delta    = cfg.temporal.reannounceConfidenceDelta;

        const key = `${modality}:${label}`;
        const last = this._lastSeen.get(key);
        const now  = Date.now();

        if (!last) {
            this._lastSeen.set(key, { time: now, confidence });
            return true;
        }

        const elapsed     = now - last.time;
        const confChanged = Math.abs((confidence ?? 0) - (last.confidence ?? 0)) > delta;

        if (elapsed >= cooldown || confChanged) {
            this._lastSeen.set(key, { time: now, confidence });
            return true;
        }

        return false;
    }

    /** Clear all tracking state */
    reset() {
        this._lastSeen.clear();
    }

    /** Remove a specific label from tracking */
    forget(label, modality = 'vision') {
        this._lastSeen.delete(`${modality}:${label}`);
    }
}

// ─── Utility: Deep Merge ──────────────────────────────────────────────────────

function deepMerge(target, source) {
    const result = { ...target };
    for (const key of Object.keys(source)) {
        if (
            source[key] !== null &&
            typeof source[key] === 'object' &&
            !Array.isArray(source[key])
        ) {
            result[key] = deepMerge(target[key] ?? {}, source[key]);
        } else {
            result[key] = source[key];
        }
    }
    return result;
}

export default DEFAULT_CONFIG;

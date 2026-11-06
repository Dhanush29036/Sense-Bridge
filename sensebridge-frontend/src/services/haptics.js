/**
 * haptics.js — Cross-platform vibration & tactile feedback service
 * Works seamlessly in mobile browsers and Capacitor Android WebViews.
 */
import { getConfig } from '../config/config';

export const isVibrationEnabled = () => {
    try {
        const cfg = getConfig();
        if (cfg.ui?.vibrationFeedback !== undefined) {
            return !!cfg.ui.vibrationFeedback;
        }
        const local = localStorage.getItem('sb_vibration');
        if (local !== null) return local === 'true';
    } catch {}
    return true;
};

export const vibrate = (pattern = 30) => {
    if (!isVibrationEnabled()) return;
    try {
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
            navigator.vibrate(pattern);
        }
    } catch {
        // Vibration not supported or not allowed in current context
    }
};

export const haptics = {
    /** Light tap feedback for buttons and interactive controls (25ms) */
    tap: () => vibrate(25),

    /** Medium feedback for selections and toggles (45ms) */
    medium: () => vibrate(45),

    /** Success pattern for recognized gestures, logins, saved items (two crisp pulses) */
    success: () => vibrate([35, 45, 60]),

    /** Warning pulse for obstacles or attention alerts (buzz-pause-buzz) */
    warning: () => vibrate([70, 50, 90]),

    /** Urgent pattern for critical obstacle alerts or emergency triggers */
    error: () => vibrate([100, 60, 100, 60, 150]),

    /** Emergency SOS pattern — long strong pulses for maximum urgency */
    emergency: () => vibrate([200, 100, 200, 100, 200, 100, 400]),
};

export default haptics;

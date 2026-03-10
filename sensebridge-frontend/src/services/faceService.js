/**
 * faceService.js — SenseBridge Face Recognition
 *
 * Uses @vladmandic/face-api (browser-only, no server required):
 *   • SSD MobileNet v1 — fast face detector
 *   • 68-point face landmarks — required for descriptor
 *   • Face recognition model — 128-D embeddings, cosine similarity
 *
 * Models are loaded from jsDelivr CDN on first use.
 * Known faces are stored in localStorage as Float32Array descriptors.
 */

import * as faceapi from '@vladmandic/face-api';

// ── Model CDN ──────────────────────────────────────────────────────────────
const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/model/';

// ── Persistence ────────────────────────────────────────────────────────────
const STORAGE_KEY = 'sensebridge_known_faces';

export function loadKnownFaces() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        return JSON.parse(raw).map(f => ({
            name:       f.name,
            descriptor: new Float32Array(f.descriptor),
            addedAt:    f.addedAt || new Date().toISOString(),
        }));
    } catch { return []; }
}

export function saveKnownFace(name, descriptor) {
    const faces = loadKnownFaces();
    faces.push({ name, descriptor: Array.from(descriptor), addedAt: new Date().toISOString() });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(faces));
    return faces;
}

export function deleteKnownFace(name) {
    const faces = loadKnownFaces().filter(f => f.name !== name);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(
        faces.map(f => ({ ...f, descriptor: Array.from(f.descriptor) }))
    ));
    return faces;
}

// ── Model loading ──────────────────────────────────────────────────────────
let _modelsLoaded = false;

export async function loadModels() {
    if (_modelsLoaded) return;
    console.info('[Face] Loading models from CDN…');
    await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
    _modelsLoaded = true;
    console.info('[Face] Models ready ✓');
}

// ── Capture a single face descriptor from a video/image element ───────────
/**
 * Detect all faces in a frame and return their descriptors.
 * @param {HTMLVideoElement|HTMLImageElement} source
 * @returns {Promise<Array<{descriptor: Float32Array, box: {x,y,w,h}, score: number}>>}
 */
export async function detectFaces(source) {
    if (!_modelsLoaded) throw new Error('Models not loaded yet');
    const detections = await faceapi
        .detectAllFaces(source, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
        .withFaceLandmarks()
        .withFaceDescriptors();

    return detections.map(d => ({
        descriptor: d.descriptor,
        box: {
            x: d.detection.box.x,
            y: d.detection.box.y,
            w: d.detection.box.width,
            h: d.detection.box.height,
        },
        score: d.detection.score,
    }));
}

// ── Build a matcher from known faces ──────────────────────────────────────
/**
 * Build a FaceMatcher from the stored known faces.
 * @param {Array} knownFaces  — from loadKnownFaces()
 * @param {number} threshold  — Euclidean distance (0.4 = strict, 0.6 = relaxed)
 */
export function buildMatcher(knownFaces, threshold = 0.5) {
    if (!knownFaces.length) return null;

    // Group descriptors by name (a person can have multiple samples)
    const byName = {};
    for (const f of knownFaces) {
        if (!byName[f.name]) byName[f.name] = [];
        byName[f.name].push(f.descriptor);
    }

    const labeled = Object.entries(byName).map(
        ([name, descriptors]) =>
            new faceapi.LabeledFaceDescriptors(name, descriptors)
    );

    return new faceapi.FaceMatcher(labeled, threshold);
}

// ── Match detected faces against known ────────────────────────────────────
/**
 * @param {Array}       detected   — from detectFaces()
 * @param {FaceMatcher} matcher    — from buildMatcher()
 * @returns {Array<{name, distance, box, unknown}>}
 */
export function matchFaces(detected, matcher) {
    if (!matcher || !detected.length) return [];
    return detected.map(d => {
        const result  = matcher.findBestMatch(d.descriptor);
        const unknown = result.label === 'unknown';
        return {
            name:     unknown ? null : result.label,
            distance: result.distance,
            box:      d.box,
            score:    d.score,
            unknown,
        };
    });
}

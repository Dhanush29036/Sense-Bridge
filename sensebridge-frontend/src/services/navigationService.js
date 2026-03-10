/**
 * navigationService.js — Smart Path Guidance
 *
 * Uses 100% free APIs — no API key required:
 *   • Nominatim (OpenStreetMap) — geocoding / reverse-geocoding
 *   • OSRM public API           — pedestrian turn-by-turn routing
 *   • Overpass API              — OSM POIs (sidewalks, crossings, hazards)
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const OSRM      = 'https://router.project-osrm.org/route/v1/foot';
const OVERPASS  = 'https://overpass-api.de/api/interpreter';

// ── Geocoding ──────────────────────────────────────────────────────────────

/** Search a place name → [{ lat, lon, display_name }] */
export async function searchPlace(query) {
    if (!query.trim()) return [];
    const url = `${NOMINATIM}/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1`;
    const res  = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    return res.json();
}

/** Reverse-geocode GPS coords → human-readable address string */
export async function reverseGeocode(lat, lon) {
    const res = await fetch(
        `${NOMINATIM}/reverse?lat=${lat}&lon=${lon}&format=json`,
        { headers: { 'Accept-Language': 'en' } }
    );
    const data = await res.json();
    return data.display_name || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

// ── OSRM Pedestrian Routing ────────────────────────────────────────────────

/**
 * Calculate walking route between two [lat,lon] points using OSRM.
 * Returns { steps, polyline, totalDistance, totalDuration, summary }
 */
export async function getWalkingRoute(fromLatLon, toLatLon) {
    const [fLat, fLon] = fromLatLon;
    const [tLat, tLon] = toLatLon;
    const url = `${OSRM}/${fLon},${fLat};${tLon},${tLat}?steps=true&geometries=geojson&overview=full&annotations=false`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OSRM error ${res.status}`);
    const data = await res.json();

    if (data.code !== 'Ok' || !data.routes?.length) {
        throw new Error('No route found. Try a different destination.');
    }

    const route = data.routes[0];
    const leg   = route.legs[0];

    const steps = leg.steps.map((s, i) => ({
        id:           i,
        instruction:  buildInstruction(s),
        distance:     s.distance,          // metres
        duration:     s.duration,          // seconds
        direction:    s.maneuver?.modifier || 'straight',
        type:         s.maneuver?.type     || 'turn',
        bearing:      s.maneuver?.bearing_after ?? 0,
        location:     s.maneuver?.location,  // [lon, lat]
    }));

    return {
        steps,
        polyline: route.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
        totalDistance: route.distance,   // metres
        totalDuration: route.duration,   // seconds
        summary: `${formatDist(route.distance)} · ~${formatTime(route.duration)}`,
    };
}

// ── Overpass: nearby sidewalks, crossings, hazards ────────────────────────

/**
 * Fetch pedestrian-relevant OSM features within `radius` metres of a point.
 * Returns arrays of { type, lat, lon, tags }
 */
export async function getNearbyPedestrianFeatures(lat, lon, radius = 100) {
    const query = `
        [out:json][timeout:10];
        (
          way["highway"="footway"](around:${radius},${lat},${lon});
          way["highway"="pedestrian"](around:${radius},${lat},${lon});
          node["highway"="crossing"](around:${radius},${lat},${lon});
          node["highway"="traffic_signals"](around:${radius},${lat},${lon});
          node["kerb"](around:${radius},${lat},${lon});
          way["highway"="steps"](around:${radius},${lat},${lon});
        );
        out center;
    `.trim();

    try {
        const res = await fetch(OVERPASS, {
            method: 'POST',
            body: `data=${encodeURIComponent(query)}`,
        });
        const data = await res.json();
        return data.elements?.map(el => ({
            type:    el.tags?.highway || el.tags?.kerb || 'unknown',
            lat:     el.lat ?? el.center?.lat,
            lon:     el.lon ?? el.center?.lon,
            tags:    el.tags || {},
        })).filter(f => f.lat && f.lon) || [];
    } catch {
        return [];
    }
}

// ── Navigation State Machine ───────────────────────────────────────────────

/**
 * Given user's current GPS position and the route steps,
 * returns { currentStepIdx, distanceToNext, nearingTurn, arrived }
 */
export function computeNavigationState(userLatLon, steps, currentStepIdx) {
    if (!steps.length) return { currentStepIdx: 0, distanceToNext: 0, nearingTurn: false, arrived: false };

    const step = steps[currentStepIdx];
    if (!step) return { currentStepIdx, distanceToNext: 0, nearingTurn: false, arrived: true };

    const nextStep = steps[currentStepIdx + 1];
    if (!nextStep) return { currentStepIdx, distanceToNext: 0, nearingTurn: false, arrived: true };

    const turnPoint = nextStep.location ? [nextStep.location[1], nextStep.location[0]] : null;
    if (!turnPoint) return { currentStepIdx, distanceToNext: step.distance, nearingTurn: false, arrived: false };

    const dist    = haversine(userLatLon, turnPoint);
    const nearing = dist < 15; // within 15m of the turn point
    const advance = dist < 8;  // "passed" the turn point

    return {
        currentStepIdx: advance ? Math.min(currentStepIdx + 1, steps.length - 1) : currentStepIdx,
        distanceToNext: Math.round(dist),
        nearingTurn:    nearing,
        arrived:        currentStepIdx === steps.length - 1 && dist < 20,
    };
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Haversine distance in metres between two [lat, lon] points */
export function haversine([lat1, lon1], [lat2, lon2]) {
    const R  = 6371000;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;
    const a  = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDist(m) {
    return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

export function formatTime(s) {
    const m = Math.round(s / 60);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

// Build a human-readable instruction from OSRM step maneuver
function buildInstruction(step) {
    const type     = step.maneuver?.type;
    const modifier = step.maneuver?.modifier;
    const name     = step.name || 'the unnamed road';
    const dist     = formatDist(step.distance);

    if (type === 'depart')         return `Head ${modifier || 'forward'} on ${name} for ${dist}`;
    if (type === 'arrive')         return 'You have arrived at your destination';
    if (type === 'turn') {
        if (modifier === 'left')        return `Turn left onto ${name} — ${dist}`;
        if (modifier === 'right')       return `Turn right onto ${name} — ${dist}`;
        if (modifier === 'sharp left')  return `Turn sharply left onto ${name} — ${dist}`;
        if (modifier === 'sharp right') return `Turn sharply right onto ${name} — ${dist}`;
        if (modifier === 'slight left') return `Slight left onto ${name} — ${dist}`;
        if (modifier === 'slight right')return `Slight right onto ${name} — ${dist}`;
        return `Continue on ${name} — ${dist}`;
    }
    if (type === 'continue')       return `Continue on ${name} for ${dist}`;
    if (type === 'roundabout')     return `Enter the roundabout and take the exit onto ${name}`;
    if (type === 'fork') {
        return modifier?.includes('left')
            ? `Keep left onto ${name} — ${dist}`
            : `Keep right onto ${name} — ${dist}`;
    }
    return `Continue for ${dist}`;
}

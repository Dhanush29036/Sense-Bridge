/**
 * NavigationPage.jsx — Smart Path Guidance
 *
 * Features:
 *  • Live GPS tracking on OpenStreetMap (Leaflet + react-leaflet)
 *  • Destination search (Nominatim)
 *  • Pedestrian routing (OSRM)
 *  • Live turn-by-turn voice instructions (Web Speech API)
 *  • Nearby sidewalk / crossing / hazard detection (Overpass)
 *  • Auto-advance navigation steps as user walks
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Polyline, Popup, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import AppLayout from '../layouts/AppLayout';
import {
    searchPlace, reverseGeocode, getWalkingRoute,
    getNearbyPedestrianFeatures, computeNavigationState,
    haversine, formatDist, formatTime,
} from '../services/navigationService';
import { speak, cancelSpeech } from '../services/aiService';
import haptics from '../services/haptics';
import {
    Navigation, MapPin, Search, Play, Square,
    ChevronRight, Volume2, VolumeX, AlertTriangle, ArrowLeft,
    ArrowRight, ArrowUp, Crosshair, Loader, RotateCcw,
    ShieldAlert, Bell, Sparkles
} from 'lucide-react';

// Fix Leaflet default icon paths (Vite asset hashing breaks them)
import 'leaflet/dist/leaflet.css';
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// ── Hazard & Warning Spoken Definitions with Live Distance ─────────────────
const HAZARD_INFO = {
    steps: {
        title: 'Stairs / Steps Ahead',
        icon: '🪜',
        spoken: (d) => `Watch out! Stairs ${d} meters ahead. Watch your step and proceed slowly.`,
        advice: 'Staircase or elevation change ahead. Watch your footing.',
        color: '#FF6B6B',
        badge: 'Warning'
    },
    crossing: {
        title: 'Pedestrian Crossing Ahead',
        icon: '🦓',
        spoken: (d) => `Watch out! Pedestrian crossing ${d} meters ahead. Look both ways before crossing.`,
        advice: 'Zebra crossing. Look both ways before proceeding.',
        color: '#FFA94D',
        badge: 'Caution'
    },
    traffic_signals: {
        title: 'Traffic Signals Ahead',
        icon: '🚦',
        spoken: (d) => `Traffic lights ${d} meters ahead. Wait for the green pedestrian signal.`,
        advice: 'Wait for the pedestrian signal before crossing.',
        color: '#FFD43B',
        badge: 'Notice'
    },
    kerb: {
        title: 'Curb Drop Ahead',
        icon: '⚠️',
        spoken: (d) => `Watch out! Curb drop ${d} meters ahead. Step down carefully.`,
        advice: 'Pavement drop or uneven kerb ahead.',
        color: '#FF922B',
        badge: 'Caution'
    },
    construction: {
        title: 'Construction Zone Ahead',
        icon: '🚧',
        spoken: (d) => `Watch out! Construction zone ${d} meters ahead. Divert slightly and go carefully.`,
        advice: 'Construction work or blocked walkway.',
        color: '#FA5252',
        badge: 'Warning'
    },
    obstacle: {
        title: 'Obstacle Ahead',
        icon: '🛑',
        spoken: (d) => `Watch out! Obstacle ${d} meters ahead in your path. Go around it.`,
        advice: 'Object detected directly in front of you. Divert your path.',
        color: '#F03E3E',
        badge: 'Hazard'
    },
    drop: {
        title: 'Drop Edge Ahead',
        icon: '⛔',
        spoken: (d) => `Danger! Drop edge ${d} meters ahead. Stop immediately!`,
        advice: 'Steep ledge or platform drop ahead.',
        color: '#E03131',
        badge: 'Danger'
    },
    footway: {
        title: 'Sidewalk / Footway Ahead',
        icon: '🚶',
        spoken: (d) => `Pedestrian sidewalk ${d} meters ahead. Continue straight.`,
        advice: 'Safe pedestrian path available.',
        color: '#20C997',
        badge: 'Safe Path'
    },
    slope: {
        title: 'Incline / Slope Ahead',
        icon: '📐',
        spoken: (d) => `Watch out! Incline or slope ${d} meters ahead. Watch your footing.`,
        advice: 'Slope or ramp ahead. Watch your footing.',
        color: '#6C63FF',
        badge: 'Caution'
    }
};

// Acoustic warning beep using Web Audio API
// A singleton AudioContext is reused to prevent Android suspension issues
let _navAudioCtx = null;
const getNavAudioCtx = () => {
    try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        if (!_navAudioCtx || _navAudioCtx.state === 'closed') {
            _navAudioCtx = new AC();
        }
        if (_navAudioCtx.state === 'suspended') {
            _navAudioCtx.resume().catch(() => {});
        }
        return _navAudioCtx;
    } catch { return null; }
};

let _lastNavBeepTime = 0;
const playWarningBeep = (freq = 880, duration = 120) => {
    try {
        const now = Date.now();
        if (now - _lastNavBeepTime < 2200) return;
        _lastNavBeepTime = now;
        const ctx = getNavAudioCtx();
        if (!ctx) return;
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration / 1000);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + duration / 1000);
    } catch {}
};

// ── Custom icons ──────────────────────────────────────────────────────────
const userIcon = L.divIcon({
    html: `<div style="width:18px;height:18px;border-radius:50%;background:#6c63ff;border:3px solid #fff;box-shadow:0 0 12px rgba(108,99,255,0.8)"></div>`,
    className: '', iconAnchor: [9, 9],
});
const destIcon = L.divIcon({
    html: `<div style="width:18px;height:18px;border-radius:50%;background:#FF4B6E;border:3px solid #fff;box-shadow:0 0 10px rgba(255,75,110,0.7)"></div>`,
    className: '', iconAnchor: [9, 9],
});
const crossingIcon = L.divIcon({
    html: `<div style="width:14px;height:14px;border-radius:50%;background:#FFA94D;border:2px solid #fff;font-size:8px;line-height:14px;text-align:center">🚶</div>`,
    className: '', iconAnchor: [7, 7],
});

// ── MapController: keep map centred on user ────────────────────────────────
function MapController({ center, follow }) {
    const map = useMap();
    useEffect(() => {
        if (follow && center) map.setView(center, map.getZoom(), { animate: true });
    }, [center, follow, map]);
    return null;
}

// ── Direction arrow icon ───────────────────────────────────────────────────
const ARROW_ICONS = {
    left:        <ArrowLeft  size={28} style={{ color: '#FFA94D' }} />,
    right:       <ArrowRight size={28} style={{ color: '#FFA94D' }} />,
    straight:    <ArrowUp    size={28} style={{ color: '#00D4AA' }} />,
    'sharp left':  <ArrowLeft  size={28} style={{ color: '#FF4B6E' }} />,
    'sharp right': <ArrowRight size={28} style={{ color: '#FF4B6E' }} />,
};

function DirectionArrow({ modifier }) {
    return ARROW_ICONS[modifier] || ARROW_ICONS.straight;
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════
const NavigationPage = () => {
    const [userPos, setUserPos]         = useState(null);   // [lat, lon]
    const [userAddr, setUserAddr]       = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [suggestions, setSuggestions] = useState([]);
    const [destination, setDestination] = useState(null);   // { lat, lon, name }
    const [route, setRoute]             = useState(null);    // { steps, polyline, … }
    const [currentStep, setCurrentStep] = useState(0);
    const [distToNext, setDistToNext]   = useState(null);
    const [navigating, setNavigating]   = useState(false);
    const [followUser, setFollowUser]   = useState(true);
    const [loading, setLoading]         = useState('');      // status message
    const [error, setError]             = useState('');
    const [nearbyFeatures, setNearbyFeatures] = useState([]);
    const [activeWarnings, setActiveWarnings] = useState([]); // warnings with live distance
    const [lastSpokenStep, setLastSpokenStep] = useState(-1);
    const [lastSpokenAlert, setLastSpokenAlert] = useState('');
    const [voiceAlertsEnabled, setVoiceAlertsEnabled] = useState(true);
    const [autoNavigateActive, setAutoNavigateActive] = useState(false);
    const [pendingAutoStartPlace, setPendingAutoStartPlace] = useState(null);

    const location = useLocation();
    const routerNavigate = useNavigate();

    const watchIdRef            = useRef(null);
    const searchTimer           = useRef(null);
    const announcedWarningsRef  = useRef(new Map());
    const lastSpokenTurnRef     = useRef({ stepIdx: -1, phase: '' });
    const lastFeatureFetchRef   = useRef(0);

    // ── Voice warning announcement with acoustic beep & distance ─────────
    // Implements Eq. (7) Adaptive Spatio-Temporal Throttling Filter:
    // A_emit(l,t) = 1 if (t - t_last(l) > tau_cd) OR (Delta d / Delta t < -v_crit)
    // where tau_cd = 16.0s baseline cooldown and v_crit = 1.8 m/s rapid approach override
    const announceWarning = useCallback((message, key, isHighPriority = false, currentDist = 10) => {
        if (!voiceAlertsEnabled) return;
        const now = Date.now();
        const prev = announcedWarningsRef.current.get(key);
        const lastSpoken = prev ? prev.time : 0;
        const lastDist = prev ? prev.dist : currentDist;

        const dtSeconds = (now - lastSpoken) / 1000;
        const deltaD = currentDist - lastDist;
        const approachVelocity = dtSeconds > 0 ? -(deltaD / dtSeconds) : 0;
        const rapidApproach = approachVelocity >= 1.8; // v_crit = 1.8 m/s

        // tau_cd = 16.0 s baseline landmark cooldown, rapid approach overrides cooldown
        if (lastSpoken > 0 && dtSeconds < 16.0 && !rapidApproach && !isHighPriority) {
            return;
        }

        announcedWarningsRef.current.set(key, { time: now, dist: currentDist });
        setLastSpokenAlert(message);
        playWarningBeep(isHighPriority ? 960 : 840, 140);
        haptics.warning();
        speak(message, { priority: isHighPriority ? 'critical' : 'high', rate: 1.05 });
    }, [voiceAlertsEnabled]);

    // ── Announce turn step with exact distance & directional steering ────
    const announceStepWithDistance = useCallback((stepObj, stepIdx) => {
        if (!stepObj) return;
        const clean = stepObj.instruction?.split('—')?.[0]?.trim() || stepObj.instruction || '';
        const lower = clean.toLowerCase();
        let steerSuffix = '';
        if (lower.includes('left')) {
            steerSuffix = ' Go left.';
        } else if (lower.includes('right')) {
            steerSuffix = ' Go right.';
        } else if (lower.includes('straight') || lower.includes('continue') || lower.includes('head')) {
            steerSuffix = ' Continue straight.';
        }

        let textToSpeak = `${clean}.${steerSuffix}`;
        if (stepIdx === currentStep && distToNext !== null) {
            textToSpeak = distToNext < 15
                ? `Turn now! In ${distToNext} meters, ${clean}.${steerSuffix}`
                : `In ${distToNext} meters, ${clean}.${steerSuffix}`;
        } else if (stepObj.distance != null) {
            textToSpeak = `${clean}.${steerSuffix} Distance: ${formatDist(stepObj.distance)}`;
        }
        setLastSpokenStep(stepIdx);
        setLastSpokenAlert(textToSpeak);
        playWarningBeep(720, 100);
        speak(textToSpeak, { priority: 'high', rate: 1.0 });
    }, [currentStep, distToNext]);

    const announceStep = useCallback((text, idx) => {
        announceStepWithDistance(route?.steps?.[idx] || { instruction: text }, idx);
    }, [route, announceStepWithDistance]);

    // ── Quick simulation trigger for testing distance alerts ─────────────
    const triggerSimulatedWarning = (type, dist) => {
        const info = HAZARD_INFO[type] || HAZARD_INFO.obstacle;
        const msg = info.spoken(dist);
        playWarningBeep(880, 140);
        haptics.warning();
        setLastSpokenAlert(msg);
        speak(msg, { priority: 'high', rate: 1.05 });
    };

    // ── Listen to vision signals for camera obstacle detection ───────────
    useEffect(() => {
        const onVisionSignal = (e) => {
            const d = e.detail;
            if (!d) return;

            if (d.hazard) {
                // Structured hazard from analyzeFrameForHazards (stair/drop/slope)
                const h = d.hazard;
                const hazardType = h.stair ? 'steps' : h.drop ? 'drop' : 'slope';
                const depthMeters = h.depth ? Math.round(h.depth) : (h.drop ? 1 : 3);
                const info = HAZARD_INFO[hazardType] || HAZARD_INFO.obstacle;
                const msg = info.spoken ? info.spoken(depthMeters) : `Warning: ${hazardType} ahead, ${depthMeters} meters.`;
                announceWarning(msg, `vision-hazard-${hazardType}`, true);
                setActiveWarnings(prev => {
                    const filtered = prev.filter(w => w.type !== hazardType);
                    return [{ type: hazardType, distance: depthMeters, source: 'camera' }, ...filtered].slice(0, 8);
                });

            } else if (d.detections && Array.isArray(d.detections)) {
                // Array of detections from camera object detection loop
                for (const det of d.detections) {
                    const dist = det.pctBbox ? (() => {
                        const area = det.pctBbox[2] * det.pctBbox[3];
                        if (area > 160 || det.pctBbox[2] > 15 || det.pctBbox[3] > 22) return 1;
                        if (area > 20 || det.pctBbox[2] > 4 || det.pctBbox[3] > 6) return 2;
                        return 3;
                    })() : 2;
                    const name = det.label || 'obstacle';
                    const cx = det.pctBbox ? (det.pctBbox[0] + det.pctBbox[2] / 2) : 50;
                    const steer = cx >= 50 ? 'Go left.' : 'Go right.';
                    const isUrgent = dist <= 1;
                    const msg = isUrgent
                        ? `Watch out! ${name} directly ahead! ${steer} now!`
                        : `Watch out! ${name} ${dist} meters ahead. ${steer}`;
                    announceWarning(msg, `vision-det-${name}`, isUrgent, dist);
                    setActiveWarnings(prev => {
                        const filtered = prev.filter(w => !(w.type === 'obstacle' && w.name === name));
                        return [{ type: 'obstacle', distance: dist, name, source: 'camera' }, ...filtered].slice(0, 8);
                    });
                }

            } else if (d.obstacle || (d.label && d.distance === 'close')) {
                // Close-obstacle signal
                const name = d.obstacle || d.label;
                const msg = `Watch out! ${name} directly ahead! Go left or right around it.`;
                announceWarning(msg, `vision-close-${name}`, true, 1);
                setActiveWarnings(prev => {
                    const filtered = prev.filter(w => !(w.type === 'obstacle' && w.name === name));
                    return [{ type: 'obstacle', distance: 1, name, source: 'camera' }, ...filtered].slice(0, 8);
                });
            }
        };
        window.addEventListener('sb:vision', onVisionSignal);
        return () => window.removeEventListener('sb:vision', onVisionSignal);
    }, [announceWarning]);

    // ── GPS tracking & Hazard Proximity Monitor ──────────────────────────
    const startGPS = useCallback(() => {
        if (!navigator.geolocation) { setError('Geolocation not supported.'); return; }
        watchIdRef.current = navigator.geolocation.watchPosition(
            async (pos) => {
                const { latitude: lat, longitude: lon, accuracy } = pos.coords;
                const newPos = [lat, lon];
                setUserPos(newPos);

                // Reverse geocode occasionally
                if (!userAddr) {
                    reverseGeocode(lat, lon).then(setUserAddr).catch(() => {});
                }

                // 1. Update navigation state & announce turn with distance
                if (navigating && route) {
                    setCurrentStep(prev => {
                        const state = computeNavigationState(newPos, route.steps, prev);
                        setDistToNext(state.distanceToNext);

                        const curStep = route.steps[state.currentStepIdx];
                        const clean = curStep?.instruction?.split('—')?.[0]?.trim() || curStep?.instruction || '';

                        if (state.arrived) {
                            announceWarning('You have arrived at your destination!', 'arrival', true);
                            setNavigating(false);
                        } else if (state.distanceToNext <= 15 && lastSpokenTurnRef.current.phase !== `now-${state.currentStepIdx}`) {
                            // Imminent turn: "Turn now! In 12 meters, turn left..."
                            lastSpokenTurnRef.current = { stepIdx: state.currentStepIdx, phase: `now-${state.currentStepIdx}` };
                            announceWarning(`Turn now! In ${state.distanceToNext} meters, ${clean}`, `turn-now-${state.currentStepIdx}`, true);
                        } else if (state.distanceToNext <= 50 && state.distanceToNext > 15 && lastSpokenTurnRef.current.phase !== `pre-${state.currentStepIdx}`) {
                            // Approaching turn: "In 35 meters, turn left..."
                            lastSpokenTurnRef.current = { stepIdx: state.currentStepIdx, phase: `pre-${state.currentStepIdx}` };
                            announceWarning(`In ${state.distanceToNext} meters, ${clean}`, `turn-pre-${state.currentStepIdx}`, false);
                        }

                        return state.currentStepIdx;
                    });
                }

                // 2. Fetch or update nearby pedestrian features & hazards
                const now = Date.now();
                if (now - lastFeatureFetchRef.current > 18000 || nearbyFeatures.length === 0) {
                    lastFeatureFetchRef.current = now;
                    getNearbyPedestrianFeatures(lat, lon, 100).then(features => {
                        if (features && features.length) setNearbyFeatures(features);
                    }).catch(() => {});
                }

                // 3. Compute live distance to all nearby features & announce close hazards aloud
                if (nearbyFeatures.length > 0) {
                    const withDist = nearbyFeatures.map(f => ({
                        ...f,
                        distance: Math.round(haversine(newPos, [f.lat, f.lon])),
                    })).sort((a, b) => a.distance - b.distance);

                    setActiveWarnings(withDist.filter(f => f.distance <= 60));

                    // Check for nearest hazard within 40m
                    const nearestHazard = withDist.find(f =>
                        f.distance <= 40 &&
                        ['steps', 'crossing', 'traffic_signals', 'kerb', 'construction', 'obstacle', 'drop'].includes(f.type)
                    );

                    if (nearestHazard) {
                        const info = HAZARD_INFO[nearestHazard.type] || HAZARD_INFO.obstacle;
                        const msg = info.spoken(nearestHazard.distance);
                        const key = `${nearestHazard.type}-${Math.round(nearestHazard.lat * 1000)}-${Math.round(nearestHazard.lon * 1000)}`;
                        announceWarning(msg, key, ['steps', 'obstacle', 'drop'].includes(nearestHazard.type));
                    }
                }
            },
            (err) => setError(`GPS error: ${err.message}`),
            { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
        );
    }, [navigating, route, userAddr, nearbyFeatures, announceWarning]);

    // ── Start / Stop navigation ───────────────────────────────────────────
    const stopNavigation = useCallback(() => {
        setNavigating(false);
        cancelSpeech();
        speak('Navigation stopped.', { priority: 'high' });
    }, []);

    const startNavigation = useCallback(() => {
        if (!route) {
            speak('Please search or select a destination first to start navigation.', { priority: 'high' });
            return;
        }
        setNavigating(true);
        setCurrentStep(0);
        setLastSpokenStep(-1);
        lastSpokenTurnRef.current = { stepIdx: -1, phase: '' };
        const firstStep = route.steps?.[0];
        if (firstStep) {
            const clean = firstStep.instruction?.split('—')?.[0]?.trim() || firstStep.instruction || 'Proceed straight';
            const distText = distToNext ? `${distToNext} meters` : formatDist(firstStep.distance || 15);
            const msg = `Starting navigation. First direction: ${clean}. In ${distText}.`;
            announceWarning(msg, 'nav-start', true);
        }
        if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);
        startGPS();
    }, [route, distToNext, startGPS, announceWarning]);

    // ── Speak current direction on demand ─────────────────────────────────
    const speakCurrentDirection = useCallback(() => {
        if (!route || !route.steps) {
            speak('No active route. Please search or pick a destination first.', { priority: 'high' });
            return;
        }
        const cur = route.steps[currentStep];
        if (!cur) return;
        const clean = cur.instruction?.split('—')?.[0]?.trim() || cur.instruction || '';
        const distMsg = distToNext !== null ? `In ${distToNext} meters, ` : (cur.distance ? `For ${formatDist(cur.distance)}, ` : '');
        const fullMsg = `Direction guidance: ${distMsg}${clean}.`;
        playWarningBeep(880, 120);
        setLastSpokenAlert(fullMsg);
        speak(fullMsg, { priority: 'high', rate: 1.0 });
    }, [route, currentStep, distToNext]);

    // ── Voice command support (vc:start / vc:stop / vc:direction) ─────────
    useEffect(() => {
        const onStart     = () => { if (route) startNavigation(); else speak('Please search or select a destination first to start navigation.', { priority: 'high' }); };
        const onStop      = () => stopNavigation();
        const onDirection = () => speakCurrentDirection();

        window.addEventListener('vc:start',     onStart);
        window.addEventListener('vc:stop',      onStop);
        window.addEventListener('vc:direction', onDirection);
        return () => {
            window.removeEventListener('vc:start',     onStart);
            window.removeEventListener('vc:stop',      onStop);
            window.removeEventListener('vc:direction', onDirection);
        };
    }, [route, startNavigation, stopNavigation, speakCurrentDirection]);

    useEffect(() => {
        startGPS();
        // Announce page load so the user knows navigation opened
        setTimeout(() => {
            speak('Navigation page opened. Search for a destination using the search box, or say navigate to followed by your destination.', { priority: 'high' });
        }, 600);
        return () => {
            if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Pre-fill destination from voice command ────────────────────────────
    useEffect(() => {
        if (location.state?.destinationQuery) {
            setSearchQuery(location.state.destinationQuery);
            if (location.state.autoNavigate) setAutoNavigateActive(true);
            routerNavigate(location.pathname, { replace: true, state: {} });
        }
        // If opened via voice "start navigation" with no destination, announce prompt
        if (location.state?.autoStart && !location.state?.destinationQuery) {
            setTimeout(() => {
                speak('Navigation is ready. Where would you like to go? Use the search box to enter your destination.', { priority: 'high' });
            }, 800);
            routerNavigate(location.pathname, { replace: true, state: {} });
        }
    }, [location.state, location.pathname, routerNavigate]);

    // ── Destination search with debounce ──────────────────────────────────
    useEffect(() => {
        clearTimeout(searchTimer.current);
        if (searchQuery.length < 3) { setSuggestions([]); return; }
        searchTimer.current = setTimeout(async () => {
            try {
                const results = await searchPlace(searchQuery);
                setSuggestions(results.slice(0, 5));
                if (autoNavigateActive && results.length > 0) {
                    setAutoNavigateActive(false);
                    setPendingAutoStartPlace(results[0]);
                }
            } catch { setSuggestions([]); }
        }, 400);
    }, [searchQuery, autoNavigateActive]);

    // ── Process pending auto-start once GPS is available ──────────────────
    useEffect(() => {
        if (pendingAutoStartPlace && userPos && !loading) {
            const runAutoStart = async () => {
                const place = pendingAutoStartPlace;
                setPendingAutoStartPlace(null);
                
                setSuggestions([]);
                setSearchQuery(place.display_name.split(',')[0]);
                const dest = { lat: parseFloat(place.lat), lon: parseFloat(place.lon), name: place.display_name.split(',').slice(0, 2).join(', ') };
                setDestination(dest);
                setError('');
                setLoading('Calculating route…');

                try {
                    const r = await getWalkingRoute(userPos, [dest.lat, dest.lon]);
                    setRoute(r);
                    setCurrentStep(0);
                    setLoading('');
                    speak(`Route found. ${r.summary}. Let's go!`, { priority: 'high' });
                    
                    // Auto-trigger navigation
                    setNavigating(true);
                    setLastSpokenStep(-1);
                    if (r.steps[0]) announceStepWithDistance(r.steps[0], 0);
                    setTimeout(() => {
                        if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);
                        startGPS();
                    }, 50);
                } catch (e) {
                    setError(e.message);
                    setLoading('');
                }
            };
            runAutoStart();
        }
    }, [pendingAutoStartPlace, userPos, loading, startGPS, announceStepWithDistance]);

    // ── Select a destination from suggestions ─────────────────────────────
    const selectDestination = useCallback(async (place) => {
        setSuggestions([]);
        setSearchQuery(place.display_name.split(',')[0]);
        const dest = { lat: parseFloat(place.lat), lon: parseFloat(place.lon), name: place.display_name.split(',').slice(0, 2).join(', ') };
        setDestination(dest);
        setError('');

        if (!userPos) { setError('Waiting for your GPS location…'); return; }
        setLoading('Calculating route…');

        try {
            const r = await getWalkingRoute(userPos, [dest.lat, dest.lon]);
            setRoute(r);
            setCurrentStep(0);
            setLoading('');
            speak(`Route found. ${r.summary}. Starting navigation.`, { priority: 'high' });
        } catch (e) {
            setError(e.message);
            setLoading('');
        }
    }, [userPos]);

    // ── Recalculate route (if user drifted off-path) ───────────────────────
    const recalculate = async () => {
        if (!userPos || !destination) return;
        setLoading('Recalculating…');
        try {
            const r = await getWalkingRoute(userPos, [destination.lat, destination.lon]);
            setRoute(r);
            setCurrentStep(0);
            setLoading('');
            speak('Route recalculated.', { priority: 'high' });
        } catch (e) { setError(e.message); setLoading(''); }
    };

    // ── Current step details ──────────────────────────────────────────────
    const step     = route?.steps?.[currentStep];
    const nextStep = route?.steps?.[currentStep + 1];
    const progress = route ? Math.min(100, (currentStep / Math.max(route.steps.length - 1, 1)) * 100) : 0;

    // ── Map default center ─────────────────────────────────────────────────
    const mapCenter = userPos || [12.9716, 77.5946]; // default: Bangalore

    return (
        <AppLayout title="Navigation & Guidance">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {/* ── Header ────────────────────────────────────────────── */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 10 }}>
                            <Navigation size={24} style={{ color: 'var(--color-primary)' }} />
                            Smart Path Guidance
                        </h1>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                            GPS navigation · pedestrian routing · voice guidance · sidewalk detection
                        </p>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        {route && !navigating && (
                            <button className="btn btn-primary" onClick={startNavigation} style={{ gap: 6 }}>
                                <Play size={15} /> Start Navigation
                            </button>
                        )}
                        {navigating && (
                            <>
                                <button className="btn btn-ghost" onClick={recalculate} title="Recalculate" style={{ gap: 6 }}>
                                    <RotateCcw size={15} /> Recalculate
                                </button>
                                <button className="btn btn-danger" onClick={stopNavigation} style={{ gap: 6 }}>
                                    <Square size={15} /> Stop
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {/* ── Status bar ────────────────────────────────────────── */}
                {(loading || error) && (
                    <div className="card" style={{
                        padding: '0.6rem 1rem', display: 'flex', alignItems: 'center', gap: 8,
                        borderColor: error ? 'var(--color-danger)' : 'var(--color-primary)',
                        color: error ? 'var(--color-danger)' : 'var(--color-primary)',
                        fontSize: '0.85rem',
                    }}>
                        {loading && <Loader size={14} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />}
                        {error && <AlertTriangle size={14} style={{ flexShrink: 0 }} />}
                        {loading || error}
                    </div>
                )}

                {/* ── Active navigation banner ──────────────────────────── */}
                {navigating && step && (
                    <div className="card" style={{
                        background: 'linear-gradient(135deg, rgba(108,99,255,0.15), rgba(0,212,170,0.1))',
                        borderColor: 'var(--color-primary)',
                        padding: '1rem 1.25rem',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <div style={{ flexShrink: 0 }}>
                                <DirectionArrow modifier={step.direction} />
                            </div>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{step.instruction}</div>
                                {distToNext !== null && (
                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 4 }}>
                                        {distToNext < 15
                                            ? <span style={{ color: 'var(--color-warning)', fontWeight: 600 }}>Turn now!</span>
                                            : `In ${distToNext} m`}
                                        {nextStep && <span style={{ marginLeft: 8 }}>· Next: {nextStep.instruction.split('—')[0].trim()}</span>}
                                    </div>
                                )}
                            </div>
                            <button onClick={() => speakCurrentDirection()}
                                className="btn btn-primary" title="Repeat direction aloud" style={{ flexShrink: 0, padding: '0.55rem 0.85rem', gap: 5 }}>
                                <Volume2 size={16} /> Repeat
                            </button>
                        </div>

                        {/* Step Navigation Controls */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, gap: 8, flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', gap: 6 }}>
                                <button
                                    className="btn btn-ghost"
                                    disabled={currentStep <= 0}
                                    onClick={() => {
                                        const prevIdx = Math.max(0, currentStep - 1);
                                        setCurrentStep(prevIdx);
                                        announceStepWithDistance(route.steps[prevIdx], prevIdx);
                                    }}
                                    style={{ fontSize: '0.75rem', padding: '5px 10px', gap: 4 }}
                                >
                                    <ArrowLeft size={13} /> Prev Turn
                                </button>
                                <button
                                    className="btn btn-ghost"
                                    disabled={currentStep >= route.steps.length - 1}
                                    onClick={() => {
                                        const nextIdx = Math.min(route.steps.length - 1, currentStep + 1);
                                        setCurrentStep(nextIdx);
                                        announceStepWithDistance(route.steps[nextIdx], nextIdx);
                                    }}
                                    style={{ fontSize: '0.75rem', padding: '5px 10px', gap: 4 }}
                                >
                                    Next Turn <ArrowRight size={13} />
                                </button>
                            </div>
                            <button
                                className="btn btn-ghost"
                                onClick={() => {
                                    speak(`Step ${currentStep + 1} of ${route.steps.length}. ${step.instruction}. Distance: ${formatDist(step.distance)}.`, { priority: 'high' });
                                }}
                                style={{ fontSize: '0.72rem', color: 'var(--color-primary)', padding: '4px 8px' }}
                            >
                                Step {currentStep + 1} of {route.steps.length}
                            </button>
                        </div>

                        {/* Progress bar */}
                        <div style={{ marginTop: 10, height: 4, background: 'var(--border-color)', borderRadius: 4 }}>
                            <div style={{ height: '100%', width: `${progress}%`, background: 'var(--color-primary)', borderRadius: 4, transition: 'width 0.5s' }} />
                        </div>
                    </div>
                )}

                {/* ── Active Proximity Warnings & Hazard Distance Card ── */}
                <div className="card" style={{
                    borderColor: activeWarnings.filter(w => ['steps', 'crossing', 'traffic_signals', 'kerb', 'construction', 'obstacle', 'drop'].includes(w.type)).length > 0 ? 'rgba(255, 107, 107, 0.4)' : 'var(--border-color)',
                    background: 'var(--bg-card)',
                    padding: '1rem 1.25rem',
                    borderRadius: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.85rem'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{
                                width: 34, height: 34, borderRadius: 10,
                                background: 'rgba(255, 107, 107, 0.15)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                color: '#FF6B6B'
                            }}>
                                <ShieldAlert size={20} />
                            </div>
                            <div>
                                <div style={{ fontWeight: 700, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                                    Live Road Warnings & Distance
                                    <span style={{
                                        fontSize: '0.72rem', padding: '2px 8px', borderRadius: 10,
                                        background: activeWarnings.filter(w => ['steps', 'crossing', 'traffic_signals', 'kerb', 'construction', 'obstacle', 'drop'].includes(w.type)).length > 0 ? 'rgba(255,75,110,0.18)' : 'rgba(32,201,151,0.18)',
                                        color: activeWarnings.filter(w => ['steps', 'crossing', 'traffic_signals', 'kerb', 'construction', 'obstacle', 'drop'].includes(w.type)).length > 0 ? '#FF4B6E' : '#20C997',
                                        fontWeight: 600
                                    }}>
                                        {activeWarnings.filter(w => ['steps', 'crossing', 'traffic_signals', 'kerb', 'construction', 'obstacle', 'drop'].includes(w.type)).length} active nearby
                                    </span>
                                </div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                    Hazards and crossings are spoken aloud with exact distance in meters
                                </div>
                            </div>
                        </div>

                        {/* Voice alert toggle */}
                        <button
                            onClick={() => setVoiceAlertsEnabled(!voiceAlertsEnabled)}
                            className="btn btn-ghost"
                            style={{
                                fontSize: '0.78rem',
                                padding: '6px 12px',
                                gap: 6,
                                background: voiceAlertsEnabled ? 'rgba(108, 99, 255, 0.1)' : 'rgba(255, 75, 110, 0.1)',
                                color: voiceAlertsEnabled ? 'var(--color-primary)' : 'var(--color-danger)',
                                border: `1px solid ${voiceAlertsEnabled ? 'rgba(108, 99, 255, 0.3)' : 'rgba(255, 75, 110, 0.3)'}`
                            }}
                            title="Toggle automatic spoken hazard alerts"
                        >
                            {voiceAlertsEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
                            {voiceAlertsEnabled ? 'Voice Alerts: ON' : 'Voice Alerts: MUTED'}
                        </button>
                    </div>

                    {/* Last spoken alert banner */}
                    {lastSpokenAlert && (
                        <div style={{
                            background: 'linear-gradient(135deg, rgba(108, 99, 255, 0.12), rgba(0, 212, 170, 0.08))',
                            border: '1px solid rgba(108, 99, 255, 0.3)',
                            borderRadius: 10,
                            padding: '8px 12px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 10,
                            fontSize: '0.82rem'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                                <Bell size={15} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
                                <span style={{ fontWeight: 600, color: 'var(--text-secondary)', flexShrink: 0 }}>Spoken Aloud:</span>
                                <span style={{ color: 'var(--color-primary)', fontWeight: 600, fontStyle: 'italic', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                    "{lastSpokenAlert}"
                                </span>
                            </div>
                            <button
                                onClick={() => speak(lastSpokenAlert, { priority: 'high', rate: 1.05 })}
                                className="btn btn-ghost"
                                style={{ padding: '3px 8px', fontSize: '0.72rem', flexShrink: 0, gap: 4 }}
                                title="Replay last spoken alert"
                            >
                                <Volume2 size={13} /> Replay
                            </button>
                        </div>
                    )}

                    {/* Detected hazards list */}
                    {activeWarnings.filter(w => ['steps', 'crossing', 'traffic_signals', 'kerb', 'construction', 'obstacle', 'drop'].includes(w.type)).length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {activeWarnings.filter(w => ['steps', 'crossing', 'traffic_signals', 'kerb', 'construction', 'obstacle', 'drop'].includes(w.type)).slice(0, 4).map((w, i) => {
                                const info = HAZARD_INFO[w.type] || HAZARD_INFO.obstacle;
                                return (
                                    <div key={i} style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        padding: '8px 12px',
                                        borderRadius: 10,
                                        background: 'var(--bg-base)',
                                        border: `1px solid ${info.color}33`,
                                        gap: 10
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                            <span style={{ fontSize: '1.25rem' }}>{info.icon}</span>
                                            <div>
                                                <div style={{ fontWeight: 600, fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    {info.title}
                                                    <span style={{
                                                        fontSize: '0.68rem', padding: '1px 6px', borderRadius: 6,
                                                        background: `${info.color}22`, color: info.color, fontWeight: 700
                                                    }}>
                                                        {info.badge}
                                                    </span>
                                                </div>
                                                <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>{info.advice}</div>
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                                            <span style={{
                                                fontWeight: 800, fontSize: '0.85rem', color: info.color,
                                                background: `${info.color}18`, padding: '4px 8px', borderRadius: 8
                                            }}>
                                                {w.distance} m ahead
                                            </span>
                                            <button
                                                className="btn btn-ghost"
                                                onClick={() => {
                                                    announceWarning(info.spoken(w.distance), `manual-${w.type}-${i}`, true);
                                                }}
                                                style={{ padding: '4px 8px', fontSize: '0.72rem', gap: 4 }}
                                                title="Speak this warning aloud"
                                            >
                                                <Volume2 size={13} /> Speak
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div style={{
                            padding: '8px 12px',
                            borderRadius: 8,
                            background: 'var(--bg-base)',
                            color: 'var(--text-muted)',
                            fontSize: '0.78rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8
                        }}>
                            <Sparkles size={14} style={{ color: 'var(--color-primary)' }} />
                            <span>No hazardous steps, drop-offs, or obstacles detected within 40m. Path clear!</span>
                        </div>
                    )}

                    {/* Quick Simulation / Test Controls */}
                    <div style={{
                        marginTop: 4,
                        paddingTop: 8,
                        borderTop: '1px solid var(--border-color)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6
                    }}>
                        <div style={{ fontSize: '0.73rem', fontWeight: 600, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span>🔊 Test Spoken Distance Warnings:</span>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            <button
                                className="btn btn-ghost"
                                onClick={() => triggerSimulatedWarning('steps', 14)}
                                style={{ fontSize: '0.73rem', padding: '4px 8px', borderRadius: 8, background: 'rgba(255, 107, 107, 0.1)', border: '1px solid rgba(255, 107, 107, 0.25)' }}
                            >
                                🪜 Stairs (14m)
                            </button>
                            <button
                                className="btn btn-ghost"
                                onClick={() => triggerSimulatedWarning('crossing', 22)}
                                style={{ fontSize: '0.73rem', padding: '4px 8px', borderRadius: 8, background: 'rgba(255, 169, 77, 0.1)', border: '1px solid rgba(255, 169, 77, 0.25)' }}
                            >
                                🦓 Crossing (22m)
                            </button>
                            <button
                                className="btn btn-ghost"
                                onClick={() => triggerSimulatedWarning('traffic_signals', 30)}
                                style={{ fontSize: '0.73rem', padding: '4px 8px', borderRadius: 8, background: 'rgba(255, 212, 59, 0.1)', border: '1px solid rgba(255, 212, 59, 0.25)' }}
                            >
                                🚦 Traffic Lights (30m)
                            </button>
                            <button
                                className="btn btn-ghost"
                                onClick={() => triggerSimulatedWarning('kerb', 8)}
                                style={{ fontSize: '0.73rem', padding: '4px 8px', borderRadius: 8, background: 'rgba(255, 146, 43, 0.1)', border: '1px solid rgba(255, 146, 43, 0.25)' }}
                            >
                                ⚠️ Curb Drop (8m)
                            </button>
                            <button
                                className="btn btn-ghost"
                                onClick={() => triggerSimulatedWarning('obstacle', 5)}
                                style={{ fontSize: '0.73rem', padding: '4px 8px', borderRadius: 8, background: 'rgba(240, 62, 62, 0.1)', border: '1px solid rgba(240, 62, 62, 0.25)' }}
                            >
                                🛑 Obstacle (5m)
                            </button>
                            <button
                                className="btn btn-ghost"
                                onClick={() => triggerSimulatedWarning('construction', 18)}
                                style={{ fontSize: '0.73rem', padding: '4px 8px', borderRadius: 8, background: 'rgba(250, 82, 82, 0.1)', border: '1px solid rgba(250, 82, 82, 0.25)' }}
                            >
                                🚧 Construction (18m)
                            </button>
                        </div>
                    </div>
                </div>

                {/* ── Main layout (stacked for mobile) ────────────────────*/}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                    {/* ── Map ────────────────────────────────────────────── */}
                    <div style={{ borderRadius: 16, overflow: 'hidden', width: '100%', height: 'clamp(300px, 55vh, 520px)', position: 'relative' }}>
                        <MapContainer
                            center={mapCenter}
                            zoom={15}
                            style={{ width: '100%', height: '100%' }}
                            zoomControl={false}
                        >
                            <TileLayer
                                attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                            />
                            <MapController center={userPos} follow={followUser} />

                            {/* User location */}
                            {userPos && (
                                <>
                                    <Marker position={userPos} icon={userIcon}>
                                        <Popup>📍 You are here</Popup>
                                    </Marker>
                                    <Circle center={userPos} radius={15} pathOptions={{ color: '#6c63ff', fillColor: '#6c63ff', fillOpacity: 0.15, weight: 1 }} />
                                </>
                            )}

                            {/* Destination */}
                            {destination && (
                                <Marker position={[destination.lat, destination.lon]} icon={destIcon}>
                                    <Popup>🏁 {destination.name}</Popup>
                                </Marker>
                            )}

                            {/* Route polyline */}
                            {route?.polyline && (
                                <Polyline
                                    positions={route.polyline}
                                    pathOptions={{ color: '#6c63ff', weight: 5, opacity: 0.85, lineJoin: 'round' }}
                                />
                            )}

                            {/* Nearby pedestrian features */}
                            {nearbyFeatures.map((f, i) => (
                                <Marker key={i} position={[f.lat, f.lon]} icon={crossingIcon}>
                                    <Popup>
                                        {f.type === 'crossing' ? '🦓 Pedestrian Crossing'
                                            : f.type === 'traffic_signals' ? '🚦 Traffic Lights'
                                            : f.type === 'steps' ? '🪜 Steps / Stairs'
                                            : f.type === 'footway' ? '🚶 Footway / Sidewalk'
                                            : `🔵 ${f.type}`}
                                    </Popup>
                                </Marker>
                            ))}
                        </MapContainer>

                        {/* Follow toggle */}
                        <button
                            onClick={() => setFollowUser(f => !f)}
                            style={{
                                position: 'absolute', bottom: 12, right: 12, zIndex: 1000,
                                background: followUser ? 'var(--color-primary)' : 'var(--bg-card)',
                                border: '1px solid var(--border-color)', borderRadius: 8,
                                padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center',
                                gap: 5, fontSize: '0.73rem', color: followUser ? '#fff' : 'var(--text-muted)',
                            }} title="Toggle map follow"
                        >
                            <Crosshair size={14} /> {followUser ? 'Following' : 'Free'}
                        </button>
                    </div>

                    {/* ── Info panel (below map on mobile) ────────────── */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {/* GPS status */}
                        <div className="card">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                <MapPin size={14} style={{ color: userPos ? 'var(--color-accent)' : 'var(--text-muted)' }} />
                                <span style={{ fontWeight: 600, fontSize: '0.8rem' }}>Your Location</span>
                                {userPos && <span style={{ marginLeft: 'auto', width: 8, height: 8, borderRadius: '50%', background: 'var(--color-accent)', display: 'inline-block' }} />}
                            </div>
                            {userPos
                                ? <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{userAddr || `${userPos[0].toFixed(5)}, ${userPos[1].toFixed(5)}`}</div>
                                : <div style={{ fontSize: '0.78rem', color: 'var(--color-warning)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> Acquiring GPS…
                                  </div>
                            }
                        </div>

                        {/* Destination search */}
                        <div className="card">
                            <div style={{ fontWeight: 600, fontSize: '0.8rem', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Search size={13} style={{ color: 'var(--color-primary)' }} /> Search Destination
                            </div>
                            <div style={{ position: 'relative' }}>
                                <input
                                    className="form-input"
                                    placeholder="Enter place, address, landmark…"
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    style={{ width: '100%', fontSize: '0.82rem', paddingRight: 32 }}
                                />
                                {searchQuery && (
                                    <button onClick={() => { setSearchQuery(''); setSuggestions([]); }}
                                        style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1rem' }}>
                                        ×
                                    </button>
                                )}
                            </div>

                            {/* Quick Airport / Transit / City Destination Chips */}
                            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                {[
                                    { label: '🛫 Airport Gate', query: 'Airport Gate' },
                                    { label: '🚊 Metro Station', query: 'Metro Station' },
                                    { label: '🚻 Restroom', query: 'Restroom' },
                                    { label: '🚪 Exit Gate', query: 'Exit' },
                                    { label: 'ℹ️ Help Desk', query: 'Information Desk' },
                                    { label: '🧳 Baggage Claim', query: 'Baggage Claim' }
                                ].map((chip, idx) => (
                                    <button
                                        key={idx}
                                        className="btn btn-ghost"
                                        onClick={() => {
                                            setSearchQuery(chip.query);
                                            const basePos = userPos || [12.9716, 77.5946];
                                            const destLat = basePos[0] + (idx % 2 === 0 ? 0.0018 : -0.0015);
                                            const destLon = basePos[1] + (idx > 2 ? 0.0022 : -0.0018);
                                            selectDestination({
                                                lat: destLat,
                                                lon: destLon,
                                                display_name: `${chip.label}, SenseBridge Guidance Target`
                                            });
                                        }}
                                        style={{ fontSize: '0.73rem', padding: '4px 8px', borderRadius: 8, background: 'rgba(108,99,255,0.08)', border: '1px solid rgba(108,99,255,0.2)' }}
                                    >
                                        {chip.label}
                                    </button>
                                ))}
                            </div>

                            {suggestions.length > 0 && (
                                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 200, overflowY: 'auto' }}>
                                    {suggestions.map((s, i) => (
                                        <button key={i} onClick={() => selectDestination(s)}
                                            style={{
                                                textAlign: 'left', padding: '6px 10px', border: 'none', borderRadius: 7,
                                                background: 'var(--bg-base)', color: 'var(--text-primary)',
                                                cursor: 'pointer', fontSize: '0.78rem', lineHeight: 1.35,
                                            }}>
                                            <div style={{ fontWeight: 600 }}>{s.display_name.split(',')[0]}</div>
                                            <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{s.display_name.split(',').slice(1, 3).join(',').trim()}</div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Route summary */}
                        {route && (
                            <div className="card">
                                <div style={{ fontWeight: 600, fontSize: '0.8rem', marginBottom: 10, color: 'var(--color-primary)' }}>
                                    🗺️ Route Found
                                </div>
                                <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
                                    <div style={{ flex: 1, textAlign: 'center', padding: '8px', background: 'var(--bg-base)', borderRadius: 8 }}>
                                        <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{formatDist(route.totalDistance)}</div>
                                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Distance</div>
                                    </div>
                                    <div style={{ flex: 1, textAlign: 'center', padding: '8px', background: 'var(--bg-base)', borderRadius: 8 }}>
                                        <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{formatTime(route.totalDuration)}</div>
                                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Walk time</div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Nearby features */}
                        {nearbyFeatures.length > 0 && (
                            <div className="card">
                                <div style={{ fontWeight: 600, fontSize: '0.8rem', marginBottom: 8 }}>
                                    🚶 Nearby Features
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    {[...new Set(nearbyFeatures.map(f => f.type))].slice(0, 5).map((type, i) => (
                                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.78rem', padding: '4px 0' }}>
                                            <span>{type === 'crossing' ? '🦓' : type === 'traffic_signals' ? '🚦' : type === 'steps' ? '🪜' : type === 'footway' ? '🚶' : '📍'}</span>
                                            <span style={{ textTransform: 'capitalize' }}>{type.replace('_', ' ')}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* ── Turn-by-turn steps list ───────────────────────────── */}
                {route?.steps && (
                    <div className="card">
                        <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <ChevronRight size={16} style={{ color: 'var(--color-primary)' }} />
                            Turn-by-Turn Directions
                            <span style={{ marginLeft: 'auto', fontSize: '0.73rem', color: 'var(--text-muted)' }}>{route.steps.length} steps</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 300, overflowY: 'auto' }}>
                            {route.steps.map((s, i) => (
                                <div key={i} style={{
                                    display: 'flex', alignItems: 'center', gap: 12,
                                    padding: '8px 12px', borderRadius: 8,
                                    background: i === currentStep ? 'rgba(108,99,255,0.12)' : 'var(--bg-base)',
                                    border: `1px solid ${i === currentStep ? 'var(--color-primary)' : 'transparent'}`,
                                    cursor: 'pointer', transition: 'all 0.15s',
                                }} onClick={() => { announceStepWithDistance(s, i); setCurrentStep(i); }}>
                                    <div style={{ width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: i === currentStep ? 'var(--color-primary)' : 'var(--border-color)', color: i === currentStep ? '#fff' : 'var(--text-muted)', fontWeight: 700, fontSize: '0.75rem', flexShrink: 0 }}>
                                        {i + 1}
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: '0.845rem', fontWeight: i === currentStep ? 600 : 400 }}>{s.instruction}</div>
                                    </div>
                                    <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', flexShrink: 0 }}>{formatDist(s.distance)}</div>
                                    <button onClick={e => { e.stopPropagation(); announceStepWithDistance(s, i); }}
                                        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2 }}>
                                        <Volume2 size={13} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </AppLayout>
    );
};

export default NavigationPage;

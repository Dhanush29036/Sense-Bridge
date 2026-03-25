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
import {
    Navigation, MapPin, Search, Play, Square,
    ChevronRight, Volume2, AlertTriangle, ArrowLeft,
    ArrowRight, ArrowUp, Crosshair, Loader, RotateCcw
} from 'lucide-react';

// Fix Leaflet default icon paths (Vite asset hashing breaks them)
import 'leaflet/dist/leaflet.css';
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

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
    const [lastSpokenStep, setLastSpokenStep] = useState(-1);
    const [autoNavigateActive, setAutoNavigateActive] = useState(false);
    const [pendingAutoStartPlace, setPendingAutoStartPlace] = useState(null);

    const location = useLocation();
    const routerNavigate = useNavigate();

    const watchIdRef  = useRef(null);
    const searchTimer = useRef(null);

    // ── Voice command support (vc:start / vc:stop events from VoiceCommandContext) ──
    useEffect(() => {
        const onStart = () => { if (route) startNavigation(); };
        const onStop  = () => stopNavigation();
        window.addEventListener('vc:start', onStart);
        window.addEventListener('vc:stop',  onStop);
        return () => {
            window.removeEventListener('vc:start', onStart);
            window.removeEventListener('vc:stop',  onStop);
        };
    }, [route]); // re-bind if route changes so startNavigation uses fresh route

    // ── GPS tracking ──────────────────────────────────────────────────────
    const startGPS = useCallback(() => {
        if (!navigator.geolocation) { setError('Geolocation not supported.'); return; }
        watchIdRef.current = navigator.geolocation.watchPosition(
            async (pos) => {
                const { latitude: lat, longitude: lon, accuracy } = pos.coords;
                const newPos = [lat, lon];
                setUserPos(newPos);

                // Reverse geocode only occasionally
                if (!userAddr) {
                    reverseGeocode(lat, lon).then(setUserAddr).catch(() => {});
                }

                // Update navigation state if actively navigating
                if (navigating && route) {
                    setCurrentStep(prev => {
                        const state = computeNavigationState(newPos, route.steps, prev);
                        setDistToNext(state.distanceToNext);

                        if (state.arrived) {
                            announceStep('You have arrived at your destination!', 999);
                            setNavigating(false);
                        } else if (state.nearingTurn && state.currentStepIdx !== lastSpokenStep) {
                            const step = route.steps[state.currentStepIdx];
                            if (step) announceStep(step.instruction, state.currentStepIdx);
                        }
                        return state.currentStepIdx;
                    });
                }

                // Nearby pedestrian features (throttled)
                if (Math.random() < 0.05) { // ~5% of GPS updates
                    getNearbyPedestrianFeatures(lat, lon, 80).then(setNearbyFeatures);
                }
            },
            (err) => setError(`GPS error: ${err.message}`),
            { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
        );
    }, [navigating, route, lastSpokenStep, userAddr]);

    useEffect(() => {
        startGPS();
        return () => {
            if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);
        };
    }, []);

    // ── Pre-fill destination from voice command ────────────────────────────
    useEffect(() => {
        if (location.state?.destinationQuery) {
            setSearchQuery(location.state.destinationQuery);
            if (location.state.autoNavigate) setAutoNavigateActive(true);
            // clear state so it doesn't loop
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
                    if (r.steps[0]) announceStep(r.steps[0].instruction, 0);
                    // Slight delay to ensure state updates before rebinding GPS
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
    }, [pendingAutoStartPlace, userPos, loading, startGPS]);

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

    // ── Start / Stop navigation ───────────────────────────────────────────
    const startNavigation = () => {
        if (!route) return;
        setNavigating(true);
        setCurrentStep(0);
        setLastSpokenStep(-1);
        const step = route.steps[0];
        if (step) announceStep(step.instruction, 0);
        // Restart GPS listener with navigating=true
        if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);
        startGPS();
    };

    const stopNavigation = () => {
        setNavigating(false);
        cancelSpeech();
        speak('Navigation stopped.', { priority: 'high' });
    };

    // ── Voice announcement (deduplicated) ─────────────────────────────────
    const announceStep = (text, stepIdx) => {
        setLastSpokenStep(stepIdx);
        speak(text, { priority: 'high', rate: 1.0 });
    };

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
        <AppLayout>
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
                            <button onClick={() => announceStep(step.instruction, currentStep)}
                                className="btn btn-ghost" title="Repeat aloud" style={{ flexShrink: 0, padding: '0.5rem' }}>
                                <Volume2 size={18} />
                            </button>
                        </div>
                        {/* Progress bar */}
                        <div style={{ marginTop: 12, height: 4, background: 'var(--border-color)', borderRadius: 4 }}>
                            <div style={{ height: '100%', width: `${progress}%`, background: 'var(--color-primary)', borderRadius: 4, transition: 'width 0.5s' }} />
                        </div>
                        <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginTop: 4, textAlign: 'right' }}>
                            Step {currentStep + 1} of {route.steps.length} · {route.summary}
                        </div>
                    </div>
                )}

                {/* ── Main grid ────────────────────────────────────────────*/}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '1.25rem' }}>
                    {/* ── Map ────────────────────────────────────────────── */}
                    <div style={{ borderRadius: 16, overflow: 'hidden', height: 480, position: 'relative' }}>
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

                    {/* ── Right panel ────────────────────────────────────── */}
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
                                }} onClick={() => { announceStep(s.instruction, i); setCurrentStep(i); }}>
                                    <div style={{ width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: i === currentStep ? 'var(--color-primary)' : 'var(--border-color)', color: i === currentStep ? '#fff' : 'var(--text-muted)', fontWeight: 700, fontSize: '0.75rem', flexShrink: 0 }}>
                                        {i + 1}
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: '0.845rem', fontWeight: i === currentStep ? 600 : 400 }}>{s.instruction}</div>
                                    </div>
                                    <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', flexShrink: 0 }}>{formatDist(s.distance)}</div>
                                    <button onClick={e => { e.stopPropagation(); announceStep(s.instruction, i); }}
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

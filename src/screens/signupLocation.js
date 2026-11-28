import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Modal, Platform, Pressable, Text, UIManager, View } from 'react-native';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, CircleCheck, Crosshair, Layers, LocateFixed, MapPin, Maximize2, Pencil, Search, Store, X } from 'lucide-react-native';
import { GREEN, MUTED, INK, FIELD_BORDER } from './authUi';
import { authApi } from '../api/client';
import { confirm } from '../components/confirm';

// Create Account → Shop Information: Google Places shop search + an interactive
// map (same react-native-maps setup as the Employee App pickup popup) to place
// and confirm the shop's exact pin. Places search/details go through the backend
// proxy (/auth/places/*, server key) — no Places key ships in the app.
// Shops not on Google: type the name, use GPS or tap the map, then confirm.

// react-native-maps (bundled in Expo Go and dev / release builds); null if the native side is missing.
// The native view is "RNMapsMapView" under the New Architecture (bridgeless);
// "AIRMap" is only the legacy name — gating on it alone is what hid the map.
let Maps = null;
if (Platform.OS !== 'web') { try { Maps = require('react-native-maps'); } catch (_) { Maps = null; } }
const nativeMap = (n) => (typeof UIManager.hasViewManagerConfig === 'function' ? UIManager.hasViewManagerConfig(n) : true);
const HAS_MAP = !!Maps?.default && (nativeMap('RNMapsMapView') || nativeMap('AIRMap'));
const INDIA = { latitude: 20.5937, longitude: 78.9629, latitudeDelta: 18, longitudeDelta: 18 }; // overview only, never a pin
const STREET_ZOOM = 17; // Google zoom: roads, buildings, shops, landmarks
const PIN_ZOOM = 18;
const deltaFor = (z) => ({ latitudeDelta: 360 / 2 ** z, longitudeDelta: 360 / 2 ** z });
const flyTo = (ref, c, zoom) => {
  const m = ref?.current;
  if (!m || !c) return;
  const center = { latitude: c.latitude, longitude: c.longitude };
  if (Platform.OS === 'android' && m.animateCamera) m.animateCamera({ center, zoom }, { duration: 600 });
  else m.animateToRegion?.({ ...center, ...deltaFor(zoom) }, 600);
};
const OK_GREEN = '#16A34A';
const WARN = '#B45309';
const DANGER = '#B3261E';

/** Finite, inside India's bounding box, and not the 0,0 null island. */
export const validCoords = (la, lo) => Number.isFinite(la) && Number.isFinite(lo)
  && la >= 6 && la <= 37.6 && lo >= 68 && lo <= 97.5;

const newSession = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Owner's rough position, used only to bias search towards nearby shops.
// Read silently if permission was already granted; refreshed by Use Current Location.
let near = null;
let nearTried = false;
async function loadNear() {
  if (near || nearTried) return near;
  nearTried = true;
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const p = await Location.getLastKnownPositionAsync();
    if (p && validCoords(p.coords.latitude, p.coords.longitude)) near = { latitude: p.coords.latitude, longitude: p.coords.longitude };
  } catch (_) { /* bias is optional */ }
  return near;
}

async function autocomplete(input, session) {
  const bias = near ? `&lat=${near.latitude.toFixed(4)}&lng=${near.longitude.toFixed(4)}` : '';
  const r = await authApi.get(`/auth/places/autocomplete?q=${encodeURIComponent(input)}&session=${session}&business=true${bias}`);
  return r?.suggestions || [];
}

/** { placeId, name, address, pincode, phone, city, district, state, area, latitude, longitude } */
export async function placeDetails(placeId, session) {
  const d = await authApi.get(`/auth/places/details/${encodeURIComponent(placeId)}${session ? `?session=${session}` : ''}`);
  return { ...d, phone: String(d?.phone || '').slice(-10) };
}

const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);

async function reverse(latitude, longitude) {
  try {
    const [r] = await withTimeout(Location.reverseGeocodeAsync({ latitude, longitude }), 10000, 'timeout');
    if (!r) return null;
    const address = [r.name, r.street, r.district || r.subregion, r.city, r.region].filter(Boolean)
      .filter((x, i, a) => a.indexOf(x) === i).join(', ');
    return address || r.postalCode ? { address, pincode: /^\d{6}$/.test(r.postalCode || '') ? r.postalCode : '' } : null;
  } catch (_) { return null; }
}

function Hint({ text, tone = MUTED }) {
  return <Text style={{ fontSize: 11.5, color: tone, marginTop: 6, lineHeight: 16 }}>{text}</Text>;
}

/**
 * Google business suggestions under the Shop Name field (India only, debounced,
 * biased to the owner's area). Nothing is auto-selected: onPick(details) runs
 * only for the row the owner taps.
 */
export function ShopNameSuggestions({ query, focused, onPick }) {
  const [items, setItems] = useState([]);
  const [state, setState] = useState('idle'); // idle | loading | done | error
  const [busy, setBusy] = useState(null); // placeId being opened
  const [pickErr, setPickErr] = useState(null);
  const session = useRef(newSession());
  const q = query.trim();

  useEffect(() => { loadNear(); }, []);
  useEffect(() => {
    setPickErr(null);
    if (!focused || q.length < 3 || q.length > 120) { setItems([]); setState('idle'); return undefined; }
    let alive = true;
    const t = setTimeout(() => {
      setState('loading');
      autocomplete(q, session.current)
        .then((r) => { if (alive) { setItems(r.slice(0, 5)); setState('done'); } })
        .catch(() => { if (alive) { setItems([]); setState('error'); } });
    }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [q, focused]);

  const pick = async (it) => {
    if (busy) return;
    setBusy(it.placeId);
    setPickErr(null);
    try {
      const d = await placeDetails(it.placeId, session.current);
      session.current = newSession();
      if (!validCoords(d?.latitude, d?.longitude)) throw new Error('no-location');
      setItems([]);
      onPick(d);
    } catch (_) {
      setPickErr("Couldn't load this shop's location. Try again, or place the pin on the map.");
    } finally { setBusy(null); }
  };

  if (pickErr) return <Hint text={pickErr} tone={DANGER} />;
  if (!focused || q.length < 3) return null;
  if (state === 'error') return <Hint tone={DANGER} text="Shop search is unavailable (check your internet). Type your shop name and set the pin on the map." />;
  if (state === 'done' && !items.length) return <Hint text="No matching shop on Google Maps. Just type your shop name and set the pin on the map." />;
  if (!items.length) return state === 'loading' ? <ActivityIndicator size="small" color={GREEN} style={{ marginTop: 8 }} /> : null;
  return (
    <View style={{ marginTop: 4, borderRadius: 12, borderWidth: 1, borderColor: FIELD_BORDER, backgroundColor: '#FFFFFF', overflow: 'hidden' }}>
      {items.map((it) => (
        <Pressable key={it.placeId} onPress={() => pick(it)} disabled={!!busy} accessibilityRole="button" accessibilityLabel={`${it.main}, ${it.secondary}`}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#F3F4F6', backgroundColor: pressed ? '#F3F9FA' : '#FFFFFF' })}>
          <Store size={15} color={GREEN} />
          <View style={{ flex: 1, marginLeft: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: INK }} numberOfLines={1}>{it.main}</Text>
            {it.secondary ? <Text style={{ fontSize: 11.5, color: MUTED, marginTop: 1 }} numberOfLines={2}>{it.secondary}</Text> : null}
          </View>
          {busy === it.placeId ? <ActivityIndicator size="small" color={GREEN} /> : null}
        </Pressable>
      ))}
      <Text style={{ fontSize: 10, color: MUTED, padding: 6, textAlign: 'right' }}>Not listed? Just type your shop name.</Text>
    </View>
  );
}

/** Teal store pin with the shop name above it; the tip (bottom centre) is the exact spot. */
function ShopMarker({ coordinate, label, onDragEnd }) {
  const [track, setTrack] = useState(true);
  useEffect(() => { // let the custom view (incl. SVG icon) paint, then freeze it for smooth panning
    setTrack(true);
    const t = setTimeout(() => setTrack(false), 800);
    return () => clearTimeout(t);
  }, [label]);
  return (
    <Maps.Marker coordinate={coordinate} draggable onDragEnd={onDragEnd} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={track}>
      <View style={{ alignItems: 'center' }}>
        {label ? (
          <View style={{ maxWidth: 200, backgroundColor: '#FFFFFF', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 4, borderWidth: 1, borderColor: '#C7E6EA' }}>
            <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: '800', color: INK }}>{label}</Text>
          </View>
        ) : null}
        <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: GREEN, borderWidth: 3, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
          <Store size={18} color="#FFFFFF" strokeWidth={2.4} />
        </View>
        <View style={{ width: 0, height: 0, marginTop: -2, borderLeftWidth: 7, borderRightWidth: 7, borderTopWidth: 10, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: GREEN }} />
      </View>
    </Maps.Marker>
  );
}

function RoundBtn({ icon: Icon, label, onPress, busy }) {
  return (
    <Pressable onPress={onPress} disabled={busy} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}
      style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginBottom: 6,
        elevation: 3, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } }}>
      {busy ? <ActivityIndicator size="small" color={GREEN} /> : <Icon size={17} color={INK} />}
    </Pressable>
  );
}

const accuracyInfo = (m) => (m <= 20 ? ['Good', OK_GREEN] : m <= 50 ? ['Fair', WARN] : ['Poor', DANGER]);

/**
 * Shop Location (Exact Location): map + Use Current Location + Confirm Location.
 * value = { latitude, longitude, placeId, confirmed, accuracy } | null.
 * onChange(next, filled?) — next = new pin (or null when only filling the address);
 * filled = { address, pincode } from reverse geocoding (owner can still edit).
 */
export function ShopLocationPicker({ value, onChange, shopName, address, onMapTouch }) {
  const insets = useSafeAreaInsets();
  const [locating, setLocating] = useState(false);
  const [err, setErr] = useState(null);
  const [note, setNote] = useState(null);
  const [mapType, setMapType] = useState('standard');
  const [full, setFull] = useState(false);
  const [ready, setReady] = useState(false);
  const [slow, setSlow] = useState(false);
  // Owner's live GPS position (native blue dot). Never the shop pin, never confirmed.
  const [me, setMe] = useState(near);
  const [gps, setGps] = useState('checking'); // checking | ok | waiting | off | denied | blocked | error
  const [perm, setPerm] = useState(false);
  const [justFound, setJustFound] = useState(false);
  const mapRef = useRef(null);
  const fullRef = useRef(null);
  const seq = useRef(0);
  const selfMove = useRef(false); // pin moved by drag / tap — keep the owner's zoom
  const userMoved = useRef(false); // owner panned / zoomed — no auto re-centring
  const centerNext = useRef('auto'); // 'auto' (screen open) | 'force' (recenter tap) | null
  const watchRef = useRef(null);
  const mounted = useRef(true);
  const gpsRef = useRef(gps);
  gpsRef.current = gps;
  const pin = validCoords(value?.latitude, value?.longitude) ? { latitude: value.latitude, longitude: value.longitude } : null;
  const pinRef = useRef(pin);
  pinRef.current = pin;
  const label = (shopName || '').trim();
  const flyAll = (c, z) => [mapRef, fullRef].forEach((r) => flyTo(r, c, z)); // only one map is mounted at a time

  // Fly to a pin set by search / GPS; drag or tap leaves the camera alone.
  useEffect(() => {
    if (!pin) return;
    if (selfMove.current) { selfMove.current = false; return; }
    flyAll(pin, PIN_ZOOM);
  }, [value?.latitude, value?.longitude]); // eslint-disable-line react-hooks/exhaustive-deps

  // Blue-dot fix. Moves the camera only on screen open (no shop pin, no manual pan)
  // or after a recenter tap — it never touches the shop pin.
  const gotFix = (p, fresh) => {
    const { latitude, longitude, accuracy } = p?.coords || {};
    if (!mounted.current || !validCoords(latitude, longitude)) return;
    const c = { latitude, longitude, accuracy: Number.isFinite(accuracy) ? Math.round(accuracy) : null, at: p.timestamp || Date.now() };
    near = { latitude, longitude };
    setMe(c);
    if (fresh && gpsRef.current !== 'ok') { setGps('ok'); setJustFound(true); }
    const want = centerNext.current;
    if (want === 'force' || (want === 'auto' && !pinRef.current && !userMoved.current)) {
      flyAll(c, STREET_ZOOM);
      if (fresh || want === 'force') centerNext.current = null; // last-known first, then one fresh fix
    }
  };

  const startGps = async (ask) => {
    setGps('checking');
    try {
      let { status, canAskAgain } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted' && ask && canAskAgain) ({ status, canAskAgain } = await Location.requestForegroundPermissionsAsync());
      if (!mounted.current) return;
      if (status !== 'granted') { setGps(canAskAgain ? 'denied' : 'blocked'); return; }
      setPerm(true);
      if (!(await Location.hasServicesEnabledAsync())) { if (mounted.current) setGps('off'); return; }
      const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60000, requiredAccuracy: 500 }).catch(() => null);
      if (last) gotFix(last, false);
      watchRef.current?.remove();
      watchRef.current = null;
      const sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 3000, distanceInterval: 3 }, (p) => gotFix(p, true));
      if (!mounted.current) { sub.remove(); return; }
      watchRef.current = sub;
    } catch (_) { if (mounted.current) setGps('error'); }
  };

  useEffect(() => {
    mounted.current = true;
    startGps(true);
    const sub = AppState.addEventListener('change', (s) => { // back from Settings / GPS toggle
      if (s === 'active' && ['off', 'blocked', 'error'].includes(gpsRef.current)) startGps(false);
    });
    return () => { mounted.current = false; sub.remove(); watchRef.current?.remove(); watchRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { // no fresh fix yet → say so
    if (gps !== 'checking') return undefined;
    const t = setTimeout(() => { if (gpsRef.current === 'checking' && watchRef.current) setGps('waiting'); }, 8000);
    return () => clearTimeout(t);
  }, [gps]);

  useEffect(() => {
    if (!justFound) return undefined;
    const t = setTimeout(() => setJustFound(false), 2500);
    return () => clearTimeout(t);
  }, [justFound]);

  const gpsTap = () => {
    if (gps === 'blocked') Linking.openSettings().catch(() => {});
    else if (gps === 'off') Location.enableNetworkProviderAsync().then(() => startGps(false)).catch(() => {});
    else if (gps !== 'checking') startGps(gps === 'denied');
  };

  // Map's locate icon: camera back to the blue dot only — shop pin untouched.
  const recenter = () => {
    userMoved.current = false;
    if (me) flyAll(me, STREET_ZOOM);
    else { centerNext.current = 'force'; gpsTap(); }
  };

  useEffect(() => { onMapTouch?.(false); }, [full]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!HAS_MAP || ready) return undefined;
    const t = setTimeout(() => setSlow(true), 12000);
    return () => clearTimeout(t);
  }, [ready]);

  const fillFrom = async (c, n) => {
    const filled = await reverse(c.latitude, c.longitude);
    if (n !== seq.current) return; // pin moved again meanwhile
    if (filled) onChange(null, filled);
    else setNote("Couldn't find the address for this spot — please type it below.");
  };

  // Drag / tap. A picked Google shop keeps its Place ID and Google address.
  const movePin = (c) => {
    if (!validCoords(c?.latitude, c?.longitude)) { setErr('Place the pin on your shop in India.'); return; }
    setErr(null); setNote(null);
    selfMove.current = !pin || pin.latitude !== c.latitude || pin.longitude !== c.longitude;
    const n = ++seq.current;
    const placeId = value?.placeId || null;
    onChange({ latitude: c.latitude, longitude: c.longitude, placeId, confirmed: false, accuracy: null });
    if (!placeId) fillFrom(c, n);
  };
  const onMapPress = (e) => { if (e.nativeEvent.action !== 'marker-press') movePin(e.nativeEvent.coordinate); };

  const useCurrent = async () => {
    if (locating) return;
    if (value?.confirmed) {
      const ok = await confirm({ title: 'Replace confirmed location?', message: 'Your confirmed shop location will be replaced with your current GPS location.', confirmText: 'Replace' });
      if (!ok) return;
    }
    setErr(null); setNote(null); setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') throw new Error('Location permission required. Search your shop or tap the map to place the pin.');
      setPerm(true);
      if (!(await Location.hasServicesEnabledAsync())) throw new Error('Enable GPS to detect your location, or tap the map to place the pin.');
      if (!watchRef.current) startGps(false);
      // Reuse the live blue-dot fix when it is fresh and accurate; else take a new one.
      const live = me && Date.now() - me.at < 15000 && (me.accuracy == null || me.accuracy <= 50);
      const p = live ? { coords: me } : await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }), 20000,
        'Waiting for GPS signal timed out. Move to an open area, or tap the map to place the pin.');
      const { latitude, longitude, accuracy } = p.coords;
      if (!validCoords(latitude, longitude)) throw new Error('Could not get a valid location. Tap the map to place the pin.');
      near = { latitude, longitude };
      const n = ++seq.current;
      onChange({ latitude, longitude, placeId: value?.placeId || null, confirmed: false, accuracy: Number.isFinite(accuracy) ? Math.round(accuracy) : null });
      await fillFrom({ latitude, longitude }, n);
    } catch (e) { setErr(e?.message || 'Could not get your location.'); } finally { setLocating(false); }
  };

  const confirmLoc = () => {
    if (!pin) { setErr('Place the pin on your shop first.'); return; }
    setErr(null);
    onChange({ ...value, confirmed: true });
  };
  const editLoc = () => onChange({ ...value, confirmed: false });

  const status = !pin
    ? { title: 'Search your shop name to locate your shop.', icon: Search, color: GREEN }
    : value?.confirmed
      ? { title: 'Shop location confirmed', icon: CircleCheck, color: OK_GREEN }
      : { title: 'Shop location selected', sub: 'Drag the pin to adjust if needed.', icon: CircleCheck, color: OK_GREEN };

  // Blue-dot (owner GPS) status pill; tappable when the owner can fix it.
  const gpsMsg = gps === 'checking' ? { text: 'Detecting your current location…', spin: true, color: GREEN }
    : gps === 'waiting' ? { text: 'Waiting for GPS signal…', spin: true, color: WARN, tap: true }
      : gps === 'off' ? { text: 'Enable GPS to detect your location', color: DANGER, tap: true }
        : gps === 'denied' || gps === 'blocked' ? { text: 'Location permission required · Tap to allow', color: DANGER, tap: true }
          : gps === 'error' ? { text: "Couldn't detect your location · Tap to retry", color: DANGER, tap: true }
            : me?.accuracy > 50 ? { text: `Location accuracy is low (~${me.accuracy} m)`, color: WARN }
              : justFound ? { text: 'Current location detected', color: OK_GREEN } : null;

  const renderMap = (ref) => (
    <Maps.default
      ref={ref}
      style={{ flex: 1 }}
      mapType={mapType}
      initialRegion={pin ? { ...pin, ...deltaFor(PIN_ZOOM) } : me ? { latitude: me.latitude, longitude: me.longitude, ...deltaFor(STREET_ZOOM) } : INDIA}
      onMapReady={() => setReady(true)}
      onPress={onMapPress}
      onPanDrag={() => { userMoved.current = true; }}
      onRegionChangeComplete={(_, d) => { if (d?.isGesture) userMoved.current = true; }}
      showsUserLocation={perm}
      userLocationPriority="high"
      userLocationUpdateInterval={3000}
      toolbarEnabled={false}
      showsMyLocationButton={false}
      showsCompass={false}
      showsBuildings
      rotateEnabled={false}
      pitchEnabled={false}
    >
      {pin ? <ShopMarker coordinate={pin} label={label} onDragEnd={(e) => movePin(e.nativeEvent.coordinate)} /> : null}
    </Maps.default>
  );

  const overlays = (top, fullscreen) => (
    <>
      <View pointerEvents="none" style={{ position: 'absolute', top, left: 8, maxWidth: '72%', flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.96)',
        borderRadius: 10, paddingHorizontal: 8, paddingVertical: 5, elevation: 2, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } }}>
        <status.icon size={14} color={status.color} />
        <View style={{ marginLeft: 6, flexShrink: 1 }}>
          <Text style={{ fontSize: 11.5, fontWeight: '800', color: INK }} numberOfLines={2}>{status.title}</Text>
          {status.sub ? <Text style={{ fontSize: 10.5, color: MUTED }} numberOfLines={1}>{status.sub}</Text> : null}
        </View>
      </View>
      <View style={{ position: 'absolute', top, right: 8 }}>
        {fullscreen ? <RoundBtn icon={X} label="Close full-screen map" onPress={() => setFull(false)} /> : null}
        <RoundBtn icon={Layers} label={mapType === 'standard' ? 'Satellite view' : 'Map view'} onPress={() => setMapType((t) => (t === 'standard' ? 'hybrid' : 'standard'))} />
        <RoundBtn icon={LocateFixed} label="Show my current location" onPress={recenter} />
        {!fullscreen ? <RoundBtn icon={Maximize2} label="Full-screen map" onPress={() => setFull(true)} /> : null}
      </View>
      {gpsMsg && !(slow && !ready) ? (
        <Pressable onPress={gpsMsg.tap ? gpsTap : undefined} disabled={!gpsMsg.tap} accessibilityRole={gpsMsg.tap ? 'button' : 'text'} accessibilityLabel={gpsMsg.text}
          style={{ position: 'absolute', bottom: 8, right: 8, maxWidth: '68%', flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.96)',
            borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, elevation: 2, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } }}>
          {gpsMsg.spin ? <ActivityIndicator size="small" color={gpsMsg.color} style={{ transform: [{ scale: 0.7 }], marginVertical: -4 }} />
            : <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: gpsMsg.color }} />}
          <Text numberOfLines={1} style={{ marginLeft: 6, flexShrink: 1, fontSize: 11, fontWeight: '700', color: gpsMsg.color }}>{gpsMsg.text}</Text>
        </Pressable>
      ) : null}
      {slow && !ready ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: 10, right: 10, bottom: 10, backgroundColor: '#FFF7ED', borderRadius: 10, padding: 8 }}>
          <Text style={{ fontSize: 11.5, color: WARN, fontWeight: '700' }}>Map could not load. Check your internet — you can still search your shop or use your current location.</Text>
        </View>
      ) : null}
    </>
  );

  const actionBtn = (text, Icon, onPress, primary, disabled) => (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={text}
      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 42, borderRadius: 12, marginHorizontal: 4, paddingHorizontal: 8,
        backgroundColor: primary ? GREEN : '#FFFFFF', borderWidth: 1.5, borderColor: GREEN, opacity: disabled ? 0.45 : 1 }}>
      <Icon size={14} color={primary ? '#FFFFFF' : GREEN} />
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}
        style={{ marginLeft: 5, flexShrink: 1, fontSize: 12.5, fontWeight: '800', color: primary ? '#FFFFFF' : GREEN }}>{text}</Text>
    </Pressable>
  );
  const buttons = (
    <View style={{ flexDirection: 'row', marginTop: 10, marginHorizontal: -4 }}>
      {actionBtn(locating ? 'Locating…' : 'Use Current Location', Crosshair, useCurrent, false, locating)}
      {value?.confirmed
        ? actionBtn('Edit Location', Pencil, editLoc, false, false)
        : actionBtn('Confirm Location', Check, confirmLoc, true, !pin)}
    </View>
  );

  const acc = Number.isFinite(value?.accuracy) ? accuracyInfo(value.accuracy) : null;

  return (
    <View style={{ marginTop: 14 }}>
      <Text style={{ fontSize: 12.5, fontWeight: '700', color: MUTED, marginBottom: 6 }}>
        Shop Location (Exact Location) <Text style={{ color: DANGER }}>*</Text>
      </Text>
      {HAS_MAP ? (
        <View onTouchStart={() => onMapTouch?.(true)} onTouchEnd={() => onMapTouch?.(false)} onTouchCancel={() => onMapTouch?.(false)}
          style={{ height: 260, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: FIELD_BORDER, backgroundColor: '#E5F3F5' }}>
          {!full ? renderMap(mapRef) : null}
          {!full ? overlays(10, false) : null}
        </View>
      ) : (
        <View style={{ borderRadius: 16, borderWidth: 1, borderColor: FIELD_BORDER, backgroundColor: '#F9FAFB', padding: 14, flexDirection: 'row', alignItems: 'center' }}>
          <MapPin size={18} color={GREEN} />
          <Text style={{ flex: 1, marginLeft: 8, fontSize: 12.5, color: MUTED }}>
            {pin ? 'Map is not available on this device. Your shop pin is set from Google / GPS — confirm it below.' : 'Map is not available on this device. Search your shop name or use your current location.'}
          </Text>
        </View>
      )}

      {pin && acc ? (
        <Text style={{ fontSize: 11.5, color: MUTED, marginTop: 6 }}>
          GPS accuracy: <Text style={{ color: acc[1], fontWeight: '700' }}>~{value.accuracy} m ({acc[0]})</Text>
          {acc[0] === 'Poor' ? <Text style={{ color: DANGER }}> — drag the pin to your shop's exact spot.</Text> : null}
        </Text>
      ) : null}

      {buttons}

      {value?.confirmed && pin ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginTop: 10, padding: 10, borderRadius: 12, backgroundColor: '#ECFDF3', borderWidth: 1, borderColor: '#BBF7D0' }}>
          <CircleCheck size={17} color={OK_GREEN} />
          <View style={{ flex: 1, marginLeft: 8 }}>
            <Text style={{ fontSize: 12.5, fontWeight: '800', color: OK_GREEN }}>Shop location confirmed</Text>
            {address?.trim() ? <Text style={{ fontSize: 12, color: INK, marginTop: 2 }} numberOfLines={3}>{address.trim()}</Text> : null}
          </View>
        </View>
      ) : null}
      {err ? <Hint text={err} tone={DANGER} /> : note ? <Hint text={note} tone={WARN} /> : null}

      {HAS_MAP ? (
        <Modal visible={full} animationType="slide" onRequestClose={() => setFull(false)} statusBarTranslucent>
          <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
            <View style={{ flex: 1 }}>
              {full ? renderMap(fullRef) : null}
              {full ? overlays(insets.top + 10, true) : null}
            </View>
            <View style={{ paddingHorizontal: 14, paddingTop: 4, paddingBottom: insets.bottom + 12 }}>
              {err ? <Hint text={err} tone={DANGER} /> : null}
              {buttons}
              {value?.confirmed ? (
                <Pressable onPress={() => setFull(false)} accessibilityRole="button" style={{ marginTop: 8, height: 42, borderRadius: 12, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 13.5, fontWeight: '800', color: '#FFFFFF' }}>Done</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

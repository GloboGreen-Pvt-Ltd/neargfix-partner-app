import React, { useCallback, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, TextInput } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '../../components/rnr';
import { ticketApi } from '../../api/client';
import { ResponsiveContainer } from '../../components/responsive';
import SafeModal, { ModalInsets } from '../../components/SafeModal';

// Home → Reports → Service Status. Counts come from GET /tickets/status-report:
// ONE server classification puts every service record (original or Re-Service)
// in exactly one CURRENT-status card, and the card's list
// (BookingStatusReport → /tickets/status-report/list) uses the same
// classification — so a card's number always equals its list's total.
// Filters: service kind + booking-date period. "Delivered in period" is the
// historical hand-over figure (actual delivery time), shown separately.

const TILES = [
  { key: 'SERVICE_ACCEPTED',    label: 'Service Accepted',      color: '#357D89', icon: 'document-text-outline',    meta: 'TOTAL_BOOKING' },
  { key: 'TECHNICIAN_ASSIGNED', label: 'Technician Assigned',   color: '#035C6C', icon: 'person-add-outline',       meta: 'TOTAL_BOOKING' },
  { key: 'TECHNICIAN_ACCEPTED', label: 'Technician Accepted',   color: '#0788C9', icon: 'checkmark-done-outline',   meta: 'TOTAL_BOOKING' },
  { key: 'IN_PROCESS',          label: 'In Service Process',    color: '#6B7280', icon: 'build-outline',            meta: 'TOTAL_INPROCESS' },
  { key: 'WORK_PENDING',        label: 'Work Pending',          color: '#DC2626', icon: 'warning-outline',          meta: 'WORK_PENDING' },
  { key: 'QC_PENDING',          label: 'Quality Check Pending', color: '#E08E00', icon: 'shield-checkmark-outline', meta: 'TOTAL_INPROCESS' },
  { key: 'READY_FOR_DELIVERY',  label: 'Ready for Delivery',    color: '#035C6C', icon: 'checkmark-circle-outline', meta: 'TOTAL_PROCESSED' },
  { key: 'INVOICE_READY',       label: 'Invoice Ready',         color: '#609138', icon: 'receipt-outline',          meta: 'TOTAL_PROCESSED' },
  { key: 'DELIVERY_PROCESSING', label: 'Delivery Processing',   color: '#0571A8', icon: 'car-outline',              meta: 'OUT_FOR_DELIVERY' },
  { key: 'DELIVERED',           label: 'Delivered to Customer', color: '#1C3053', icon: 'cube-outline',             meta: 'TOTAL_DELIVERED' },
  { key: 'RETURNED',            label: 'Returned',              color: '#B45309', icon: 'return-down-back-outline', meta: 'TOTAL_DELIVERED' },
  { key: 'CANCELLED',           label: 'Cancelled',             color: '#6B7280', icon: 'close-circle-outline',     meta: 'TOTAL_BOOKING' },
];
const KINDS = [
  ['ALL', 'All Services'], ['ORIGINAL', 'Original Service'], ['RE_SERVICE', 'Re-Service'],
  ['WARRANTY', 'Warranty Re-Service'], ['PAID', 'Paid Re-Service'], ['FREE_REWORK', 'Free Rework'],
];
const PERIODS = [['ALL', 'All Time'], ['TODAY', 'Today'], ['WEEK', 'This Week'], ['MONTH', 'This Month'], ['CUSTOM', 'Custom Range']];

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** Booking-date range (device local = India time) for a period; null = all time. */
function rangeFor(period, custom) {
  const today = new Date();
  if (period === 'TODAY') return { from: iso(today), to: iso(today) };
  if (period === 'WEEK') {
    const start = new Date(today); start.setDate(today.getDate() - ((today.getDay() + 6) % 7)); // Monday
    return { from: iso(start), to: iso(today) };
  }
  if (period === 'MONTH') return { from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: iso(today) };
  if (period === 'CUSTOM' && custom) return custom;
  return { from: null, to: null };
}
/** "27-11-2026" → "2026-11-27" (null if not a real date). */
function parseDmy(s) {
  const m = String(s || '').trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return d.getDate() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 ? iso(d) : null;
}
const dmy = (isoDate) => (isoDate ? isoDate.split('-').reverse().join('-') : '');

function Chip({ label, on, onPress }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected: on }}
      className="rounded-full px-3 mr-2 active:opacity-80"
      style={{ height: 30, justifyContent: 'center', borderWidth: 1.5, borderColor: on ? '#035C6C' : '#E5E7EB', backgroundColor: on ? '#E5F3F5' : '#FFFFFF' }}>
      <Text style={{ fontSize: 12, fontWeight: '800', color: on ? '#035C6C' : '#111111' }}>{label}</Text>
    </Pressable>
  );
}

export default function BookingStatusScreen({ navigation }) {
  const [kind, setKind] = useState('ALL');
  const [period, setPeriod] = useState('ALL');
  const [custom, setCustom] = useState(null); // { from, to } ISO
  const [customOpen, setCustomOpen] = useState(false);
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');
  const [customErr, setCustomErr] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const seq = useRef(0);

  const range = rangeFor(period, custom);
  const periodLabel = period === 'CUSTOM' && custom ? `${dmy(custom.from)} to ${dmy(custom.to)}` : PERIODS.find((p) => p[0] === period)[1];

  const load = useCallback(async () => {
    const my = ++seq.current; // newest filter wins
    setLoading(true);
    setError(null);
    try {
      const r = await ticketApi.get('/tickets/status-report', { query: { kind, from: range.from || undefined, to: range.to || undefined } });
      if (my === seq.current) setData(r);
    } catch (e) {
      // Never show zeros for a failed load — show the error and keep nothing stale.
      if (my === seq.current) { setData(null); setError(e?.message || 'Could not load the service status.'); }
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [kind, range.from, range.to]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const count = (key) => {
    const b = (data?.buckets || []).find((x) => x.key === key);
    return b ? String(b.count).padStart(2, '0') : '—';
  };
  const s = data?.summary || {};
  const open = (t) => navigation.navigate('BookingStatusReport', {
    label: t.label, icon: t.meta, bucket: t.key, kind, from: range.from, to: range.to,
    periodLabel: `${KINDS.find((k) => k[0] === kind)[1]} · ${periodLabel}`,
  });

  const applyCustom = () => {
    const f = parseDmy(fromText);
    const t = parseDmy(toText);
    if (!f || !t) { setCustomErr('Enter both dates as DD-MM-YYYY.'); return; }
    if (t < f) { setCustomErr('The end date is before the start date.'); return; }
    setCustom({ from: f, to: t });
    setPeriod('CUSTOM');
    setCustomOpen(false);
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Booking Status" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerClassName="px-4 pt-4 pb-12">
        {/* Capped + centred on tablets so the 2-up tiles don't stretch. */}
        <ResponsiveContainer pad={false}>
        <View className="flex-row items-center mb-4">
          {/* Current status of the services booked in the chosen period. */}
          <Text className="flex-1 font-bold text-text">Service Status Summary</Text>
          <Pressable onPress={() => navigation.navigate('BookingPreviousReport')} hitSlop={8} accessibilityRole="button" className="active:opacity-60">
            <Text className="text-primary font-semibold underline">Previous Report</Text>
          </Pressable>
        </View>

        <Pressable
          onPress={() => navigation.navigate('ShopServiceStatus')}
          className="bg-primary rounded-2xl py-3 px-4 mb-4 flex-row items-center justify-center active:opacity-80"
        >
          <Ionicons name="create-outline" size={18} color="#fff" />
          <Text className="text-white font-bold ml-2">Update Customer Service Status</Text>
        </Pressable>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2">
          {KINDS.map(([k, l]) => <Chip key={k} label={l} on={kind === k} onPress={() => setKind(k)} />)}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-3">
          {PERIODS.map(([p, l]) => (
            <Chip key={p} label={p === 'CUSTOM' && custom ? periodLabel : l} on={period === p}
              onPress={() => {
                if (p !== 'CUSTOM') { setPeriod(p); return; }
                setFromText(dmy(custom?.from)); setToText(dmy(custom?.to)); setCustomErr(null); setCustomOpen(true);
              }} />
          ))}
        </ScrollView>

        {error ? (
          <View className="bg-card rounded-2xl p-4 items-center">
            <Ionicons name="cloud-offline-outline" size={26} color="#B3261E" />
            <Text className="text-[13px] text-center mt-2" style={{ color: '#B3261E' }}>{error}</Text>
            <Pressable onPress={load} accessibilityRole="button" className="mt-3 rounded-full px-5 active:opacity-80" style={{ height: 36, justifyContent: 'center', backgroundColor: '#035C6C' }}>
              <Text className="text-white font-bold text-[12.5px]">Retry</Text>
            </Pressable>
          </View>
        ) : !data ? <ActivityIndicator color="#035C6C" style={{ marginTop: 16 }} /> : (
          <>
            {/* Visit summary — bookings vs visits vs current state. */}
            <View className="bg-card rounded-2xl px-3 py-3 mb-2" style={{ opacity: loading ? 0.6 : 1 }}>
              <View className="flex-row flex-wrap">
                {[
                  ['Unique Bookings', s.uniqueBookings], ['Total Service Visits', s.totalVisits], ['Original Services', s.originalServices],
                  ['Re-Service Visits', s.reServiceVisits], ['Active Services', s.activeServices, 'ACTIVE'], ['Delivered in Period', s.deliveredInPeriod],
                ].map(([k, v, bucket]) => (
                  <Pressable key={k} disabled={!bucket} onPress={() => open({ key: bucket, label: 'Active Services', meta: 'TOTAL_INPROCESS' })}
                    className="w-1/3 py-1.5 pr-1" accessibilityRole={bucket ? 'button' : 'text'}>
                    <Text className="text-[10.5px] text-text-muted" numberOfLines={1}>{k}</Text>
                    <Text className="font-extrabold text-[16px]" style={{ color: bucket ? '#035C6C' : '#111111' }}>{v ?? '—'}</Text>
                  </Pressable>
                ))}
              </View>
              <Text className="text-[10.5px] text-text-muted mt-1">
                Cards show each service's current status ({periodLabel.toLowerCase()} bookings). Delivered in Period counts actual hand-overs.
              </Text>
            </View>

            <View className="flex-row flex-wrap" style={{ opacity: loading ? 0.6 : 1 }}>
              {TILES.map((t) => (
                <View key={t.key} className="w-1/2 p-2">
                  <Pressable
                    onPress={() => open(t)}
                    accessibilityRole="button"
                    accessibilityLabel={`${t.label}, ${count(t.key)} services`}
                    style={{ backgroundColor: t.color }}
                    className="rounded-2xl py-6 items-center active:opacity-80"
                  >
                    <Ionicons name={t.icon} size={28} color="#fff" />
                    <Text className="text-white font-bold mt-2 text-center">{t.label}</Text>
                    <Text className="text-white font-extrabold text-2xl mt-1">{count(t.key)}</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          </>
        )}
        </ResponsiveContainer>
      </ScrollView>

      {/* Custom date range — typed dates (no native picker, so it ships OTA). */}
      <SafeModal visible={customOpen} transparent animationType="fade" onRequestClose={() => setCustomOpen(false)}>
        <ModalInsets>
          {({ insets, keyboard }) => (
            <Pressable className="flex-1 bg-black/50 items-center justify-center px-6"
              style={{ paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, keyboard) }} onPress={() => setCustomOpen(false)}>
              <Pressable className="bg-card rounded-3xl p-5 w-full" style={{ maxWidth: 420 }} onPress={() => {}}>
                <Text className="text-text text-[14px] font-extrabold">Custom Date Range</Text>
                <Text className="text-text-muted text-[12px] mt-1">Booking date, DD-MM-YYYY</Text>
                {[['From', fromText, setFromText], ['To', toText, setToText]].map(([l, v, set]) => (
                  <View key={l} className="mt-3">
                    <Text className="text-text-muted text-[11.5px] font-bold mb-1">{l}</Text>
                    <TextInput value={v} onChangeText={(x) => { set(x.replace(/[^0-9-]/g, '').slice(0, 10)); setCustomErr(null); }}
                      placeholder="DD-MM-YYYY" placeholderTextColor="#9CA3AF" keyboardType="numbers-and-punctuation" maxLength={10}
                      className="rounded-xl border border-border bg-background px-3 py-2.5 text-text text-[13px]" accessibilityLabel={`${l} date`} />
                  </View>
                ))}
                {customErr ? <Text className="text-[12px] mt-2" style={{ color: '#B3261E' }}>{customErr}</Text> : null}
                <View className="flex-row mt-4">
                  <Pressable onPress={() => setCustomOpen(false)} className="flex-1 mr-2 rounded-2xl bg-background border border-border py-3 items-center active:opacity-80">
                    <Text className="text-text-muted text-[12px] font-extrabold">Cancel</Text>
                  </Pressable>
                  <Pressable onPress={applyCustom} className="flex-1 rounded-2xl py-3 items-center active:opacity-80" style={{ backgroundColor: '#035C6C' }}>
                    <Text className="text-white text-[12px] font-extrabold">Apply</Text>
                  </Pressable>
                </View>
              </Pressable>
            </Pressable>
          )}
        </ModalInsets>
      </SafeModal>
    </View>
  );
}

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ticketApi } from '../../../api/client';

// Re-Service as linked service records (server: POST /tickets with reServiceOf,
// GET /tickets/{id}/service-records). The delivered service is never reopened:
// each Re-Service is its own ticket (GTS-231-R01 …) with its own history,
// invoice, payment, technician, photos and delivery.

const TEAL = '#035C6C';
const MINT = '#E5F3F5';
const INK = '#111111';
const MUTED = '#6B7280';

const CLOSED = ['DELIVERED', 'CANCELLED'];

export const recordLabel = (r) => (!r?.serviceCycleNo ? 'Original' : `Re-Service ${String(r.serviceCycleNo).padStart(2, '0')}`);
const statusLabel = (s) => String(s || '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || '—';
const fmtDate = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
};

/** The chain's active service, else its latest — what Booking Details opens on. */
export const preferredRecord = (records) => {
  if (!records?.length) return null;
  return [...records].reverse().find((r) => !CLOSED.includes(String(r.status || '').toUpperCase())) || records[records.length - 1];
};


/**
 * Service records of the ticket's chain. Reloads on focus (a Re-Service made in
 * the wizard shows up on return).
 * supported: null = loading · true · false = server predates linked Re-Service
 * (404) · 'error' = couldn't check (network) — never silently fall back then.
 */
export function useServiceRecords(ticketId) {
  const [state, setState] = useState({ records: null, supported: null });
  const seq = useRef(0);
  useEffect(() => { setState({ records: null, supported: null }); }, [ticketId]);
  const reload = useCallback(() => {
    if (!ticketId) return;
    const n = ++seq.current; // only the newest response may land (fast tab switches / retries)
    ticketApi.get(`/tickets/${ticketId}/service-records`)
      .then((r) => { if (n === seq.current) setState({ records: Array.isArray(r) ? r : [], supported: Array.isArray(r) }); })
      .catch((e) => { if (n === seq.current) setState((s) => ({ records: s.records, supported: s.supported === true ? true : e?.status === 404 ? false : 'error' })); });
  }, [ticketId]);
  useFocusEffect(useCallback(() => { reload(); return undefined; }, [reload]));
  return { ...state, reload };
}

const DELIVERY_STATUS = {
  DELIVERED: 'Delivered to Customer', PENDING: 'Delivery Pending', UNASSIGNED: 'Delivery Scheduled', ASSIGNED: 'Employee Assigned',
  ACCEPTED: 'Employee Accepted', COLLECTED: 'Collected from Shop', OUT_FOR_DELIVERY: 'Out for Delivery', ARRIVED: 'Arrived at Customer',
  FAILED: 'Delivery Failed', RETURNING: 'Returning to Shop', RETURNED: 'Returned to Shop',
};
const fmtWhen = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime())
    ? `${d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })}`
    : null;
};
const hhmm = (t) => (t ? String(t).slice(0, 5) : '');

/**
 * DELIVERY HISTORY — each service record's own hand-over (never borrowed from
 * another record; delivered time is the actual hand-over, not the invoice).
 */
export function DeliveryHistory({ records, currentId, onPhotos }) {
  return (
    <View style={{ backgroundColor: '#FFFFFF', borderRadius: 16, padding: 10 }}>
      {records.map((r, idx) => {
        const d = r.delivery || {};
        const done = String(d.status || '').toUpperCase() === 'DELIVERED';
        const failed = String(d.status || '').toUpperCase() === 'FAILED';
        const rows = [
          ['Method', d.method === 'DOORSTEP' ? 'Doorstep delivery' : d.method === 'WALK_IN' ? 'Walk-in / shop hand-over' : null],
          ['Employee', d.employee],
          ['Scheduled', d.scheduledDate ? `${d.scheduledDate}${d.slotStart ? ` · ${hhmm(d.slotStart)}–${hhmm(d.slotEnd)}` : ''}` : null],
          ['Delivered', fmtWhen(d.deliveredAt)],
          ['Delivered by', d.deliveredBy],
          ['Attempts', d.attempts > 1 ? String(d.attempts) : null],
          ['Verification', d.verification],
          ['Failed', failed || d.failReason ? [fmtWhen(d.failedAt), d.failReason].filter(Boolean).join(' · ') : null],
          ['Collected', d.amountCollected != null && Number(d.amountCollected) > 0 ? `₹${Number(d.amountCollected).toLocaleString('en-IN')}${d.paymentMethod ? ` · ${d.paymentMethod}` : ''}` : null],
        ].filter(([, v]) => v);
        return (
          <View key={r.id} style={{ paddingVertical: 8, borderTopWidth: idx ? 1 : 0, borderTopColor: '#F3F4F6' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ flex: 1, fontSize: 12.5, fontWeight: '800', color: r.id === currentId ? TEAL : INK }} numberOfLines={1}>
                {recordLabel(r)} – {r.trackingId}
              </Text>
              <Text style={{ fontSize: 11.5, fontWeight: '800', color: done ? '#476B26' : failed ? '#B3261E' : '#B45309' }}>
                {DELIVERY_STATUS[String(d.status || '').toUpperCase()] || statusLabel(d.status)}
              </Text>
            </View>
            {rows.map(([k, v]) => (
              <View key={k} style={{ flexDirection: 'row', marginTop: 2 }}>
                <Text style={{ width: 92, fontSize: 11, color: MUTED }}>{k}</Text>
                <Text style={{ flex: 1, fontSize: 11.5, fontWeight: '600', color: INK }}>{v}</Text>
              </View>
            ))}
            {d.proofPhotos?.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingTop: 6 }}>
                {d.proofPhotos.map((uri, i) => (
                  <Pressable key={`${uri}-${i}`} onPress={() => onPhotos?.(d.proofPhotos, i)} accessibilityRole="imagebutton" accessibilityLabel={`Delivery photo ${i + 1}`}>
                    <Image source={{ uri }} style={{ width: 48, height: 48, borderRadius: 8, backgroundColor: MINT }} />
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** Compact SERVICE RECORDS tabs: Original | Re-Service 01 | … + the selected record's facts. */
export function ServiceRecordsBar({ records, currentId, onSelect }) {
  const cur = records.find((r) => r.id === currentId) || records[0];
  const chip = recordStatusChip(cur.status);
  return (
    <View style={{ backgroundColor: '#FFFFFF', borderRadius: 16, padding: 10 }}>
      {/* Segmented tabs: Original | Re-Service 1 | Re-Service 2 … (scrolls when many). */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ flexDirection: 'row', backgroundColor: '#F3F4F6', borderRadius: 10, padding: 3 }}>
        {records.map((r) => {
          const on = r.id === cur.id;
          return (
            <Pressable key={r.id} onPress={() => (on ? null : onSelect(r))} accessibilityRole="tab" accessibilityState={{ selected: on }}
              style={{ height: 28, paddingHorizontal: 12, borderRadius: 8, justifyContent: 'center',
                backgroundColor: on ? '#FFFFFF' : 'transparent', elevation: on ? 1 : 0,
                shadowColor: '#000', shadowOpacity: on ? 0.08 : 0, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } }}>
              <Text style={{ fontSize: 11.5, fontWeight: on ? '800' : '600', color: on ? INK : MUTED }}>{tabLabel(r)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {/* Selected record: Re-Service #02 · #GTS-231-R02 · date, status chip on the right. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 13.5, fontWeight: '800', color: INK }} numberOfLines={1}>{recordTitle(cur)}</Text>
          <Text style={{ fontSize: 11, fontWeight: '700', color: TEAL, marginTop: 1 }} numberOfLines={1}>#{cur.trackingId || '—'}</Text>
          <Text style={{ fontSize: 11, color: MUTED, marginTop: 1 }}>{fmtDate(cur.createdAt)}</Text>
        </View>
        <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: chip.bg, marginLeft: 8 }}>
          <Text style={{ fontSize: 11, fontWeight: '800', color: chip.fg }}>{chip.label}</Text>
        </View>
      </View>
    </View>
  );
}

/** "Original" / "Re-Service 1" for the tabs; "Original Service" / "Re-Service #02" as the title. */
const tabLabel = (r) => (!r?.serviceCycleNo ? 'Original' : `Re-Service ${r.serviceCycleNo}`);
export const recordTitle = (r) => (!r?.serviceCycleNo ? 'Original Service' : `Re-Service #${String(r.serviceCycleNo).padStart(2, '0')}`);

/** Status chip of a record (current state, owner wording). */
export function recordStatusChip(status) {
  const s = String(status || '').toUpperCase();
  const blue = { fg: '#0788C9', bg: '#E6F4FB' };
  const green = { fg: '#476B26', bg: '#EDF4E7' };
  const amber = { fg: '#B45309', bg: '#FFF4DB' };
  const red = { fg: '#B3261E', bg: '#FDECEA' };
  if (s === 'DELIVERED') return { label: 'Delivered', ...green };
  if (s === 'CANCELLED') return { label: 'Cancelled', ...red };
  if (s === 'DELIVERED_PROCESSING') return { label: 'Delivery Processing', ...blue };
  if (s === 'INVOICE_GENERATED' || s === 'INVOICE_READY') return { label: 'Invoice Ready', ...green };
  if (s === 'READY') return { label: 'Ready for Delivery', ...green };
  if (s === 'QUOTED' || s === 'APPROVED') return { label: 'Work Pending', ...amber };
  if (s === 'IN_DIAGNOSIS' || s === 'IN_REPAIR') return { label: 'In Service Process', ...blue };
  return { label: 'Service Accepted', ...amber };
}


import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Eye, FileText, RefreshCcw } from 'lucide-react-native';
import { ScreenHeader } from '../../../components/rnr';
import { ticketApi } from '../../../api/client';
import { recordLabel } from './ReServiceParts';

// Invoice History: every service record of the device's chain (Original,
// Re-Service 01, …) with ITS OWN invoice — fetched per record from
// GET /tickets/{recordId}/invoice, so View / PDF / Share / WhatsApp / Print in
// the invoice screen always use that record's invoice. Estimates that were
// never invoiced are listed but not counted.

const TEAL = '#035C6C';
const INK = '#111111';
const MUTED = '#6B7280';
const GREEN = '#476B26';
const AMBER = '#B45309';
const n = (v) => Number(v || 0);
const inr = (v) => `₹${n(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const fmt = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime())
    ? `${d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })}`
    : '—';
};
const TYPE = { ORIGINAL: 'Original Service', WARRANTY: 'Warranty Re-Service', PAID: 'Paid Re-Service', FREE_REWORK: 'Free Rework' };
const notesOf = (r) => { try { return JSON.parse(r?.reServiceNotes || '{}') || {}; } catch (_) { return {}; } };

/** Money of one invoice: total, received (advance + paid at billing), outstanding credit. */
export function invoiceMoney(inv) {
  const total = n(inv.finalPayableAmount ?? inv.netPayableAmount);
  const received = n(inv.advancePaid) + n(inv.amountPaid);
  const outstanding = Math.max(0, inv.creditAmount != null ? n(inv.creditAmount) : total - received);
  const status = total === 0 ? 'No Charge' : outstanding > 0 ? (received > 0 ? 'Part Paid · Credit' : 'Credit') : 'Settled';
  return { total, received, outstanding, status };
}

function Line({ k, v, bold, color }) {
  return (
    <View style={{ flexDirection: 'row', paddingVertical: 2 }}>
      <Text style={{ flex: 1, fontSize: 12, color: MUTED }}>{k}</Text>
      <Text style={{ fontSize: 12.5, fontWeight: bold ? '800' : '700', color: color || INK }}>{v}</Text>
    </View>
  );
}

export default function InvoiceHistoryScreen({ route, navigation }) {
  const { ticketId } = route.params || {};
  const [rows, setRows] = useState(null); // [{ record, invoice|null }]
  const [error, setError] = useState(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const my = ++seq.current;
    setError(null);
    try {
      const records = await ticketApi.get(`/tickets/${ticketId}/service-records`);
      const list = Array.isArray(records) ? records : [];
      const invoices = await Promise.all(list.map((r) => ticketApi.get(`/tickets/${r.id}/invoice`)
        .then((inv) => (inv && (inv.invoiceNo || inv.id) ? inv : null))
        .catch((e) => (e?.status === 404 ? null : Promise.reject(e)))));
      if (my === seq.current) setRows(list.map((record, i) => ({ record, invoice: invoices[i] })));
    } catch (e) {
      if (my === seq.current) setError(e?.message || 'Could not load the invoice history.');
    }
  }, [ticketId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const invoiced = (rows || []).filter((r) => r.invoice).map((r) => invoiceMoney(r.invoice));
  const totals = invoiced.reduce((a, m) => ({ total: a.total + m.total, received: a.received + m.received, outstanding: a.outstanding + m.outstanding }),
    { total: 0, received: 0, outstanding: 0 });

  return (
    <View style={{ flex: 1, backgroundColor: '#F3F4F6' }}>
      <ScreenHeader title="Invoice History" onBack={() => navigation.goBack()} />
      {error ? (
        <View style={{ padding: 24, alignItems: 'center' }}>
          <Text style={{ fontSize: 13, color: '#B3261E', textAlign: 'center' }}>{error}</Text>
          <Pressable onPress={load} accessibilityRole="button" style={{ marginTop: 12, paddingHorizontal: 18, height: 38, borderRadius: 19, backgroundColor: TEAL, justifyContent: 'center' }}>
            <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 12.5 }}>Retry</Text>
          </Pressable>
        </View>
      ) : !rows ? <ActivityIndicator color={TEAL} style={{ marginTop: 32 }} /> : (
        <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 40, width: '100%', maxWidth: 760, alignSelf: 'center' }}>
          {/* Combined summary — invoiced amounts only; each invoice counted once. */}
          <View style={{ backgroundColor: '#FFFFFF', borderRadius: 16, padding: 12 }}>
            <Text style={{ fontSize: 12, fontWeight: '800', color: INK, letterSpacing: 0.6 }}>ALL SERVICES</Text>
            <View style={{ flexDirection: 'row', marginTop: 8 }}>
              {[['Total Invoiced', totals.total, TEAL], ['Total Received', totals.received, GREEN], ['Outstanding', totals.outstanding, totals.outstanding > 0 ? AMBER : MUTED]].map(([k, v, c]) => (
                <View key={k} style={{ flex: 1 }}>
                  <Text style={{ fontSize: 10.5, color: MUTED }}>{k}</Text>
                  <Text style={{ fontSize: 15, fontWeight: '800', color: c }}>{inr(v)}</Text>
                </View>
              ))}
            </View>
            <Text style={{ fontSize: 10.5, color: MUTED, marginTop: 6 }}>
              {invoiced.length} of {rows.length} service{rows.length === 1 ? '' : 's'} invoiced · estimates not invoiced are not counted · no refunds recorded
            </Text>
          </View>

          {rows.map(({ record: r, invoice: inv }) => {
            const m = inv ? invoiceMoney(inv) : null;
            const notes = notesOf(r);
            const warrantyDoc = inv && m.total === 0 && (r.serviceType === 'WARRANTY' || r.serviceType === 'FREE_REWORK');
            const split = inv && (inv.cashAmount != null || inv.upiAmount != null);
            return (
              <View key={r.id} style={{ backgroundColor: '#FFFFFF', borderRadius: 16, padding: 12, marginTop: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#E5F3F5', alignItems: 'center', justifyContent: 'center' }}>
                    {r.serviceCycleNo ? <RefreshCcw size={14} color={TEAL} /> : <FileText size={14} color={TEAL} />}
                  </View>
                  <View style={{ flex: 1, marginLeft: 8 }}>
                    <Text style={{ fontSize: 13, fontWeight: '800', color: INK }}>{recordLabel(r)} – {r.trackingId}</Text>
                    <Text style={{ fontSize: 11, color: MUTED }}>{TYPE[r.serviceType] || '—'}</Text>
                  </View>
                  {m ? (
                    <Text style={{ fontSize: 12, fontWeight: '800', color: m.status === 'Settled' || m.status === 'No Charge' ? GREEN : AMBER }}>{m.status}</Text>
                  ) : <Text style={{ fontSize: 12, fontWeight: '700', color: MUTED }}>Not invoiced</Text>}
                </View>

                {inv ? (
                  <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#F3F4F6' }}>
                    <Line k={warrantyDoc ? 'Warranty service document' : 'Invoice No.'} v={inv.invoiceNo || '—'} />
                    {notes.previousInvoiceNo ? <Line k="Original invoice ref." v={notes.previousInvoiceNo} /> : null}
                    <Line k="Generated" v={fmt(inv.generatedAt)} />
                    <Line k="Service charges" v={inr(inv.serviceCharges)} />
                    <Line k="Spare parts" v={inr(inv.spareUtilityCharge)} />
                    {n(inv.discount) > 0 ? <Line k="Discount" v={`− ${inr(inv.discount)}`} /> : null}
                    {n(inv.totalGst) > 0 ? <Line k={`GST${n(inv.gstPercent) ? ` (${n(inv.gstPercent)}%)` : ''}`} v={inr(inv.totalGst)} /> : null}
                    <Line k="Invoice total" v={inr(m.total)} bold color={TEAL} />
                    {n(inv.advancePaid) > 0 ? <Line k="Advance paid" v={inr(inv.advancePaid)} /> : null}
                    {split ? (
                      <>
                        <Line k="Cash received" v={inr(inv.cashAmount)} />
                        <Line k="UPI received" v={inr(inv.upiAmount)} />
                      </>
                    ) : n(inv.amountPaid) > 0 ? <Line k="Paid at billing" v={inr(inv.amountPaid)} /> : null}
                    <Line k="Outstanding credit" v={inr(m.outstanding)} color={m.outstanding > 0 ? AMBER : INK} />
                    <Pressable onPress={() => navigation.navigate('DeliveryInvoiceReport', { ticketId: r.id })} accessibilityRole="button"
                      style={{ marginTop: 8, height: 38, borderRadius: 12, borderWidth: 1.5, borderColor: TEAL, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                      <Eye size={14} color={TEAL} />
                      <Text style={{ marginLeft: 6, fontSize: 12, fontWeight: '800', color: TEAL }}>View / Download / Share</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Text style={{ fontSize: 11.5, color: MUTED, marginTop: 6 }}>
                    {String(r.status || '').toUpperCase() === 'CANCELLED' ? 'Cancelled — no invoice.' : 'Invoice not generated yet.'}
                  </Text>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

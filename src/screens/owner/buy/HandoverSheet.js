import React, { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { PackageCheck, Phone, X } from 'lucide-react-native';
import SafeModal, { ModalInsets } from '../../../components/SafeModal';
import { receivePurchaseDevice } from '../../../api/orders';
import { showToast } from '../../../components/Toast';
import { rf } from '../../../utils/responsive';
import { C, CheckRow, ErrorBox, PrimaryButton, TextField, money } from '../sell/kit';
import { DeviceRow, up, whenLabel } from './purchaseKit';

// Compact Shop Handover popup (Order Details → Verify Shop Handover). Same checks
// and server call as BuyHandoverScreen (POST …/receive { imei, orderVerified,
// conditionVerified }); uses the order already loaded, no second fetch.

const METHOD = { UPI: 'UPI', BANK: 'Bank transfer', CASH: 'Cash' };
const digits = (v) => String(v || '').replace(/\D/g, '');

function Line({ label, value, bold }) {
  return (
    <View style={{ flexDirection: 'row', paddingVertical: 4 }}>
      <Text style={{ width: 104, fontSize: rf(11.5), color: C.muted }}>{label}</Text>
      <Text style={{ flex: 1, fontSize: rf(12), fontWeight: bold ? '800' : '600', color: C.text }}>{value}</Text>
    </View>
  );
}

export default function HandoverSheet({ visible, o, onClose, onDone }) {
  const [okOrder, setOkOrder] = useState(false);
  const [okCondition, setOkCondition] = useState(false);
  const [okImei, setOkImei] = useState(false);
  const [imei, setImei] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const lock = useRef(false);

  useEffect(() => {
    if (!visible) return;
    setOkOrder(false); setOkCondition(false); setOkImei(false); setImei(''); setError(null);
  }, [visible]);

  if (!o) return null;
  const pk = o.pickup || {};
  const pin = o.pickupInspection || {};
  const pay = o.payment || {};
  const expectedImei = digits(pin.imei || o.imei);
  const imeiMatch = expectedImei ? digits(imei) === expectedImei : okImei;
  const condition = (pin.compare || []).find((r) => r?.key === 'condition')?.actual || pin.condition || o.condition || null;
  const canReceive = (o.allowedActions || []).includes('RECEIVE');
  const ready = okOrder && okCondition && imeiMatch && canReceive;

  const submit = async () => {
    if (!ready || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const d = await receivePurchaseDevice(o.id, { imei: imei || null, orderVerified: okOrder, conditionVerified: okCondition });
      showToast({ type: 'success', title: 'Handover confirmed', message: up(d?.status) === 'PAYMENT_PENDING' ? 'Waiting for the customer to confirm the payment.' : 'Device received at the shop.' });
      onDone?.(d);
    } catch (e) {
      setError(e);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  return (
    <SafeModal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <ModalInsets>
        {() => (
          <View style={{ flex: 1, backgroundColor: 'rgba(17,17,17,0.45)', justifyContent: 'center', padding: 16 }}>
            <Pressable style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }} onPress={onClose} accessibilityLabel="Close" />
            <View style={{ width: '100%', maxWidth: 440, alignSelf: 'center', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 16, maxHeight: '88%' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: rf(15), fontWeight: '800', color: C.text }}>Verify Shop Handover</Text>
                  <Text style={{ fontSize: rf(11.5), color: C.muted, marginTop: 1 }}>{o.orderNumber || ''}</Text>
                </View>
                <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close" style={{ height: 32, width: 32, borderRadius: 16, backgroundColor: C.field, alignItems: 'center', justifyContent: 'center' }}>
                  <X size={15} color={C.text} />
                </Pressable>
              </View>
              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ marginTop: 12 }}>
                <View style={{ backgroundColor: C.field, borderRadius: 12, padding: 10 }}>
                  <DeviceRow o={o} size={44} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
                  <Text numberOfLines={2} style={{ flex: 1, fontSize: rf(12), color: C.text }}>
                    <Text style={{ fontWeight: '800' }}>{pk.personName || 'Pickup person'}</Text>
                    {pk.handedOverAt ? ` · Handed over ${whenLabel(pk.handedOverAt)}` : ''}
                  </Text>
                  {pk.personPhone ? (
                    <Pressable onPress={() => Linking.openURL(`tel:${pk.personPhone}`).catch(() => {})} accessibilityRole="button" accessibilityLabel="Call pickup person"
                      style={{ height: 34, width: 34, borderRadius: 17, backgroundColor: C.mint, alignItems: 'center', justifyContent: 'center', marginLeft: 8 }}>
                      <Phone size={16} color={C.teal} />
                    </Pressable>
                  ) : null}
                </View>
                <View style={{ borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingHorizontal: 10, paddingVertical: 4, marginTop: 10 }}>
                  <Line label="Expected IMEI" value={pin.imei || o.imei || 'Not recorded'} />
                  <Line label="Condition" value={condition || '—'} />
                  <Line label="Final price" value={money(pay.amount ?? o.amount)} bold />
                  <Line label="Payment" value={pay.recordedAt ? `${METHOD[pay.method] || pay.method || '—'} · ${pay.status === 'PAID' ? 'Verified' : 'Awaiting customer'}` : 'Not recorded'} />
                </View>

                <CheckRow label={`Order ID matches ${o.orderNumber || ''}`.trim()} sub="Check the device / pickup slip" checked={okOrder} onToggle={() => setOkOrder((v) => !v)} style={{ marginTop: 12 }} />
                {expectedImei ? (
                  <TextField label="IMEI on the device" required value={imei} onChangeText={(t) => setImei(digits(t).slice(0, 17))}
                    placeholder="Dial *#06# and enter the IMEI" keyboardType="number-pad" maxLength={17}
                    error={imei && !imeiMatch ? 'Does not match the inspected IMEI' : null} style={{ marginTop: 8 }} />
                ) : (
                  <CheckRow label="IMEI checked on the device" sub="No IMEI recorded at the doorstep" checked={okImei} onToggle={() => setOkImei((v) => !v)} style={{ marginTop: 8 }} />
                )}
                <CheckRow label="Condition matches the inspection" sub={condition ? `Inspected: ${condition}` : 'Compare with the inspection photos'} checked={okCondition} onToggle={() => setOkCondition((v) => !v)} style={{ marginTop: 8 }} />
                {!canReceive ? <Text style={{ fontSize: rf(11.5), color: C.amber, marginTop: 8 }}>Receipt can be confirmed once the employee has collected the device.</Text> : null}
                {error ? <ErrorBox message={error.message || 'Could not confirm the handover.'} style={{ marginTop: 10 }} /> : null}
              </ScrollView>
              <PrimaryButton title="Confirm Receipt" icon={PackageCheck} loading={busy} disabled={!ready || busy} onPress={submit} style={{ marginTop: 12 }} />
            </View>
          </View>
        )}
      </ModalInsets>
    </SafeModal>
  );
}

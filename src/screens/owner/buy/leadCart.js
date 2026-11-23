import AsyncStorage from '@react-native-async-storage/async-storage';

// "Cart" for customer sell leads: a shortlist kept ON THIS PHONE only (no
// server, not the fixed-price product cart). Stores the lead snapshot so the
// Requests → Cart tab can list it; open leads are refreshed from the feed.

const KEY = 'buy:leadCart:v1';

async function read() {
  try {
    const v = JSON.parse((await AsyncStorage.getItem(KEY)) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function write(list) {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage full / unavailable: ignore */ }
}

export const listLeadCart = read;

export async function inLeadCart(id) {
  return (await read()).some((l) => String(l.id) === String(id));
}

/** Adds the lead (newest first); returns true. */
export async function addLeadToCart(lead) {
  const list = (await read()).filter((l) => String(l.id) !== String(lead.id));
  await write([{ ...lead, savedAt: new Date().toISOString() }, ...list].slice(0, 200));
  return true;
}

export async function removeLeadFromCart(id) {
  await write((await read()).filter((l) => String(l.id) !== String(id)));
  return false;
}

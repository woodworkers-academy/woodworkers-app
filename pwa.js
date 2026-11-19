/* Woodworkers Academy Van Inventory PWA support.
 * Handles API calls, offline cache, queued log entries, and reconnect sync.
 */

const WA_API_URL = 'https://script.google.com/macros/s/AKfycbzydKDcX1IORJR0stTOmACkaD0grgVPWEDsk_ie1w7xpBa_fXDDcx7YS8XJrMuruazC/exec';
const WA_API_KEY = 'wa_7uK4nP9qR2mX8cV5sD1fH6jL3bT0yE';
const WA_DB_NAME = 'woodworkers-van-inventory';
const WA_DB_VERSION = 1;
const WA_APP_VERSION = '1.20.21';
let waDbPromise = null;
let waSyncInProgress = false;
let waServerState = 'unknown'; // unknown | live | unreachable
let waLastServerError = '';
let waLastServerSuccess = null;
let waBackendVersion = null;

function waCanTryServer() {
  // Do not persist a temporary 'server offline' state. iOS can miss or delay
  // online/offline events when returning from airplane mode. We use
  // navigator.onLine only as a hint and let each real request decide whether
  // the server is reachable; failed requests fall back to IndexedDB.
  return navigator.onLine !== false;
}

function waMarkServerReachable() {
  waServerState = 'live';
  waLastServerError = '';
  waLastServerSuccess = new Date();
}
function waMarkServerUnreachable(error) {
  waServerState = 'unreachable';
  waLastServerError = error && error.message ? error.message : String(error || 'Could not reach server');
}

function waOpenDb() {
  if (waDbPromise) return waDbPromise;
  waDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(WA_DB_NAME, WA_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'eventId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return waDbPromise;
}

async function waDbGet(store, key) {
  const db = await waOpenDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function waDbPut(store, value, key) {
  const db = await waOpenDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    const req = key === undefined ? os.put(value) : os.put(value, key);
    req.onsuccess = () => resolve(value);
    req.onerror = () => reject(req.error);
  });
}

async function waDbDelete(store, key) {
  const db = await waOpenDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function waDbGetAll(store) {
  const db = await waOpenDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function waJsonp(action, params = {}, timeoutMs = 12000, options = {}) {
  // If the browser already knows it is offline, do not create a network request at all.
  if (navigator.onLine === false) {
    return Promise.reject(new Error('Offline'));
  }
  return new Promise((resolve, reject) => {
    const callback = '__wa_cb_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const script = document.createElement('script');
    const timer = setTimeout(() => {
      const err = new Error('Request timed out');
      if (options.affectsHealth !== false) waMarkServerUnreachable(err);
      finish(err);
    }, timeoutMs);

    function finish(err, data) {
      clearTimeout(timer);
      try { delete window[callback]; } catch (_) { window[callback] = undefined; }
      script.remove();
      err ? reject(err) : resolve(data);
    }

    window[callback] = data => {
      if (options.affectsHealth !== false) waMarkServerReachable();
      finish(null, data);
    };
    script.onerror = () => {
      const err = new Error('Could not reach inventory server');
      if (options.affectsHealth !== false) waMarkServerUnreachable(err);
      finish(err);
    };

    const query = new URLSearchParams({
      api: '1',
      key: WA_API_KEY,
      action,
      callback,
      _: String(Date.now()),
      ...params
    });
    script.src = WA_API_URL + '?' + query.toString();
    document.head.appendChild(script);
  });
}

function waMakeEventId() {
  if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'evt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12);
}

async function waPendingCount() {
  try { return (await waDbGetAll('queue')).length; }
  catch (_) { return 0; }
}

function waPendingEventsSorted_(events) {
  return (events || []).slice().sort((a, b) => {
    const ta = Date.parse(a && a.clientTimestamp ? a.clientTimestamp : '') || 0;
    const tb = Date.parse(b && b.clientTimestamp ? b.clientTimestamp : '') || 0;
    return ta - tb;
  });
}

function waPendingEventAction_(event) {
  const action = String((event && event.action) || '').trim();
  if (action === 'Other Event (Found, Disposed, Purchased, Sold)') {
    return String(event.otherEventSub || action).trim();
  }
  return action || 'Tool event';
}

function waPendingEventLocation_(event) {
  if (!event) return '';
  if (event.statusLocation) return String(event.statusLocation);
  if (event.restockTargetLocation) return String(event.restockTargetLocation);
  if (event.whichVanRestocked) {
    const extra = event.storageArea2026 ? ' • ' + event.storageArea2026 : '';
    return String(event.whichVanRestocked) + extra;
  }
  if (event.needsReplacementLocation) return String(event.needsReplacementLocation);
  if (event.vanOrLocationBroke) return String(event.vanOrLocationBroke);
  if (event.repairedMovedTo) return 'To ' + String(event.repairedMovedTo);
  if (event.transferMovedFrom || event.transferMovedTo) {
    return [event.transferMovedFrom ? 'From ' + event.transferMovedFrom : '',
            event.transferMovedTo ? 'To ' + event.transferMovedTo : '']
      .filter(Boolean).join(' • ');
  }
  if (event.otherMovedFrom || event.otherMovedTo) {
    return [event.otherMovedFrom ? 'From ' + event.otherMovedFrom : '',
            event.otherMovedTo ? 'To ' + event.otherMovedTo : '']
      .filter(Boolean).join(' • ');
  }
  return '';
}

function waPendingEventTime_(event) {
  const raw = event && event.clientTimestamp;
  const d = raw ? new Date(raw) : null;
  if (!d || Number.isNaN(d.getTime())) return 'Time unavailable';
  return d.toLocaleString([], {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });
}

function waEnsurePendingUi() {
  const bar = document.getElementById('syncStatusBar');
  const text = document.getElementById('syncStatusText');
  if (!bar || !text) return null;

  let button = document.getElementById('pendingChangesBtn');
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.id = 'pendingChangesBtn';
    button.textContent = 'Pending changes';
    button.hidden = true;
    button.setAttribute('aria-label', 'View pending changes');
    button.style.cssText = [
      'display:none',
      'flex:0 0 auto',
      'white-space:nowrap',
      'border:1px solid currentColor',
      'border-radius:999px',
      'padding:2px 8px',
      'background:rgba(255,255,255,.72)',
      'font-weight:800',
      'font-size:11px',
      'line-height:18px'
    ].join(';');
    button.addEventListener('click', waOpenPendingChanges);
    bar.appendChild(button);
  }

  let overlay = document.getElementById('pendingChangesOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'pendingChangesOverlay';
    overlay.hidden = true;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'pendingChangesTitle');
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:1000',
      'background:rgba(15,23,42,.52)',
      'padding:18px',
      'display:none',
      'align-items:flex-start',
      'justify-content:center',
      'overflow:auto'
    ].join(';');

    const panel = document.createElement('div');
    panel.style.cssText = [
      'width:100%',
      'max-width:520px',
      'margin-top:24px',
      'background:white',
      'border-radius:18px',
      'box-shadow:0 20px 45px rgba(15,23,42,.28)',
      'border:1px solid #cbd5e1',
      'overflow:hidden'
    ].join(';');

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 16px 12px;border-bottom:1px solid #e2e8f0;';
    const headText = document.createElement('div');

    const title = document.createElement('h2');
    title.id = 'pendingChangesTitle';
    title.textContent = 'Pending changes';
    title.style.cssText = 'margin:0;font-size:18px;line-height:1.3;font-weight:800;color:#0f172a;';

    const sub = document.createElement('p');
    sub.id = 'pendingChangesSubtitle';
    sub.textContent = 'Changes saved on this device that have not reached the Google Sheet yet.';
    sub.style.cssText = 'margin:4px 0 0;font-size:12px;line-height:1.45;color:#64748b;';

    headText.append(title, sub);

    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '✕';
    close.setAttribute('aria-label', 'Close pending changes');
    close.style.cssText = 'flex:0 0 auto;width:34px;height:34px;border-radius:10px;background:#f1f5f9;font-weight:800;color:#334155;';
    close.addEventListener('click', waClosePendingChanges);

    head.append(headText, close);

    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 16px;background:#f8fafc;border-bottom:1px solid #e2e8f0;';

    const count = document.createElement('span');
    count.id = 'pendingChangesCount';
    count.style.cssText = 'font-size:12px;font-weight:700;color:#475569;';

    const retryAll = document.createElement('button');
    retryAll.type = 'button';
    retryAll.id = 'pendingRetryAllBtn';
    retryAll.textContent = 'Retry all';
    retryAll.style.cssText = 'border-radius:10px;background:#4f46e5;color:white;padding:7px 11px;font-size:12px;font-weight:800;';
    retryAll.addEventListener('click', async () => {
      retryAll.disabled = true;
      retryAll.textContent = 'Retrying…';
      await waSyncPending();
      await waRenderPendingChanges();
      retryAll.disabled = false;
      retryAll.textContent = 'Retry all';
    });

    toolbar.append(count, retryAll);

    const list = document.createElement('div');
    list.id = 'pendingChangesList';
    list.style.cssText = 'padding:12px 16px 16px;display:grid;gap:10px;max-height:65vh;overflow:auto;';

    panel.append(head, toolbar, list);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', event => {
      if (event.target === overlay) waClosePendingChanges();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !overlay.hidden) waClosePendingChanges();
    });
  }

  return { bar, text, button, overlay };
}

async function waRenderPendingChanges() {
  const ui = waEnsurePendingUi();
  if (!ui) return;

  let events = [];
  try { events = waPendingEventsSorted_(await waDbGetAll('queue')); } catch (_) {}

  const list = document.getElementById('pendingChangesList');
  const count = document.getElementById('pendingChangesCount');
  const retryAll = document.getElementById('pendingRetryAllBtn');
  if (!list || !count || !retryAll) return;

  count.textContent = events.length + ' pending change' + (events.length === 1 ? '' : 's');
  retryAll.disabled = !events.length || !waCanTryServer();
  retryAll.style.opacity = retryAll.disabled ? '.5' : '1';

  list.replaceChildren();

  if (!events.length) {
    const empty = document.createElement('div');
    empty.textContent = 'Everything is synced.';
    empty.style.cssText = 'padding:24px 8px;text-align:center;color:#64748b;font-size:13px;font-weight:700;';
    list.appendChild(empty);
    return;
  }

  events.forEach(event => {
    const card = document.createElement('div');
    card.style.cssText = 'border:1px solid #cbd5e1;border-radius:14px;padding:12px;background:white;';

    const top = document.createElement('div');
    top.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:10px;';

    const titleWrap = document.createElement('div');
    titleWrap.style.cssText = 'min-width:0;';

    const item = document.createElement('div');
    item.textContent = String(event.item || 'Unnamed item');
    item.style.cssText = 'font-size:15px;font-weight:800;color:#0f172a;overflow-wrap:anywhere;';

    const action = document.createElement('div');
    action.textContent = waPendingEventAction_(event);
    action.style.cssText = 'margin-top:2px;font-size:12px;font-weight:700;color:#475569;';

    titleWrap.append(item, action);

    const qty = document.createElement('div');
    const q = Number(event.quantity);
    qty.textContent = Number.isFinite(q) ? 'Qty ' + q : '';
    qty.style.cssText = 'flex:0 0 auto;font-size:11px;font-weight:800;color:#4338ca;background:#eef2ff;border:1px solid #c7d2fe;border-radius:999px;padding:3px 7px;';

    top.append(titleWrap, qty);

    const meta = document.createElement('div');
    const loc = waPendingEventLocation_(event);
    meta.textContent = [loc, waPendingEventTime_(event)].filter(Boolean).join(' • ');
    meta.style.cssText = 'margin-top:7px;font-size:11px;line-height:1.45;color:#64748b;';

    card.append(top, meta);

    if (event._lastSyncError) {
      const err = document.createElement('div');
      err.textContent = 'Last sync error: ' + String(event._lastSyncError);
      err.style.cssText = 'margin-top:8px;padding:7px 8px;border-radius:9px;background:#fef2f2;border:1px solid #fecaca;color:#991b1b;font-size:11px;line-height:1.4;font-weight:650;overflow-wrap:anywhere;';
      card.appendChild(err);
    }

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;margin-top:10px;';

    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Retry';
    retry.style.cssText = 'flex:1;border-radius:10px;background:#4f46e5;color:white;padding:8px 10px;font-size:12px;font-weight:800;';
    retry.disabled = !waCanTryServer();
    retry.style.opacity = retry.disabled ? '.5' : '1';
    retry.addEventListener('click', async () => {
      retry.disabled = true;
      retry.textContent = 'Retrying…';
      await waRetryPendingEvent(event.eventId);
      await waRenderPendingChanges();
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.style.cssText = 'flex:1;border-radius:10px;background:#fff;color:#b91c1c;border:1px solid #fecaca;padding:8px 10px;font-size:12px;font-weight:800;';
    remove.addEventListener('click', async () => {
      await waRemovePendingEvent(event.eventId, event.item);
    });

    actions.append(retry, remove);
    card.appendChild(actions);
    list.appendChild(card);
  });
}

async function waOpenPendingChanges() {
  const ui = waEnsurePendingUi();
  if (!ui) return;
  await waRenderPendingChanges();
  ui.overlay.hidden = false;
  ui.overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function waClosePendingChanges() {
  const overlay = document.getElementById('pendingChangesOverlay');
  if (!overlay) return;
  overlay.hidden = true;
  overlay.style.display = 'none';
  document.body.style.overflow = '';
}

async function waRetryPendingEvent(eventId) {
  if (!waCanTryServer()) {
    alert('No connection is available right now. This change will remain queued.');
    return;
  }
  if (waSyncInProgress) {
    alert('Automatic sync is already running. Try this item again after that sync attempt finishes.');
    return;
  }

  const event = await waDbGet('queue', eventId);
  if (!event) {
    await waUpdateStatus();
    return;
  }

  waSyncInProgress = true;
  try {
    await waUpdateStatus('Syncing…');
    try {
      await waSendQueuedEvent(event);
      await waDbDelete('queue', eventId);
      await waDbPut('kv', new Date().toISOString(), 'lastSync');
    } catch (err) {
      event._lastSyncError = err && err.message ? err.message : String(err);
      event._lastSyncAttempt = new Date().toISOString();
      await waDbPut('queue', event);
      alert('Sync failed: ' + event._lastSyncError);
    }
  } finally {
    waSyncInProgress = false;
    await waUpdateStatus();
  }

  if (waCanTryServer()) {
    setTimeout(() => { waWarmInventoryCache(); }, 900);
  }
}

async function waRemovePendingEvent(eventId, itemName) {
  const label = String(itemName || 'this change');
  const ok = window.confirm(
    'Remove the unsynced change for "' + label + '"?\n\n' +
    'This discards it from this device and it will NOT be sent to the Google Sheet.'
  );
  if (!ok) return;

  await waDbDelete('queue', eventId);
  await waUpdateStatus();
  await waRenderPendingChanges();

  // A queued event may already have been projected into cached inventory.
  // Refresh authoritative inventory when possible after discarding it.
  if (waCanTryServer()) {
    setTimeout(() => { waWarmInventoryCache(); }, 250);
  }
}


async function waUpdateStatus(message) {
  const ui = waEnsurePendingUi();
  const bar = ui && ui.bar;
  const text = ui && ui.text;
  const pendingButton = ui && ui.button;
  if (!bar || !text || !pendingButton) return;

  const online = waCanTryServer();
  let pending = 0;
  let lastSync = null;

  // Status display must never prevent the rest of the app from starting.
  try { pending = await waPendingCount(); } catch (_) {}
  try { lastSync = await waDbGet('kv', 'lastSync'); } catch (_) {}

  let label;
  if (message) {
    label = message;
  } else if (!online) {
    label = 'Offline';
  } else if (waServerState === 'live') {
    label = 'Live data';
  } else if (waServerState === 'unreachable') {
    label = 'Using cached data';
  } else {
    label = 'Connecting…';
  }
  if (!online && message && !/^Offline\b/i.test(message)) label = 'Offline • ' + message;

  if (online && waServerState === 'unreachable' && !/syncing/i.test(label)) {
    const reason = waLastServerError === 'Request timed out'
      ? 'server timed out'
      : waLastServerError === 'Could not reach inventory server'
        ? 'server unreachable'
        : '';
    if (reason && !label.toLowerCase().includes(reason)) label += ' • ' + reason;
  }

  if (online && waServerState === 'live' && waBackendVersion === 'legacy') {
    if (!/backend update needed/i.test(label)) label += ' • backend update needed';
  }

  if (pending) {
    const alreadyMentionsPending = /waiting to sync/i.test(label);
    if (!alreadyMentionsPending && !/syncing/i.test(label)) {
      label += ' • ' + pending + ' change' + (pending === 1 ? '' : 's') + ' waiting to sync';
    } else if (/waiting to sync/i.test(label) && !new RegExp('\\b' + pending + '\\b').test(label)) {
      label = label.replace(/waiting to sync/i, pending + ' change' + (pending === 1 ? '' : 's') + ' waiting to sync');
    }
  }

  if (lastSync) {
    const when = new Date(lastSync);
    if (!Number.isNaN(when.getTime())) {
      const time = when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      if (!message && online && !pending) label = 'Synced • ' + time;
      else if (!online && !/Last synced/i.test(label)) label += ' • Last synced ' + time;
    }
  }

  text.textContent = label + ' • v' + WA_APP_VERSION;

  bar.className = 'px-4 py-1.5 text-[11px] font-bold border-b ' +
    (!online ? 'bg-amber-100 text-amber-900 border-amber-200' :
      pending ? 'bg-blue-50 text-blue-800 border-blue-200' :
      'bg-emerald-50 text-emerald-800 border-emerald-200');

  if (pending) {
    bar.style.display = 'flex';
    bar.style.alignItems = 'center';
    bar.style.justifyContent = 'center';
    bar.style.gap = '8px';
    bar.style.textAlign = 'left';
    text.style.minWidth = '0';

    pendingButton.hidden = false;
    pendingButton.style.display = 'inline-block';
    pendingButton.textContent = 'Pending (' + pending + ') ›';
  } else {
    bar.style.display = 'block';
    bar.style.textAlign = 'center';
    pendingButton.hidden = true;
    pendingButton.style.display = 'none';

    const overlay = document.getElementById('pendingChangesOverlay');
    if (overlay && !overlay.hidden) {
      await waRenderPendingChanges();
    }
  }

  const overlay = document.getElementById('pendingChangesOverlay');
  if (overlay && !overlay.hidden) {
    await waRenderPendingChanges();
  }
}

async function waCheckBackendVersion() {
  if (!waCanTryServer()) return null;

  try {
    // "ping" has existed in the backend for a long time. Do not use a newly-added
    // action as the connectivity test, because an older deployment can be reachable
    // while legitimately not knowing that newer action.
    const res = await waJsonp('ping', {}, 12000, { affectsHealth: true });
    if (!res || !res.success) {
      throw new Error(res && res.error ? res.error : 'Ping failed');
    }

    waMarkServerReachable();
    waBackendVersion = res.data && res.data.backendVersion
      ? String(res.data.backendVersion)
      : 'legacy';

    try { await waDbPut('kv', waBackendVersion, 'backendVersion'); } catch (_) {}
    await waUpdateStatus();
    return waBackendVersion;
  } catch (err) {
    waMarkServerUnreachable(err);
    await waUpdateStatus();
    return null;
  }
}

async function apiGetToolItems(options = {}) {
  let cached;
  try { cached = await waDbGet('kv', 'tools'); } catch (_) { cached = undefined; }
  const hasCached = cached !== undefined && cached !== null;

  if (!waCanTryServer()) {
    if (!options.silentStatus) await waUpdateStatus(hasCached ? 'Using cached data' : 'No cached data available');
    if (hasCached) return cached;
    throw new Error('No cached tool list is available yet. Connect once to load it for offline use.');
  }

  try {
    const res = await waJsonp('tools', {}, 12000, { affectsHealth: !options.silentStatus });
    if (!res || !res.success) throw new Error(res && res.error ? res.error : 'Tool list request failed');
    try {
      await waDbPut('kv', res.data || [], 'tools');
      await waDbPut('kv', new Date().toISOString(), 'lastSync');
    } catch (err) {
      console.warn('Could not cache tool list:', err);
    }
    if (!options.silentStatus) await waUpdateStatus('Live data');
    return res.data || [];
  } catch (err) {
    if (!options.silentStatus) waMarkServerUnreachable(err);
    if (hasCached) {
      if (!options.silentStatus) await waUpdateStatus('Using cached data • live request failed');
      return cached;
    }
    if (!options.silentStatus) await waUpdateStatus('No cached data available');
    throw new Error('Offline and no cached tool list is available yet. Connect once to load it.');
  }
}

async function waRememberToolItem(itemName) {
  const item = String(itemName || '').trim();
  if (!item) return;

  let cached = [];
  try {
    const existing = await waDbGet('kv', 'tools');
    if (Array.isArray(existing)) cached = existing.slice();
  } catch (_) {}

  const key = item.toLowerCase();
  const exists = cached.some(existing => String(existing || '').trim().toLowerCase() === key);
  if (!exists) {
    cached.push(item);
    cached.sort((a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base' }));
    try { await waDbPut('kv', cached, 'tools'); } catch (err) {
      console.warn('Could not remember new tool item locally:', err);
    }
  }
}

async function apiGetInventory(tabKey, options = {}) {
  const cacheKey = 'inventory:' + tabKey;
  let cached;
  try { cached = await waDbGet('kv', cacheKey); } catch (_) { cached = undefined; }
  const hasCached = cached !== undefined && cached !== null;

  if (!waCanTryServer()) {
    if (!options.silentStatus) await waUpdateStatus(hasCached ? 'Using cached data' : 'No cached data available');
    if (hasCached) return cached;
    throw new Error('No cached inventory is available for this view yet. Connect once and open this view to save it for offline use.');
  }

  try {
    const res = await waJsonp('inventory', { tab: tabKey }, 12000, { affectsHealth: !options.silentStatus });
    if (!res || !res.success) throw new Error(res && res.error ? res.error : 'Inventory request failed');
    try {
      await waDbPut('kv', res.data || [], cacheKey);
      await waDbPut('kv', new Date().toISOString(), 'lastSync');
    } catch (err) {
      console.warn('Could not cache inventory:', err);
    }
    if (!options.silentStatus) await waUpdateStatus('Live data');
    return res.data || [];
  } catch (err) {
    if (!options.silentStatus) waMarkServerUnreachable(err);
    if (hasCached) {
      if (!options.silentStatus) await waUpdateStatus('Using cached data • live request failed');
      return cached;
    }
    if (!options.silentStatus) await waUpdateStatus('No cached data available');
    throw new Error('Offline and no cached inventory is available for this view yet. Connect once and open this view to cache it.');
  }
}

async function waSendQueuedEvent(event) {
  const payload = { ...event };
  delete payload._lastSyncError;
  delete payload._lastSyncAttempt;

  const res = await waJsonp('submit', { payload: JSON.stringify(payload) }, 30000);
  if (!res || !res.success) throw new Error(res && res.error ? res.error : 'Save failed');
  return res;
}



function waLocationInfo(location, areaHint = '') {
  const raw = String(location || '').trim();
  const lower = raw.toLowerCase();
  if (!raw) return null;

  if (lower === 'class stock') return { type: 'class', summaryField: 'repaired', classField: 'repairedBin' }; // legacy alias
  if (lower === 'broken bin') return { type: 'class', summaryField: 'broken', classField: 'brokenBin' };
  if (lower === 'repaired bin') return { type: 'class', summaryField: 'repaired', classField: 'repairedBin' };
  if (lower === 'missing') return { type: 'class', summaryField: 'missing', classField: 'missing' };
  if (lower === 'e-commerce stock') return { type: 'untracked' };
  if (lower === 'tool room' || lower === 'purchased' || lower === 'disposed') return { type: 'untracked' };

  if (lower.includes('2015 van')) return { type: 'van', tab: '2015', summaryField: 'van2015' };
  if (lower.includes('2021 van')) return { type: 'van', tab: '2021', summaryField: 'van2021' };
  if (lower.includes('2026')) {
    let area = String(areaHint || '').trim();
    if (!area) {
      if (lower.includes('floor')) area = 'Floor Level Bins';
      else if (lower.includes('2nd')) area = '2nd Level Bins';
      else if (lower.includes('other')) area = '__OTHER__';
    }
    return { type: 'van', tab: '2026', summaryField: 'van2026', area };
  }
  return { type: 'untracked' };
}

function waSameItem(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function waClampQty(value) {
  const n = Number(value) || 0;
  return Math.max(0, n);
}

async function waAdjustCachedLocation(itemName, location, delta, areaHint = '') {
  if (!delta) return;
  const info = waLocationInfo(location, areaHint);
  if (!info || info.type === 'untracked') return;

  // Tool Summary is the safest optimistic view because each location has one total.
  const summary = await waDbGet('kv', 'inventory:summary');
  if (Array.isArray(summary) && info.summaryField) {
    const row = summary.find(r => waSameItem(r.item, itemName));
    if (row) {
      row[info.summaryField] = waClampQty((Number(row[info.summaryField]) || 0) + delta);
      await waDbPut('kv', summary, 'inventory:summary');
    }
  }

  // Repaired Bin / Broken / Missing have one row per tool, so these are also unambiguous.
  if (info.type === 'class') {
    const classData = await waDbGet('kv', 'inventory:class');
    if (Array.isArray(classData)) {
      const row = classData.find(r => waSameItem(r.tool, itemName));
      const field = info.classField || 'classStock';
      if (row && Object.prototype.hasOwnProperty.call(row, field)) {
        row[field] = waClampQty((Number(row[field]) || 0) + delta);
        await waDbPut('kv', classData, 'inventory:class');
      }
    }
  }

  // Van sheets can contain the same tool in multiple bins. Only alter a van card when
  // there is exactly one unambiguous matching row for the selected location/area.
  if (info.type === 'van') {
    const key = 'inventory:' + info.tab;
    const vanData = await waDbGet('kv', key);
    if (!Array.isArray(vanData)) return;

    let matches = vanData.filter(r => waSameItem(r.item, itemName));
    // For 2026, a unique item name is already unambiguous. Only use the broad
    // Floor / 2nd Level / Other selector when that item exists in multiple 2026 rows.
    if (info.tab === '2026' && info.area && matches.length > 1) {
      if (info.area === '__OTHER__') {
        matches = matches.filter(r => {
          const where = (String(r.area || '') + ' ' + String(r.bin || '')).toLowerCase();
          return !where.includes('floor') && !where.includes('bottom') &&
            !where.includes('2nd') && !where.includes('second') && !where.includes('middle');
        });
      } else if (info.area === 'Floor Level Bins') {
        matches = matches.filter(r => {
          const where = (String(r.area || '') + ' ' + String(r.bin || '')).toLowerCase();
          return where.includes('floor') || where.includes('bottom');
        });
      } else if (info.area === '2nd Level Bins') {
        matches = matches.filter(r => {
          const where = (String(r.area || '') + ' ' + String(r.bin || '')).toLowerCase();
          return where.includes('2nd') || where.includes('second') || where.includes('middle');
        });
      }
    }

    if (matches.length === 1) {
      matches[0].quantity = waClampQty((Number(matches[0].quantity) || 0) + delta);
      await waDbPut('kv', vanData, key);
    }
  }
}

async function waApplyOptimisticInventoryChange(event) {
  const qty = Math.max(0, Number(event.quantity) || 0);
  if (!qty || !event.item) return;

  const action = String(event.action || '');

  if (action === 'Restocked from tool room') {
    await waAdjustCachedLocation(
      event.item,
      event.restockTargetLocation || event.whichVanRestocked,
      qty
    );
    return;
  }

  if (action === 'Needs replenishing / recharging' || action === 'Needs replenishing') {
    await waAdjustCachedLocation(event.item, event.statusLocation, -1);
    return;
  }

  if (action === 'Replenished') {
    await waAdjustCachedLocation(event.item, event.statusLocation, 1);
    return;
  }

  if (action === 'Broke, Needs replacement' || action === 'Missing, Needs replacement') {
    const isBroken = action.startsWith('Broke');
    await waAdjustCachedLocation(event.item, isBroken ? 'Broken Bin' : 'Missing', qty);

    let replaced = 0;
    if (event.didYouReplace === 'Yes, from repaired bin' ||
        event.didYouReplace === 'Yes, from class stock') {
      // "Class Stock" is retained only as a legacy alias for old queued events.
      replaced = qty;
      await waAdjustCachedLocation(event.item, 'Repaired Bin', -qty);
    } else if (event.didYouReplace === 'Yes, split locations/partially replaced') {
      // Old queued split events are collapsed into the single Repaired Bin reserve.
      const fromRepaired = Math.max(0, Number(event.qtyRepairedBin) || 0);
      const fromClass = Math.max(0, Number(event.qtyClassStock) || 0);
      const fromReserve = fromRepaired + fromClass;
      replaced = Math.min(qty, fromReserve);
      if (fromReserve) await waAdjustCachedLocation(event.item, 'Repaired Bin', -fromReserve);
    }

    // A replacement goes back into the location the broken/missing tool came from,
    // so only the unreplaced portion lowers that location's on-hand quantity.
    const netLoss = Math.max(0, qty - replaced);
    if (netLoss) await waAdjustCachedLocation(event.item, event.vanOrLocationBroke, -netLoss);
    return;
  }

  if (action === 'Repaired') {
    await waAdjustCachedLocation(event.item, 'Broken Bin', -qty);
    await waAdjustCachedLocation(event.item, event.repairedMovedTo, qty);
    return;
  }

  if (action === 'Moved/Transferred Stock') {
    await waAdjustCachedLocation(event.item, event.transferMovedFrom, -qty);
    await waAdjustCachedLocation(event.item, event.transferMovedTo, qty);
    return;
  }

  if (action === 'Other Event (Found, Disposed, Purchased, Sold)') {
    if (event.otherMovedFrom) await waAdjustCachedLocation(event.item, event.otherMovedFrom, -qty);
    if (event.otherMovedTo) await waAdjustCachedLocation(event.item, event.otherMovedTo, qty);
  }
}


async function waRefreshVisibleInventoryFromCache() {
  // Keep the page's in-memory inventory in sync with the IndexedDB snapshot.
  // Without this, an offline event can update the stored cache while the currently
  // rendered inventory still shows the old numbers until the tab is reloaded.
  if (typeof invCache !== 'object' || !invCache) return;

  for (const tab of ['2026', '2021', '2015', 'class', 'summary']) {
    try {
      const cached = await waDbGet('kv', 'inventory:' + tab);
      if (cached !== undefined && cached !== null) invCache[tab] = cached;
    } catch (_) {}
  }

  try {
    if (typeof renderBinTiles === 'function') renderBinTiles();
    if (typeof renderFilteredInventory === 'function') renderFilteredInventory();
  } catch (err) {
    console.warn('Could not refresh visible cached inventory:', err);
  }
}

async function apiSubmitLog(payload) {
  const event = {
    ...payload,
    eventId: payload.eventId || waMakeEventId(),
    clientTimestamp: payload.clientTimestamp || new Date().toISOString()
  };

  // Offline-first submission:
  // 1) persist the event locally,
  // 2) immediately project it into cached inventory,
  // 3) let syncing happen in the background.
  // This keeps the form responsive even when Apps Script is slow to cold-start.
  await waDbPut('queue', event);
  // Remember newly typed items immediately so they stay searchable even if the
  // event was created offline. The backend will add truly new items to MISC on sync.
  await waRememberToolItem(event.item);
  await waApplyOptimisticInventoryChange(event);
  await waRefreshVisibleInventoryFromCache();

  const canSyncNow = waCanTryServer();
  await waUpdateStatus(canSyncNow ? 'Saved • Syncing…' : 'Saved offline');

  if (canSyncNow) {
    // Do not await the network request. The event is already safely queued.
    setTimeout(() => { waSyncPending(); }, 0);
  }

  return {
    success: true,
    queued: true,
    syncing: canSyncNow,
    item: event.item
  };
}

async function waSyncPending() {
  if (waSyncInProgress || !waCanTryServer()) {
    await waUpdateStatus();
    return;
  }

  waSyncInProgress = true;
  let syncedAny = false;
  let failedAny = false;

  try {
    const events = waPendingEventsSorted_(await waDbGetAll('queue'));
    if (!events.length) {
      await waUpdateStatus();
      return;
    }

    await waUpdateStatus('Syncing…');

    // Try every queued event. A single bad/legacy event should not block valid
    // changes behind it in the queue.
    for (const event of events) {
      try {
        await waSendQueuedEvent(event);
        await waDbDelete('queue', event.eventId);
        syncedAny = true;
      } catch (err) {
        failedAny = true;
        event._lastSyncError = err && err.message ? err.message : String(err);
        event._lastSyncAttempt = new Date().toISOString();
        try { await waDbPut('queue', event); } catch (_) {}
        console.warn('Queued event failed to sync:', event.item, err);
      }

      // Update the count after every attempt so the status and Pending screen
      // show which entries remain.
      await waUpdateStatus(failedAny ? 'Waiting to sync' : 'Syncing…');
    }

    if (syncedAny) {
      await waDbPut('kv', new Date().toISOString(), 'lastSync');
    }

    await waUpdateStatus(failedAny ? 'Waiting to sync' : undefined);

    if (syncedAny) {
      // Replace optimistic local quantities with authoritative Sheet values.
      setTimeout(() => { waWarmInventoryCache(); }, 900);
    }
  } finally {
    waSyncInProgress = false;

    // Do not spin endlessly retrying known failures. New events or an explicit
    // Retry/Retry all action can start another pass.
    if (!failedAny && waCanTryServer()) {
      try {
        const remaining = await waPendingCount();
        if (remaining) setTimeout(() => { waSyncPending(); }, 250);
      } catch (_) {}
    }
  }
}


async function waWarmInventoryCache() {
  if (!waCanTryServer()) return;
  const tabs = ['2026', '2021', '2015', 'class', 'summary'];

  // Warm one view at a time. This avoids a burst of simultaneous Apps Script
  // requests competing with a queued event that is trying to sync.
  for (const tab of tabs) {
    try { await apiGetInventory(tab, { silentStatus: true }); } catch (_) {}
  }

  // Pull the refreshed authoritative snapshots back into the running page too.
  await waRefreshVisibleInventoryFromCache();
}

async function waInitPwa() {
  // PWA/offline setup is deliberately non-critical. A problem with IndexedDB
  // or a service-worker update must not block live inventory from loading.
  try { await waOpenDb(); } catch (err) { console.warn('IndexedDB unavailable', err); }
  try { await waUpdateStatus(); } catch (err) { console.warn('Status init failed', err); }

  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' });

      // Do not wait for an update check before allowing the app to load.
      if (navigator.onLine !== false) {
        registration.update().catch(() => {});
      }

      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    } catch (err) {
      console.warn('Service worker registration failed', err);
    }
  }

  if (waCanTryServer()) {
    setTimeout(async () => {
      await waCheckBackendVersion();
      let pending = 0;
      try { pending = await waPendingCount(); } catch (_) {}

      if (pending) {
        // Queued tool events are more important than background inventory warming.
        await waSyncPending();
      }
      // Do not immediately warm every inventory tab here. The page startup already
      // loads the data it needs, and additional background requests can create
      // misleading connection-state races on mobile browsers.

    }, 0);
  }
}

navigator.serviceWorker?.addEventListener('controllerchange', () => {
  // Reload once when a newly installed worker takes control so the user sees
  // the new HTML/CSS/JS immediately. sessionStorage prevents a reload loop.
  if (!sessionStorage.getItem('wa-sw-controller-reloaded')) {
    sessionStorage.setItem('wa-sw-controller-reloaded', '1');
    window.location.reload();
  }
});

window.addEventListener('online', () => { waMarkServerReachable(); waSyncPending(); });
window.addEventListener('offline', () => { waMarkServerUnreachable(); waUpdateStatus(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && waCanTryServer()) {
    waCheckBackendVersion().catch(() => {});
    waSyncPending();
  }
});

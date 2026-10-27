/* =========================================================
   sync.js — مزامنة بين الأجهزة عبر Supabase
   البرنامج بيشتغل أوفلاين بالكامل، والمزامنة بتحصل في الخلفية لما يبقى في نت.
   - كل سجل ليه syncId ثابت بين الأجهزة، لكن الأرقام المحلية (id) بتختلف من جهاز لجهاز،
     عشان كده أي ربط بين سجلين (patientId, visitId...) بيتحوّل لـ syncId قبل الإرسال ويرجع لرقم محلي عند الاستلام.
   - القوائم الافتراضية (خدمات، تصنيفات، طرق دفع...) بياخدوا syncId ثابت من اسمهم، عشان ماتتكررش بعد المزامنة.
   ========================================================= */

let supaClient = null;
let syncRunning = false;
let syncPending = null;
let syncTimer = null;
let realtimeChannels = [];
let lastAutoSyncAt = 0;
let onlineListenerAdded = false;
let needsRefresh = false;
let realtimePullTimer = null;
const MIN_AUTO_SYNC_GAP_MS = 4000;
const SYNC_LISTENERS = [];

const SYNC_ORDER = [
  'users',
  'serviceCategories','services','expenseCategories','visitTypes','paymentMethods',
  'appointmentStatuses','patientSources','drugs','prescriptionTemplates','doctors',
  'patients','appointments','visits','visitServices','payments','expenses',
  'prescriptions','prescriptionItems','treatmentPlans',
];
const LIST_STORES = ['serviceCategories','services','expenseCategories','visitTypes','paymentMethods','appointmentStatuses','patientSources','drugs','prescriptionTemplates','doctors'];
const FK_MAP = {
  appointments: { patientId: 'patients' },
  visits: { patientId: 'patients', appointmentId: 'appointments' },
  visitServices: { visitId: 'visits', serviceId: 'services' },
  services: { categoryId: 'serviceCategories' },
  payments: { patientId: 'patients', visitId: 'visits' },
  expenses: { categoryId: 'expenseCategories' },
  prescriptions: { patientId: 'patients', visitId: 'visits' },
  prescriptionItems: { prescriptionId: 'prescriptions', drugId: 'drugs' },
  treatmentPlans: { patientId: 'patients', convertedVisitId: 'visits' },
};
const SKIP = { skipMeta: true, skipNotify: true };

const SYNC_SETUP_SQL = `do $$
declare
  t text;
  tables text[] := array[
    'patients','appointments','visits','visitServices','services','serviceCategories',
    'payments','expenses','expenseCategories','visitTypes','paymentMethods',
    'appointmentStatuses','patientSources','drugs','prescriptions','prescriptionItems',
    'prescriptionTemplates','treatmentPlans','doctors','users'
  ];
begin
  foreach t in array tables loop
    execute format('create table if not exists public.%I (
      sync_id uuid primary key,
      data jsonb not null,
      updated_at timestamptz not null default now(),
      deleted boolean not null default false
    )', t);
    execute format('create index if not exists %I on public.%I (updated_at)', t || '_updated_idx', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "clinic_all" on public.%I', t);
    execute format('create policy "clinic_all" on public.%I for all to anon using (true) with check (true)', t);
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when others then null;
    end;
  end loop;
end $$;`;

const isMissingTable = (m) => /does not exist|could not find the table|schema cache/i.test(m || '');

function onSyncStatusChange(fn) { SYNC_LISTENERS.push(fn); }
function notifySyncStatus(status) { SYNC_LISTENERS.forEach(fn => { try { fn(status); } catch (e) {} }); }

let localChangeDebounce = null;
function onLocalChange() {
  if (localChangeDebounce) clearTimeout(localChangeDebounce);
  localChangeDebounce = setTimeout(() => {
    const now = Date.now();
    if (now - lastAutoSyncAt < MIN_AUTO_SYNC_GAP_MS) return;
    lastAutoSyncAt = now;
    runSyncPass('push');
  }, 1500);
}

async function getSyncConfig() {
  const row = await DB.get('settings', 'syncConfig');
  return row ? row.value : { url: '', anonKey: '', enabled: false, lastPullAt: null };
}
async function saveSyncConfig(patch) {
  const cur = await getSyncConfig();
  const merged = { ...cur, ...patch };
  await DB.put('settings', { key: 'syncConfig', value: merged });
  return merged;
}

function normalizeSupabaseUrl(raw) {
  let u = String(raw || '').trim().replace(/\s+/g, '');
  u = u.replace(/^\/+/, '');
  u = u.replace(/\/rest\/v1.*$/i, '').replace(/\/+$/, '');
  if (/^[a-z0-9]{15,30}$/i.test(u)) u = `https://${u}.supabase.co`;
  if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}

function hashUuid(str) {
  const parts = [];
  for (let seed = 0; seed < 4; seed++) {
    let h = (0x811c9dc5 ^ Math.imul(seed + 1, 0x9e3779b1)) >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; h ^= h >>> 15;
    parts.push((h >>> 0).toString(16).padStart(8, '0'));
  }
  const hex = parts.join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
function listItemName(store, r) { return store === 'drugs' ? r.tradeName : r.name; }

function initSupabaseClient(url, anonKey) {
  if (!url || !anonKey || typeof supabase === 'undefined') { supaClient = null; return null; }
  try { supaClient = supabase.createClient(normalizeSupabaseUrl(url), anonKey); } catch (e) { supaClient = null; }
  return supaClient;
}

async function backfillSyncMeta() {
  const used = new Set();
  for (const store of SYNC_ORDER) {
    const all = await DB.all(store);
    for (const r of all) {
      let want = r.syncId;
      if (LIST_STORES.includes(store)) {
        const nm = listItemName(store, r);
        if (nm) {
          const det = hashUuid(store + '|' + String(nm).trim().toLowerCase());
          if (!used.has(det)) want = det;
        }
      }
      if (!want) want = uuid();
      if (used.has(want)) want = uuid();
      used.add(want);
      if (want !== r.syncId) {
        await DB.put(store, { ...r, syncId: want, updatedAt: r.updatedAt || new Date().toISOString(), _dirty: true }, SKIP);
      }
    }
  }
}

async function toRemote(store, rec) {
  const { _dirty, id, ...data } = rec;
  const fks = FK_MAP[store];
  if (fks) {
    data._fk = {};
    for (const [field, refStore] of Object.entries(fks)) {
      const v = rec[field];
      delete data[field];
      if (v === null || v === undefined || v === '') continue;
      const ref = await DB.get(refStore, v);
      data._fk[field] = ref ? ref.syncId : null;
    }
  }
  data._v = 2;
  return data;
}

async function pushChanges() {
  if (!supaClient) return { pushed: 0 };
  let pushed = 0;
  const errors = [];
  for (const store of SYNC_ORDER) {
    const all = await DB.all(store);
    const dirty = all.filter(r => r._dirty && r.syncId);
    for (let i = 0; i < dirty.length; i += 400) {
      const chunk = dirty.slice(i, i + 400);
      const rows = [];
      for (const r of chunk) rows.push({ sync_id: r.syncId, data: await toRemote(store, r), updated_at: r.updatedAt, deleted: false });
      const { error } = await supaClient.from(store).upsert(rows, { onConflict: 'sync_id' });
      if (error) { if (store === 'users' && isMissingTable(error.message)) continue; errors.push(`${store}: ${error.message}`); continue; }
      for (const r of chunk) {
        const fresh = await DB.get(store, r.id);
        if (fresh && fresh.updatedAt === r.updatedAt) await DB.put(store, { ...fresh, _dirty: false }, SKIP);
      }
      pushed += chunk.length;
    }
  }
  const tombstones = await DB.all('tombstones');
  for (const t of tombstones) {
    const { error } = await supaClient.from(t.store).update({ deleted: true, data: { _v: 2 }, updated_at: new Date().toISOString() }).eq('sync_id', t.syncId);
    if (!error) await DB.delete('tombstones', t.id, { skipTombstone: true, skipNotify: true });
    else if (t.store === 'users' && isMissingTable(error.message)) continue;
    else errors.push(`${t.store} (حذف): ${error.message}`);
  }
  if (errors.length) throw new Error('فشل الإرسال: ' + errors[0] + (errors.length > 1 ? ` (و${errors.length - 1} خطأ تاني)` : ''));
  return { pushed };
}

async function bumpPatientCounter(fileNumber) {
  const n = parseInt(String(fileNumber).replace(/\D/g, ''), 10);
  if (!n) return;
  const c = (await DB.get('settings', 'counters')) || { key: 'counters', value: {} };
  if ((c.value.patient || 0) < n) { c.value.patient = n; await DB.put('settings', c); }
}

async function applyRemoteRow(store, row) {
  if (!row.data || row.data._v !== 2) return 0;
  const matches = await DB.byIndex(store, 'syncId', row.sync_id);
  const local = matches && matches[0];
  if (row.deleted) {
    if (local) { await DB.delete(store, local.id, { skipTombstone: true, skipNotify: true }); return 1; }
    return 0;
  }
  const { _fk, _v, ...rest } = row.data;
  const data = { ...rest };
  if (_fk) {
    for (const [field, refSync] of Object.entries(_fk)) {
      if (!refSync) { data[field] = null; continue; }
      const m = await DB.byIndex(FK_MAP[store][field], 'syncId', refSync);
      data[field] = (m && m[0]) ? m[0].id : null;
    }
  }
  const incoming = { ...data, syncId: row.sync_id, updatedAt: row.updated_at, _dirty: false };
  if (local) {
    if (!local.updatedAt || row.updated_at > local.updatedAt) {
      await DB.put(store, { ...incoming, id: local.id }, SKIP);
      return 1;
    }
    return 0;
  }
  try {
    await DB.add(store, incoming, SKIP);
  } catch (e) {
    if (store === 'patients') {
      incoming.fileNumber = await nextFileNumber();
      incoming._dirty = true;
      await DB.add(store, incoming, SKIP);
    } else { throw e; }
  }
  if (store === 'patients') await bumpPatientCounter(incoming.fileNumber);
  return 1;
}

async function pullChanges() {
  if (!supaClient) return { pulled: 0 };
  const cfg = await getSyncConfig();
  const since = cfg.lastPullAt || '1970-01-01T00:00:00.000Z';
  const sinceQuery = cfg.lastPullAt ? new Date(Date.parse(since) - 10000).toISOString() : since;
  let maxUpdatedAt = since;
  let changed = 0;
  const errors = [];
  for (const store of SYNC_ORDER) {
    let offset = 0;
    while (true) {
      const { data: rows, error } = await supaClient.from(store).select('*').gt('updated_at', sinceQuery)
        .order('updated_at', { ascending: true }).range(offset, offset + 999);
      if (error) { if (!(store === 'users' && isMissingTable(error.message))) errors.push(`${store}: ${error.message}`); break; }
      if (!rows || !rows.length) break;
      for (const row of rows) {
        try { changed += await applyRemoteRow(store, row); }
        catch (e) { errors.push(`${store}: ${e.message}`); }
        if (row.updated_at > maxUpdatedAt) maxUpdatedAt = row.updated_at;
      }
      if (rows.length < 1000) break;
      offset += 1000;
    }
  }
  if (errors.length) throw new Error('فشل الاستلام: ' + errors[0] + (errors.length > 1 ? ` (و${errors.length - 1} خطأ تاني)` : ''));
  await saveSyncConfig({ lastPullAt: maxUpdatedAt });
  return { pulled: changed };
}

function modalIsOpen() { return !!document.querySelector('.modal-overlay'); }
function refreshViewIfSafe() {
  if (modalIsOpen()) { needsRefresh = true; return; }
  needsRefresh = false;
  if (typeof route === 'function') route();
}

async function runSyncPass(mode = 'both') {
  if (needsRefresh && !modalIsOpen()) refreshViewIfSafe();
  if (syncRunning) { syncPending = 'both'; return { ok: false, error: 'جاري تنفيذ مزامنة تانية بالفعل' }; }
  if (!navigator.onLine) return { ok: false, error: 'لا يوجد اتصال بالإنترنت حاليًا' };
  const cfg = await getSyncConfig();
  if (!cfg.enabled || !cfg.url || !cfg.anonKey) return { ok: false, error: 'المزامنة غير مفعّلة' };
  if (!supaClient) initSupabaseClient(cfg.url, cfg.anonKey);
  if (!supaClient) return { ok: false, error: 'تعذّر إنشاء الاتصال — راجع الرابط والمفتاح' };
  syncRunning = true;
  notifySyncStatus('syncing');
  let result = { ok: true, pulled: 0 };
  try {
    await backfillSyncMeta();
    if (mode === 'push' || mode === 'both') await pushChanges();
    if (mode === 'pull' || mode === 'both') result.pulled = (await pullChanges()).pulled;
    await saveSyncConfig({ lastSyncAt: new Date().toISOString(), lastError: null });
    notifySyncStatus('idle');
    if (result.pulled > 0) { if (typeof onSyncPulled === 'function') onSyncPulled(); refreshViewIfSafe(); }
  } catch (e) {
    console.error('sync error', e);
    const msg = (e && e.message) ? e.message : String(e);
    await saveSyncConfig({ lastError: msg });
    notifySyncStatus('error');
    result = { ok: false, error: msg };
  } finally {
    syncRunning = false;
    if (syncPending) { const m = syncPending; syncPending = null; runSyncPass(m); }
  }
  return result;
}

function startRealtime() {
  realtimeChannels.forEach(ch => { try { supaClient.removeChannel(ch); } catch (e) {} });
  realtimeChannels = [];
  if (!supaClient) return;
  SYNC_ORDER.forEach(store => {
    try {
      const ch = supaClient.channel(`realtime:${store}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: store }, () => {
          if (realtimePullTimer) clearTimeout(realtimePullTimer);
          realtimePullTimer = setTimeout(() => runSyncPass('pull'), 800);
        })
        .subscribe();
      realtimeChannels.push(ch);
    } catch (e) { }
  });
}

async function initSyncEngine() {
  const cfg = await getSyncConfig();
  if (!cfg.enabled || !cfg.url || !cfg.anonKey) return;
  initSupabaseClient(cfg.url, cfg.anonKey);
  if (!supaClient) return;
  startRealtime();
  runSyncPass('both');
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = setInterval(() => runSyncPass('both'), 25000);
  if (!onlineListenerAdded) { window.addEventListener('online', () => runSyncPass('both')); onlineListenerAdded = true; }
}

async function disconnectSync() {
  await saveSyncConfig({ enabled: false });
  realtimeChannels.forEach(ch => { try { supaClient.removeChannel(ch); } catch (e) {} });
  realtimeChannels = [];
  if (syncTimer) clearInterval(syncTimer);
  supaClient = null;
}

async function fullResync() {
  for (const store of SYNC_ORDER) {
    const all = await DB.all(store);
    for (const r of all) await DB.put(store, { ...r, _dirty: true }, SKIP);
  }
  await saveSyncConfig({ lastPullAt: null });
  return runSyncPass('both');
}

async function diagnoseSync(urlRaw, keyRaw) {
  const url = normalizeSupabaseUrl(urlRaw);
  const key = String(keyRaw || '').trim();
  if (!navigator.onLine) return { ok: false, message: 'مفيش اتصال بالإنترنت على الجهاز ده دلوقتي.' };
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) return { ok: false, message: `الرابط شكله مش صح: ${url || '(فاضي)'}\nالشكل الصح: https://xxxxxxxx.supabase.co` };
  if (key.length < 20) return { ok: false, message: 'المفتاح (anon key) فاضي أو ناقص.' };
  if (typeof supabase === 'undefined') return { ok: false, message: 'مكتبة Supabase ماتحمّلتش — أعد تشغيل البرنامج.' };
  const client = supabase.createClient(url, key);
  const missing = [];
  let otherErr = null;
  for (const store of SYNC_ORDER) {
    const { error } = await client.from(store).select('sync_id').limit(1);
    if (error) {
      if (/does not exist|could not find the table|schema cache/i.test(error.message)) missing.push(store);
      else otherErr = otherErr || error.message;
    }
  }
  const missingCore = missing.filter(s => s !== 'users');
  if (missingCore.length) return { ok: false, needsSql: true, message: `الجداول مش موجودة في Supabase (${missingCore.length} من ${SYNC_ORDER.length}). انسخ كود الإعداد (SQL) من تحت وشغّله مرة واحدة في Supabase ← SQL Editor ← Run.` };
  if (otherErr) {
    if (/invalid api key|jwt|apikey/i.test(otherErr)) return { ok: false, message: 'المفتاح (anon key) مش مقبول من Supabase — انسخه تاني من Settings ← API.' };
    if (/failed to fetch|networkerror|load failed/i.test(otherErr)) return { ok: false, message: 'مقدرتش أوصل لـ Supabase — راجع الرابط والإنترنت.' };
    return { ok: false, message: 'خطأ من Supabase: ' + otherErr };
  }
  if (missing.length) return { ok: true, message: 'الاتصال سليم ✅\nملحوظة: جدول الموظفين لسه ناقص في Supabase. شغّل كود SQL (اللي تحت) تاني مرة لو عايز الموظفين والصلاحيات يتزامنوا بين الأجهزة.' };
  return { ok: true, message: 'الاتصال سليم وكل الجداول موجودة ✅' };
}

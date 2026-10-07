/* =========================================================
   sync.js — مزامنة تلقائية مع قاعدة بيانات سحابية (Supabase)
   البرنامج يفضل شغال بالكامل من غير إنترنت. المزامنة بتحصل تلقائيًا
   في الخلفية بس لما يبقى في اتصال، من غير ما توقف أو تبطّئ أي حاجة
   في الاستخدام العادي.
   ========================================================= */

let supaClient = null;
let syncRunning = false;
let syncPending = null;
let syncTimer = null;
let realtimeChannels = [];
let lastAutoSyncAt = 0;
const MIN_AUTO_SYNC_GAP_MS = 4000; // حد أدنى بين كل محاولة مزامنة تلقائية والتانية، يمنع أي تكرار سريع غير متوقع
const SYNC_LISTENERS = [];

function onSyncStatusChange(fn) { SYNC_LISTENERS.push(fn); }
function notifySyncStatus(status) { SYNC_LISTENERS.forEach(fn => { try { fn(status); } catch (e) {} }); }

/* دالة بيستدعيها db.js تلقائيًا بعد أي تعديل محلي، عشان نجدول مزامنة قريبة */
let localChangeDebounce = null;
function onLocalChange() {
  if (localChangeDebounce) clearTimeout(localChangeDebounce);
  localChangeDebounce = setTimeout(() => {
    const now = Date.now();
    if (now - lastAutoSyncAt < MIN_AUTO_SYNC_GAP_MS) return; // حماية إضافية من أي تكرار سريع غير متوقع
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

function initSupabaseClient(url, anonKey) {
  if (!url || !anonKey || typeof supabase === 'undefined') { supaClient = null; return null; }
  try {
    supaClient = supabase.createClient(url, anonKey, { realtime: { params: { eventsPerSecond: 5 } } });
  } catch (e) { supaClient = null; }
  return supaClient;
}

function stripInternal(obj) {
  const { _dirty, ...rest } = obj;
  return rest;
}

/* ---------- الدفع: إرسال أي تغييرات محلية جديدة للسحابة ---------- */
async function pushChanges() {
  if (!supaClient) return { pushed: 0 };
  let pushed = 0;
  const errors = [];
  for (const store of SYNCED_STORES) {
    const all = await DB.all(store);
    const dirty = all.filter(r => r._dirty);
    if (!dirty.length) continue;
    const rows = dirty.map(r => ({ sync_id: r.syncId, data: stripInternal(r), updated_at: r.updatedAt, deleted: false }));
    const { error } = await supaClient.from(store).upsert(rows, { onConflict: 'sync_id' });
    if (error) { console.error('push error', store, error.message); errors.push(`${store}: ${error.message}`); continue; }
    for (const r of dirty) {
      const fresh = await DB.get(store, r.id);
      if (fresh) await DB.put(store, { ...fresh, _dirty: false }, { skipMeta: true, skipNotify: true });
    }
    pushed += dirty.length;
  }
  // إرسال الحذف (Tombstones)
  const tombstones = await DB.all('tombstones');
  for (const t of tombstones) {
    const { error } = await supaClient.from(t.store).update({ deleted: true, updated_at: new Date().toISOString() }).eq('sync_id', t.syncId);
    if (!error) await DB.delete('tombstones', t.id);
    else errors.push(`${t.store} (حذف): ${error.message}`);
  }
  if (errors.length) throw new Error('فشل الدفع: ' + errors[0] + (errors.length > 1 ? ` (و${errors.length - 1} خطأ تاني)` : ''));
  return { pushed };
}

/* ---------- الجذب: تحميل أي تغييرات جت من الجهاز التاني ---------- */
async function pullChanges() {
  if (!supaClient) return { pulled: 0 };
  const cfg = await getSyncConfig();
  const since = cfg.lastPullAt || '1970-01-01T00:00:00.000Z';
  let pulled = 0;
  let maxUpdatedAt = since;
  const errors = [];

  for (const store of SYNCED_STORES) {
    const { data: rows, error } = await supaClient.from(store).select('*').gt('updated_at', since);
    if (error) { console.error('pull error', store, error.message); errors.push(`${store}: ${error.message}`); continue; }
    for (const row of rows) {
      if (row.updated_at > maxUpdatedAt) maxUpdatedAt = row.updated_at;
      const localMatches = await DB.byIndex(store, 'syncId', row.sync_id);
      const local = localMatches && localMatches[0];
      if (row.deleted) {
        if (local) await DB.delete(store, local.id);
        continue;
      }
      const incoming = { ...row.data, syncId: row.sync_id, updatedAt: row.updated_at, _dirty: false };
      if (local) {
        // آخر تعديل هو المعتمد: لو نسخة السحابة أحدث من المحلية، حدّثها؛ لو المحلية أحدث (لسه معملتلهاش push)، سيبها
        if (!local.updatedAt || row.updated_at >= local.updatedAt) {
          await DB.put(store, { ...incoming, id: local.id }, { skipMeta: true, skipNotify: true });
          pulled++;
        }
      } else {
        try {
          await DB.add(store, incoming, { skipMeta: true, skipNotify: true });
        } catch (e) {
          // تعارض رقم ملف: جهازين سجّلوا مريضين بنفس الرقم وهم أوفلاين. نعيد ترقيم الجاي من السحابة ونعمله push.
          if (store === 'patients') {
            incoming.fileNumber = await nextFileNumber();
            incoming._dirty = true;
            await DB.add(store, incoming, { skipMeta: true, skipNotify: true });
          } else { console.error('pull add error', store, e); continue; }
        }
        if (store === 'patients') await bumpPatientCounter(incoming.fileNumber);
        pulled++;
      }
    }
  }
  await saveSyncConfig({ lastPullAt: maxUpdatedAt });
  if (errors.length) throw new Error('فشل الجذب: ' + errors[0] + (errors.length > 1 ? ` (و${errors.length - 1} خطأ تاني)` : ''));
  return { pulled };
}

async function bumpPatientCounter(fileNumber) {
  const n = parseInt(String(fileNumber).replace(/\D/g, ''), 10);
  if (!n) return;
  const c = (await DB.get('settings', 'counters')) || { key: 'counters', value: {} };
  if ((c.value.patient || 0) < n) { c.value.patient = n; await DB.put('settings', c); }
}

async function runSyncPass(mode = 'both') {
  if (syncRunning) { syncPending = 'both'; return { ok: false, error: 'جاري تنفيذ مزامنة تانية بالفعل' }; }
  if (!navigator.onLine) return { ok: false, error: 'لا يوجد اتصال بالإنترنت حاليًا' };
  const cfg = await getSyncConfig();
  if (!cfg.enabled || !cfg.url || !cfg.anonKey) return { ok: false, error: 'المزامنة غير مفعّلة' };
  if (!supaClient) initSupabaseClient(cfg.url, cfg.anonKey);
  if (!supaClient) return { ok: false, error: 'تعذّر إنشاء الاتصال — راجع الرابط والمفتاح' };
  syncRunning = true;
  notifySyncStatus('syncing');
  let result = { ok: true };
  try {
    if (mode === 'push' || mode === 'both') await pushChanges();
    if (mode === 'pull' || mode === 'both') await pullChanges();
    await saveSyncConfig({ lastSyncAt: new Date().toISOString(), lastError: null });
    notifySyncStatus('idle');
    if (typeof route === 'function') route(); // حدّث الشاشة الحالية عشان تعرض أي بيانات جديدة فورًا
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
  SYNCED_STORES.forEach(store => {
    const ch = supaClient.channel(`realtime:${store}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: store }, () => {
        runSyncPass('pull');
      })
      .subscribe();
    realtimeChannels.push(ch);
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
  syncTimer = setInterval(() => runSyncPass('both'), 25000); // نبضة احتياطية كل 25 ثانية حتى لو الـ Realtime فاتته لحظة
  window.addEventListener('online', () => runSyncPass('both'));
}

async function connectSyncNow(url, anonKey) {
  await saveSyncConfig({ url, anonKey, enabled: true });
  await initSyncEngine();
}
async function disconnectSync() {
  await saveSyncConfig({ enabled: false });
  realtimeChannels.forEach(ch => { try { supaClient.removeChannel(ch); } catch (e) {} });
  realtimeChannels = [];
  if (syncTimer) clearInterval(syncTimer);
  supaClient = null;
}

/* =========================================================
   auth.js — الموظفين والصلاحيات (دخول برقم سري)
   ملحوظة: ده تحكّم في الواجهة للاستخدام اليومي في العيادة،
   مش حماية ضد شخص خبير بيحاول يخترق الجهاز.
   ========================================================= */

const PERMISSIONS = [
  { key: 'dashboard', label: 'لوحة التحكم (الإيرادات والأرباح)' },
  { key: 'patients', label: 'المرضى' },
  { key: 'appointments', label: 'المواعيد' },
  { key: 'visits', label: 'الزيارات والعلاجات' },
  { key: 'prescriptions', label: 'الروشتات' },
  { key: 'treatmentplans', label: 'خطط العلاج' },
  { key: 'payments', label: 'المدفوعات' },
  { key: 'expenses', label: 'المصروفات' },
  { key: 'reports', label: 'التقارير' },
  { key: 'settings', label: 'الإعدادات' },
  { key: 'backup', label: 'النسخ الاحتياطي والاستيراد' },
  { key: 'export', label: 'تصدير Excel' },
  { key: 'delete', label: 'الحذف' },
];
const PERM_LABEL = Object.fromEntries(PERMISSIONS.map(p => [p.key, p.label]));
const PERM_PRESETS = {
  'استقبال': ['patients', 'appointments', 'visits', 'payments'],
  'محاسب': ['payments', 'expenses', 'reports', 'export'],
  'طبيب': ['dashboard', 'patients', 'appointments', 'visits', 'prescriptions', 'treatmentplans'],
};
const IDLE_LOCK_MS = 10 * 60 * 1000;
const AUTH = { users: [], user: null, required: false, fails: 0, lockUntil: 0, idleTimer: null };

/* ---------- الصلاحيات ---------- */
function canDo(perm) {
  if (!AUTH.required) return true;
  const u = AUTH.user;
  if (!u) return false;
  if (u.isAdmin) return true;
  return !!(u.perms && u.perms[perm]);
}
function isAdminUser() { return !AUTH.required || !!(AUTH.user && AUTH.user.isAdmin); }
function requirePerm(perm) {
  if (!canDo(perm)) {
    const e = new Error('ليس لديك صلاحية: ' + (PERM_LABEL[perm] || perm));
    e.isPermission = true;
    throw e;
  }
}
window.addEventListener('unhandledrejection', (ev) => {
  if (ev.reason && ev.reason.isPermission) { ev.preventDefault(); U.toast(ev.reason.message, 'error'); }
});

async function loadAuthUsers() {
  const all = await DB.all('users');
  AUTH.users = all.filter(u => u.active !== false);
  AUTH.required = AUTH.users.length > 0;
  if (AUTH.user) AUTH.user = AUTH.users.find(u => u.syncId === AUTH.user.syncId) || null;
}

/* ---------- تشفير الرقم السري ---------- */
function randomHex(n) {
  const a = new Uint8Array(n); crypto.getRandomValues(a);
  return Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function hashSecret(secret, salt) {
  if (window.crypto && crypto.subtle) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
    return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  let h = salt + '|' + secret;
  for (let i = 0; i < 3000; i++) h = hashUuid(h + salt);
  return h;
}
async function createUserRecord({ name, pin, isAdmin, perms }) {
  const salt = randomHex(8);
  const id = await DB.add('users', {
    name: String(name).trim(), salt, pinHash: await hashSecret(pin, salt),
    isAdmin: !!isAdmin, perms: perms || {}, active: true, createdAt: new Date().toISOString(),
  });
  return DB.get('users', id);
}
async function verifyPin(user, pin) { return (await hashSecret(pin, user.salt)) === user.pinHash; }

/* ---------- كود الطوارئ ---------- */
const normalizeCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function makeRecoveryCode() {
  const al = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const a = new Uint8Array(10); crypto.getRandomValues(a);
  const s = Array.from(a).map(b => al[b % al.length]).join('');
  return s.slice(0, 5) + '-' + s.slice(5);
}
async function saveRecoveryCode(code) {
  const salt = randomHex(8);
  await DB.put('settings', { key: 'authRecovery', value: { salt, hash: await hashSecret(normalizeCode(code), salt) } });
}
async function checkRecoveryCode(code) {
  const row = await DB.get('settings', 'authRecovery');
  if (!row) return null;
  return (await hashSecret(normalizeCode(code), row.value.salt)) === row.value.hash;
}

/* ---------- شاشة الدخول ---------- */
function loginVisible() { const el = document.getElementById('login-screen'); return !!el && el.style.display !== 'none'; }

function showLoginScreen() {
  return new Promise((resolve) => {
    const el = document.getElementById('login-screen');
    el.style.display = 'flex';
    let selected = AUTH.users.length === 1 ? AUTH.users[0] : null;
    let pin = '';
    let mode = 'pin';
    const clinic = (typeof APP_STATE !== 'undefined' && APP_STATE.clinicInfo && APP_STATE.clinicInfo.name) || '';
    const msg = (t) => { const m = el.querySelector('#login-msg'); if (m) m.textContent = t || ''; };

    function finish(user) {
      AUTH.user = user; AUTH.fails = 0;
      el.style.display = 'none'; el.innerHTML = '';
      document.removeEventListener('keydown', onKey);
      resolve();
    }
    async function submitPin() {
      if (Date.now() < AUTH.lockUntil) { pin = ''; paint(); msg('استنى ' + Math.ceil((AUTH.lockUntil - Date.now()) / 1000) + ' ثانية وجرّب تاني'); return; }
      if (await verifyPin(selected, pin)) return finish(selected);
      AUTH.fails++; pin = '';
      if (AUTH.fails >= 5) { AUTH.lockUntil = Date.now() + 30000; AUTH.fails = 0; paint(); msg('محاولات غلط كتير — استنى 30 ثانية'); return; }
      paint(); msg('الرقم السري غلط');
    }
    function pushDigit(d) { if (pin.length >= 4) return; pin += d; paint(); if (pin.length === 4) submitPin(); }
    function onKey(e) {
      if (mode !== 'pin' || !selected) return;
      if (/^\d$/.test(e.key)) pushDigit(e.key);
      else if (e.key === 'Backspace') { pin = pin.slice(0, -1); paint(); }
    }
    function paint() {
      const head = `<img src="assets/icon-navy-128.png" class="login-logo" alt=""><h2>${U.esc(clinic)}</h2>`;
      if (mode === 'recovery') {
        el.innerHTML = `<div class="login-box">${head}
          <p>اكتب كود الطوارئ واختار المدير وحط رقم سري جديد</p>
          <div class="form-grid" style="grid-template-columns:1fr">
            <label>كود الطوارئ<input id="rc-code" class="input" dir="ltr" autocomplete="off"></label>
            <label>المدير<select id="rc-admin" class="input">${AUTH.users.filter(u => u.isAdmin).map(u => `<option value="${u.syncId}">${U.esc(u.name)}</option>`).join('')}</select></label>
            <label>الرقم السري الجديد (4 أرقام)<input id="rc-pin" class="input" type="password" inputmode="numeric" maxlength="4" autocomplete="off"></label>
          </div>
          <div class="login-msg" id="login-msg"></div>
          <button class="btn btn-primary" id="rc-go" style="width:100%;margin-top:8px">تغيير الرقم السري ودخول</button>
          <a class="login-link" id="rc-back">رجوع</a></div>`;
        el.querySelector('#rc-back').addEventListener('click', () => { mode = 'pin'; paint(); });
        el.querySelector('#rc-pin').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, ''); });
        el.querySelector('#rc-go').addEventListener('click', async () => {
          const code = el.querySelector('#rc-code').value, np = el.querySelector('#rc-pin').value;
          if (!/^\d{4}$/.test(np)) { msg('الرقم السري لازم يبقى 4 أرقام'); return; }
          const chk = await checkRecoveryCode(code);
          if (chk === null) { msg('كود الطوارئ مش متسجل على الجهاز ده'); return; }
          if (!chk) { msg('كود الطوارئ غلط'); return; }
          const admin = AUTH.users.find(u => u.syncId === el.querySelector('#rc-admin').value);
          if (!admin) { msg('اختار مدير'); return; }
          const salt = randomHex(8);
          await DB.put('users', { ...admin, salt, pinHash: await hashSecret(np, salt) });
          await loadAuthUsers();
          finish(AUTH.users.find(u => u.syncId === admin.syncId));
        });
        return;
      }
      if (!selected) {
        el.innerHTML = `<div class="login-box">${head}<p>اختار اسمك</p>
          <div class="login-users">${AUTH.users.map(u => `<button class="btn login-user" data-uid="${u.syncId}">${U.esc(u.name)}</button>`).join('')}</div>
          <a class="login-link" id="login-forgot">نسيت الرقم السري؟</a></div>`;
        el.querySelectorAll('.login-user').forEach(b => b.addEventListener('click', () => { selected = AUTH.users.find(u => u.syncId === b.dataset.uid); pin = ''; paint(); }));
      } else {
        const keys = ['1','2','3','4','5','6','7','8','9','back','0','x'];
        el.innerHTML = `<div class="login-box">${head}<p>أهلًا ${U.esc(selected.name)} — اكتب الرقم السري</p>
          <div class="pin-dots">${[0,1,2,3].map(i => `<span class="${i < pin.length ? 'on' : ''}"></span>`).join('')}</div>
          <div class="pin-pad">${keys.map(k => k === 'x' ? '<span></span>' : `<button class="pin-key" data-k="${k}">${k === 'back' ? '⌫' : k}</button>`).join('')}</div>
          <div class="login-msg" id="login-msg"></div>
          ${AUTH.users.length > 1 ? '<a class="login-link" id="login-back">تغيير المستخدم</a> · ' : ''}<a class="login-link" id="login-forgot">نسيت الرقم السري؟</a></div>`;
        el.querySelectorAll('.pin-key').forEach(b => b.addEventListener('click', () => {
          if (b.dataset.k === 'back') { pin = pin.slice(0, -1); paint(); } else pushDigit(b.dataset.k);
        }));
        const back = el.querySelector('#login-back');
        if (back) back.addEventListener('click', () => { selected = null; pin = ''; paint(); });
      }
      const forgot = el.querySelector('#login-forgot');
      if (forgot) forgot.addEventListener('click', () => { mode = 'recovery'; paint(); });
    }
    document.addEventListener('keydown', onKey);
    paint();
  });
}

/* ---------- واجهة المستخدم الحالية ---------- */
function renderUserBox() {
  const el = document.getElementById('user-box');
  if (!el) return;
  if (!AUTH.required || !AUTH.user) { el.innerHTML = ''; return; }
  el.innerHTML = `<div>👤 ${U.esc(AUTH.user.name)}${AUTH.user.isAdmin ? ' <span class="tag">مدير</span>' : ''}</div><button class="btn btn-sm" id="lock-btn">🔒 قفل / تبديل المستخدم</button>`;
  el.querySelector('#lock-btn').addEventListener('click', lockApp);
}
function applyUserUI() {
  renderSidebar();
  const search = document.querySelector('.global-search-wrap');
  if (search) search.style.display = canDo('patients') ? '' : 'none';
  [['qa-patient', 'patients'], ['qa-appointment', 'appointments'], ['qa-visit', 'visits']].forEach(([id, p]) => {
    const b = document.getElementById(id); if (b) b.style.display = canDo(p) ? '' : 'none';
  });
  renderUserBox();
  if (typeof setActiveNav === 'function') setActiveNav(APP_STATE.route);
}
async function lockApp() {
  if (!AUTH.required) return;
  AUTH.user = null; U.closeModals();
  await showLoginScreen();
  applyUserUI(); route();
}
function startIdleWatch() {
  const reset = () => {
    if (AUTH.idleTimer) clearTimeout(AUTH.idleTimer);
    if (!AUTH.required || !AUTH.user) return;
    AUTH.idleTimer = setTimeout(() => { if (AUTH.required && AUTH.user && !loginVisible()) lockApp(); }, IDLE_LOCK_MS);
  };
  ['mousemove', 'keydown', 'click', 'touchstart'].forEach(ev => document.addEventListener(ev, reset, { passive: true }));
  reset();
}
/* بعد أي مزامنة جابت بيانات: لو ظهر موظفين من جهاز تاني، نطلب الدخول */
async function onSyncPulled() {
  await loadAuthUsers();
  if (AUTH.required && !AUTH.user && !loginVisible()) {
    U.closeModals();
    await showLoginScreen();
    applyUserUI(); route();
  } else applyUserUI();
}

/* منع فتح نوافذ الإضافة/التعديل لمن لا يملك الصلاحية (حتى لو جه من زرار داخل شاشة تانية) */
(function guardViews() {
  const guard = (name, perm) => {
    const f = Views[name];
    if (typeof f !== 'function') return;
    Views[name] = function (...args) {
      if (!canDo(perm)) { U.toast('ليس لديك صلاحية: ' + PERM_LABEL[perm], 'error'); return; }
      return f.apply(this, args);
    };
  };
  [['openNewPatientModal', 'patients'], ['openEditPatientModal', 'patients'], ['openNewAppointmentModal', 'appointments'],
   ['openNewVisitModal', 'visits'], ['openAddPaymentModal', 'payments'], ['openEditPaymentModal', 'payments'], ['openNewPrescriptionModal', 'prescriptions'],
   ['viewPrescription', 'prescriptions'], ['openNewTreatmentPlanModal', 'treatmentplans'], ['openNewExpenseModal', 'expenses']]
    .forEach(([n, p]) => guard(n, p));
})();

/* ---------- شاشة إدارة الموظفين (في الإعدادات) ---------- */
function digitsOnly(input) { input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, ''); }); }
const permSummary = (u) => PERMISSIONS.filter(p => u.perms && u.perms[p.key]).map(p => p.label).join('، ') || 'بدون صلاحيات';
const permGridHTML = (perms, disabled) => PERMISSIONS.map(p =>
  `<label class="perm-item"><input type="checkbox" data-perm="${p.key}" ${perms && perms[p.key] ? 'checked' : ''} ${disabled ? 'disabled' : ''}> ${p.label}</label>`).join('');

async function renderUsersCard(container) {
  const all = await DB.all('users');
  if (all.length === 0) {
    container.innerHTML = `
      <h3>الموظفين والصلاحيات</h3>
      <p class="muted">الحماية لسه مش مفعّلة — أي حد يفتح البرنامج بيشوف ويعمل كل حاجة. ابدأ بإنشاء حساب المدير (إنت)، وبعدها البرنامج هيطلب رقم سري عند التشغيل، وتقدر تضيف موظفين وتحدد لكل واحد صلاحياته.</p>
      <form id="first-admin-form" class="form-grid" autocomplete="off">
        <label>اسمك<input name="name" class="input"></label>
        <label>الرقم السري (4 أرقام)<input name="pin" class="input" type="password" inputmode="numeric" maxlength="4"></label>
        <label>تأكيد الرقم السري<input name="pin2" class="input" type="password" inputmode="numeric" maxlength="4"></label>
      </form>
      <button class="btn btn-primary" id="first-admin-btn">تفعيل الحماية</button>
      <p class="muted-sm">بعد التفعيل هتاخد كود طوارئ بيظهر مرة واحدة، احتفظ بيه لو نسيت الرقم السري.</p>`;
    container.querySelectorAll('input[type=password]').forEach(digitsOnly);
    container.querySelector('#first-admin-btn').addEventListener('click', async () => {
      const d = Object.fromEntries(new FormData(container.querySelector('#first-admin-form')).entries());
      if (!String(d.name).trim()) { U.toast('اكتب اسمك', 'error'); return; }
      if (!/^\d{4}$/.test(d.pin)) { U.toast('الرقم السري لازم 4 أرقام', 'error'); return; }
      if (d.pin !== d.pin2) { U.toast('تأكيد الرقم السري مش مطابق', 'error'); return; }
      const admin = await createUserRecord({ name: d.name, pin: d.pin, isAdmin: true, perms: {} });
      const code = makeRecoveryCode();
      await saveRecoveryCode(code);
      await loadAuthUsers();
      AUTH.user = AUTH.users.find(u => u.syncId === admin.syncId);
      applyUserUI();
      const ov = U.openModal('كود الطوارئ — احتفظ بيه', `
        <p>لو نسيت الرقم السري، الكود ده هو الطريقة الوحيدة لاسترجاع حساب المدير. اكتبه في ورقة واحتفظ بيها في مكان آمن. <b>مش هيظهر تاني.</b></p>
        <div class="recovery-code">${code}</div>`, `<button class="btn" id="copy-code">نسخ</button><button class="btn btn-primary" data-close>حفظته</button>`);
      ov.querySelector('#copy-code').addEventListener('click', async () => { try { await navigator.clipboard.writeText(code); U.toast('تم النسخ'); } catch (e) {} });
      renderUsersCard(container);
    });
    return;
  }
  if (!isAdminUser()) {
    container.innerHTML = `<h3>الموظفين والصلاحيات</h3><p class="muted">إدارة الموظفين متاحة للمدير فقط.</p>`;
    return;
  }
  container.innerHTML = `
    <h3>الموظفين والصلاحيات</h3>
    <p class="muted">كل موظف بيدخل برقم سري من 4 أرقام، وبيشوف بس الشاشات اللي إنت تسمحله بيها. البرنامج بيتقفل لوحده بعد 10 دقايق من عدم الاستخدام.</p>
    <div class="table-wrap"><table class="table table-compact">
      <thead><tr><th>الاسم</th><th>الصلاحيات</th><th>الحالة</th><th></th></tr></thead>
      <tbody>${all.map(u => `<tr>
        <td>${U.esc(u.name)}</td>
        <td>${u.isAdmin ? 'مدير (كل الصلاحيات + إدارة الموظفين)' : U.esc(permSummary(u))}</td>
        <td>${u.active === false ? 'موقوف' : 'نشط'}</td>
        <td><button class="btn btn-sm" data-edit="${u.id}">تعديل</button> <button class="btn btn-sm btn-danger" data-del="${u.id}">حذف</button></td>
      </tr>`).join('')}</tbody></table></div>
    <button class="btn btn-primary" id="user-add-btn" style="margin-top:10px">+ إضافة موظف</button>`;
  const refresh = async () => { await loadAuthUsers(); applyUserUI(); if (!canDo('settings')) route(); else renderUsersCard(container); };
  container.querySelector('#user-add-btn').addEventListener('click', () => openUserModal(null, all, refresh));
  container.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openUserModal(all.find(u => u.id === Number(b.dataset.edit)), all, refresh)));
  container.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    const u = all.find(x => x.id === Number(b.dataset.del));
    if (AUTH.user && u.syncId === AUTH.user.syncId) { U.toast('مينفعش تحذف حسابك الحالي', 'error'); return; }
    const otherAdmins = all.filter(x => x.id !== u.id && x.isAdmin && x.active !== false);
    if (u.isAdmin && u.active !== false && otherAdmins.length === 0) { U.toast('لازم يفضل مدير نشط واحد على الأقل', 'error'); return; }
    if (await U.confirm(`حذف الموظف "${u.name}" نهائيًا؟`)) { await DB.delete('users', u.id); U.toast('تم الحذف'); refresh(); }
  }));
}

function openUserModal(user, allUsers, onSaved) {
  const isNew = !user;
  const overlay = U.openModal(isNew ? 'إضافة موظف' : 'تعديل: ' + user.name, `
    <form id="user-form" class="form-grid" autocomplete="off">
      <label>الاسم *<input name="name" class="input" value="${U.esc(user ? user.name : '')}"></label>
      <label>${isNew ? 'الرقم السري (4 أرقام) *' : 'رقم سري جديد (سيبه فاضي لو مش عايز تغيّره)'}<input name="pin" class="input" type="password" inputmode="numeric" maxlength="4"></label>
      <label class="span-2 perm-item"><input type="checkbox" name="isAdmin" ${user && user.isAdmin ? 'checked' : ''}> مدير (كل الصلاحيات + إدارة الموظفين)</label>
      ${isNew ? '' : `<label class="span-2 perm-item"><input type="checkbox" name="active" ${user.active === false ? '' : 'checked'}> الحساب نشط</label>`}
      <div class="span-2" id="perm-section">
        <div class="muted-sm">اختار الصلاحيات (أو ابدأ بنموذج جاهز وعدّل عليه):</div>
        <div class="preset-row">${Object.keys(PERM_PRESETS).map(n => `<button type="button" class="btn btn-sm" data-preset="${n}">${n}</button>`).join('')}<button type="button" class="btn btn-sm" data-preset="__none">مسح الكل</button></div>
        <div class="perm-grid">${permGridHTML(user && user.perms, user && user.isAdmin)}</div>
      </div>
    </form>`, `<button class="btn btn-secondary" data-close>إلغاء</button><button class="btn btn-primary" id="user-save-btn">حفظ</button>`, { wide: true });
  digitsOnly(overlay.querySelector('[name=pin]'));
  const adminChk = overlay.querySelector('[name=isAdmin]');
  const setGrid = (keys) => overlay.querySelectorAll('[data-perm]').forEach(c => { c.checked = keys.includes(c.dataset.perm); });
  adminChk.addEventListener('change', () => overlay.querySelectorAll('[data-perm]').forEach(c => { c.disabled = adminChk.checked; }));
  overlay.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
    if (adminChk.checked) return;
    setGrid(b.dataset.preset === '__none' ? [] : PERM_PRESETS[b.dataset.preset]);
  }));
  overlay.querySelector('#user-save-btn').addEventListener('click', async () => {
    const f = overlay.querySelector('#user-form');
    const name = f.querySelector('[name=name]').value.trim();
    const pin = f.querySelector('[name=pin]').value.trim();
    const isAdmin = adminChk.checked;
    const active = isNew ? true : f.querySelector('[name=active]').checked;
    const perms = {};
    overlay.querySelectorAll('[data-perm]').forEach(c => { if (c.checked) perms[c.dataset.perm] = true; });
    if (!name) { U.toast('اكتب الاسم', 'error'); return; }
    if ((isNew || pin) && !/^\d{4}$/.test(pin)) { U.toast('الرقم السري لازم يبقى 4 أرقام', 'error'); return; }
    if (!isNew) {
      const otherAdmins = allUsers.filter(u => u.id !== user.id && u.isAdmin && u.active !== false);
      if (user.isAdmin && user.active !== false && !(isAdmin && active) && otherAdmins.length === 0) { U.toast('لازم يفضل مدير نشط واحد على الأقل', 'error'); return; }
      if (AUTH.user && user.syncId === AUTH.user.syncId && !active) { U.toast('مينفعش توقف حسابك الحالي', 'error'); return; }
    }
    if (isNew) {
      await createUserRecord({ name, pin, isAdmin, perms });
    } else {
      const upd = { ...user, name, isAdmin, perms, active };
      if (pin) { upd.salt = randomHex(8); upd.pinHash = await hashSecret(pin, upd.salt); }
      await DB.put('users', upd);
    }
    U.toast('تم الحفظ');
    overlay.remove();
    onSaved();
  });
}

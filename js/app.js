/* =========================================================
   app.js — الهيكل العام، التنقل، البحث الشامل
   ========================================================= */

const ROUTES = [
  { key: 'dashboard', label: 'لوحة التحكم', icon: '🏠' },
  { key: 'patients', label: 'المرضى', icon: '👤' },
  { key: 'appointments', label: 'المواعيد', icon: '📅' },
  { key: 'visits', label: 'الزيارات والعلاجات', icon: '🦷' },
  { key: 'prescriptions', label: 'الروشتات', icon: '💊' },
  { key: 'treatmentplans', label: 'خطط العلاج', icon: '🗂️' },
  { key: 'payments', label: 'المدفوعات', icon: '💰' },
  { key: 'debts', label: 'المديونيات', icon: '📋' },
  { key: 'expenses', label: 'المصروفات', icon: '🧾' },
  { key: 'reports', label: 'التقارير', icon: '📊' },
  { key: 'settings', label: 'الإعدادات', icon: '⚙️' },
  { key: 'backup', label: 'النسخ الاحتياطي', icon: '💾' },
];

async function boot() {
  await DB.init();
  const info = await DB.get('settings', 'clinicInfo');
  APP_STATE.clinicInfo = info.value;
  APP_STATE.currency = info.value.currency || 'ج.م';
  document.getElementById('clinic-name-title').textContent = info.value.name;
  await loadAuthUsers();
  if (AUTH.required) await showLoginScreen();
  applyUserUI();
  startIdleWatch();
  window.addEventListener('hashchange', route);
  route();
  setupGlobalSearch();
  setupQuickAdd();
  setupSyncIndicator();
  initSyncEngine();
  setupSidebarToggle();
  const mainEl = document.getElementById('main-content');
  new MutationObserver(U.debounce(() => U.enableTableSort(mainEl), 60)).observe(mainEl, { childList: true, subtree: true });
}

function setupSidebarToggle() {
  const toggleBtn = document.getElementById('sidebar-toggle-btn');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (!toggleBtn || !sidebar || !overlay) return;
  const closeSidebar = () => { sidebar.classList.remove('open'); overlay.classList.remove('open'); };
  const openSidebar = () => { sidebar.classList.add('open'); overlay.classList.add('open'); };
  toggleBtn.addEventListener('click', () => {
    sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
  });
  overlay.addEventListener('click', closeSidebar);
  sidebar.addEventListener('click', (e) => {
    if (e.target.closest('.nav-item') || e.target.closest('#sidebar-quick button')) closeSidebar();
  });
}

function renderSidebar() {
  const nav = document.getElementById('sidebar-nav');
  nav.innerHTML = ROUTES.filter(r => canDo(r.key)).map(r => `
    <a href="#${r.key}" class="nav-item" data-key="${r.key}">
      <span class="nav-icon">${r.icon}</span><span class="nav-label">${r.label}</span>
    </a>`).join('');
}

function setActiveNav(key) {
  document.querySelectorAll('.nav-item').forEach(a => a.classList.toggle('active', a.dataset.key === key));
}

async function route() {
  let hash = location.hash.replace('#','') || 'dashboard';
  const [key, param] = hash.split('/');
  APP_STATE.route = key;
  setActiveNav(key);
  const main = document.getElementById('main-content');
  if (!canDo(key)) {
    const first = ROUTES.find(r => canDo(r.key));
    if (first && AUTH.user) { location.hash = '#' + first.key; return; }
    main.innerHTML = '<div class="error-box">ليس لديك صلاحية لفتح هذه الشاشة. كلّم المدير لو محتاجها.</div>';
    return;
  }
  main.innerHTML = '<div class="loading">جاري التحميل...</div>';
  U.closeModals();
  try {
    switch (key) {
      case 'dashboard': await Views.dashboard(main); break;
      case 'patients': await Views.patients(main, param); break;
      case 'appointments': await Views.appointments(main, param); break;
      case 'visits': await Views.visits(main, param); break;
      case 'prescriptions': await Views.prescriptions(main, param); break;
      case 'treatmentplans': await Views.treatmentplans(main, param); break;
      case 'payments': await Views.payments(main, param); break;
      case 'expenses': await Views.expenses(main, param); break;
      case 'reports': await Views.reports(main, param); break;
      case 'settings': await Views.settings(main, param); break;
      case 'backup': await Views.backup(main, param); break;
      default: await Views.dashboard(main);
    }
  } catch (err) {
    console.error(err);
    main.innerHTML = `<div class="error-box">حدث خطأ غير متوقع: ${U.esc(err.message)}</div>`;
  }
}

function goto(hash) { location.hash = hash; }

function setupGlobalSearch() {
  const input = document.getElementById('global-search');
  const results = document.getElementById('global-search-results');
  const run = U.debounce(async () => {
    const q = input.value.trim();
    if (!q) { results.innerHTML = ''; results.classList.remove('open'); return; }
    const patients = (await DB.all('patients')).filter(p => !p.isDeleted && (
      p.fullName.includes(q) || p.phone.includes(q) || p.fileNumber.toLowerCase().includes(q.toLowerCase())
    )).slice(0, 8);
    if (!patients.length) {
      results.innerHTML = `<div class="search-empty">لا توجد نتائج</div>`;
    } else {
      results.innerHTML = patients.map(p => `
        <a class="search-result" href="#patients/${p.id}">
          <b>${U.esc(p.fullName)}</b> <span>${U.esc(p.fileNumber)} • ${U.esc(p.phone)}</span>
        </a>`).join('');
    }
    results.classList.add('open');
  }, 200);
  input.addEventListener('input', run);
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.global-search-wrap')) results.classList.remove('open');
  });
}

function setupQuickAdd() {
  document.getElementById('qa-patient').addEventListener('click', () => Views.openNewPatientModal());
  document.getElementById('qa-appointment').addEventListener('click', () => Views.openNewAppointmentModal());
  document.getElementById('qa-visit').addEventListener('click', () => Views.openNewVisitModal());
}

function setupSyncIndicator() {
  const el = document.getElementById('sync-indicator');
  if (!el) return;
  const render = async () => {
    const cfg = await getSyncConfig();
    if (!cfg.enabled) { el.style.display = 'none'; return; }
    el.style.display = 'inline-flex';
    el.classList.remove('sync-idle','sync-syncing','sync-error','sync-offline');
    if (!navigator.onLine) { el.classList.add('sync-offline'); el.textContent = '⚪ غير متصل بالإنترنت'; return; }
    el.classList.add('sync-idle');
    el.textContent = '🟢 متزامن';
  };
  onSyncStatusChange((status) => {
    if (status === 'syncing') { el.style.display='inline-flex'; el.className = 'sync-indicator sync-syncing'; el.textContent = '🔄 جاري المزامنة...'; }
    else if (status === 'error') { el.className = 'sync-indicator sync-error'; el.textContent = '🔴 خطأ في المزامنة'; }
    else render();
  });
  window.addEventListener('online', render);
  window.addEventListener('offline', render);
  render();
}

document.addEventListener('DOMContentLoaded', boot);

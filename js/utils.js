/* =========================================================
   utils.js — دوال مساعدة عامة
   ========================================================= */

const U = {
  money(n) {
    n = Number(n || 0);
    return n.toLocaleString('ar-EG', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' ' + APP_STATE.currency;
  },
  isoLocal(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; },
  todayISO() { return U.isoLocal(new Date()); },
  enableTableSort(root) {
    const col = new Intl.Collator('ar', { numeric: true, sensitivity: 'base' });
    const norm = (t) => t.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/٫/g, '.').replace(/[٬,\s]/g, '').replace(/ج\.م$/, '');
    root.querySelectorAll('table.table').forEach(t => {
      const tbody = t.tBodies[0];
      if (t.dataset.sortable || !t.tHead || !tbody || tbody.querySelector('input,select,textarea')) return;
      t.dataset.sortable = '1';
      const ths = [...t.tHead.rows[0].cells];
      const st = { c: -1, dir: 1 };
      const cellText = (tr, i) => (tr.cells[i] ? tr.cells[i].textContent.trim() : '');
      const dataRows = () => [...tbody.rows].filter(r => !r.querySelector('td[colspan]'));
      const detect = (rows, i) => {
        const v = rows.map(r => norm(cellText(r, i))).filter(Boolean);
        if (v.length && v.every(x => /^\d{1,2}\/\d{1,2}\/\d{4}/.test(x))) return 'date';
        if (v.length && v.every(x => /^-?\d+(\.\d+)?$/.test(x))) return 'num';
        return 'text';
      };
      const keyOf = (type, raw) => {
        const v = norm(raw);
        if (type === 'date') { const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return +m[3] * 10000 + +m[2] * 100 + +m[1]; }
        return type === 'num' ? parseFloat(v) : raw;
      };
      let apply;
      const obs = new MutationObserver(() => apply());
      apply = () => {
        if (st.c < 0) return;
        const rows = dataRows();
        if (rows.length < 2) return;
        const type = detect(rows, st.c);
        rows.sort((a, b) => {
          const ra = cellText(a, st.c), rb = cellText(b, st.c);
          if (!ra && !rb) return 0; if (!ra) return 1; if (!rb) return -1;
          const ka = keyOf(type, ra), kb = keyOf(type, rb);
          return (type === 'text' ? col.compare(ka, kb) : ka - kb) * st.dir;
        });
        obs.disconnect(); rows.forEach(r => tbody.appendChild(r)); obs.observe(tbody, { childList: true });
      };
      ths.forEach((th, i) => {
        if (!th.textContent.trim()) return;
        th.classList.add('sortable'); th.title = 'اضغط للترتيب';
        th.addEventListener('click', () => {
          const type = detect(dataRows(), i);
          if (st.c === i) st.dir = -st.dir; else { st.c = i; st.dir = type === 'text' ? 1 : -1; }
          ths.forEach(h => { const s = h.querySelector('.sort-ind'); if (s) s.remove(); });
          th.insertAdjacentHTML('beforeend', `<span class="sort-ind">${st.dir === 1 ? '▲' : '▼'}</span>`);
          apply();
        });
      });
      obs.observe(tbody, { childList: true });
    });
  },
  fmtDate(iso) {
    if (!iso) return '';
    const [y,m,d] = iso.split('-');
    return `${d}/${m}/${y}`;
  },
  fmtDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return U.fmtDate(U.isoLocal(d)) + ' ' + d.toTimeString().slice(0,5);
  },
  esc(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  },
  debounce(fn, ms=250) {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  },
  toast(msg, type='success') {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    document.getElementById('toast-container').appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3200);
  },
  confirm(message) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal modal-sm">
          <div class="modal-body"><p>${U.esc(message)}</p></div>
          <div class="modal-footer">
            <button class="btn btn-secondary" data-a="no">إلغاء</button>
            <button class="btn btn-danger" data-a="yes">تأكيد</button>
          </div>
        </div>`;
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) { overlay.remove(); resolve(false); }
        const a = e.target.dataset.a;
        if (a === 'yes') { overlay.remove(); resolve(true); }
        if (a === 'no') { overlay.remove(); resolve(false); }
      });
      document.body.appendChild(overlay);
    });
  },
  openModal(title, bodyHTML, footerHTML, opts={}) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal ${opts.wide ? 'modal-wide' : ''}">
        <div class="modal-header">
          <h3>${title}</h3>
          <button class="modal-close" data-close>&times;</button>
        </div>
        <div class="modal-body">${bodyHTML}</div>
        ${footerHTML ? `<div class="modal-footer">${footerHTML}</div>` : ''}
      </div>`;
    let dirty = false;
    const markDirty = (e) => { const t = e.target; if (t.type === 'file' || t.classList.contains('select-filter') || !t.closest('.modal-body')) return; dirty = true; };
    overlay.addEventListener('input', markDirty); overlay.addEventListener('change', markDirty);
    overlay.addEventListener('click', async (e) => {
      if (e.target === overlay || e.target.hasAttribute('data-close')) {
        if (dirty && !opts.noGuard && !(await U.confirm('فيه بيانات لسه ما اتحفظتش. تقفل من غير حفظ؟'))) return;
        overlay.remove();
      }
    });
    document.body.appendChild(overlay);
    overlay.querySelectorAll('select[name="patientId"]:not([disabled])').forEach(U.searchableSelect);
    return overlay;
  },
  /* بحث فوري داخل قائمة المرضى: اكتب جزء من الاسم أو رقم الملف */
  searchableSelect(sel) {
    if (sel.dataset.ss) return; sel.dataset.ss = '1';
    const inp = document.createElement('input');
    inp.type = 'text'; inp.className = 'input select-filter'; inp.placeholder = '🔍 اكتب اسم المريض أو رقم الملف للبحث...';
    sel.parentNode.insertBefore(inp, sel);
    const opts = [...sel.options];
    const reset = () => { inp.value = ''; opts.forEach(o => { o.hidden = false; }); sel.size = 1; };
    sel.addEventListener('change', () => { if (!sel._ssBusy) reset(); });
    inp.addEventListener('input', () => {
      const q = inp.value.trim().toLowerCase();
      if (!q) { reset(); return; }
      opts.forEach(o => { o.hidden = o.value !== '' && !o.textContent.toLowerCase().includes(q); });
      const vis = opts.filter(o => !o.hidden && o.value !== '');
      sel.size = Math.min(6, Math.max(2, vis.length + 1));
      if (vis.length) { sel._ssBusy = true; sel.value = vis[0].value; sel.dispatchEvent(new Event('change', { bubbles: true })); sel._ssBusy = false; }
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); reset(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); sel.focus(); }
    });
  },
  normPhone(p) {
    let d = String(p || '').replace(/[^\d]/g, '');
    if (d.startsWith('0020')) d = d.slice(4); else if (d.startsWith('20') && d.length === 12) d = d.slice(2);
    if (/^1\d{9}$/.test(d)) d = '0' + d;
    return d;
  },
  validPhone(p) { return /^01[0-25]\d{8}$/.test(U.normPhone(p)); },
  closeModals() { document.querySelectorAll('.modal-overlay').forEach(m => m.remove()); },

  waPhone(phone) {
    if (!phone) return '';
    let p = phone.replace(/[^0-9]/g, '');
    if (p.startsWith('0')) p = '20' + p.slice(1);
    else if (!p.startsWith('20')) p = '20' + p;
    return p;
  },
  waLink(phone, text) {
    return `https://wa.me/${U.waPhone(phone)}?text=${encodeURIComponent(text)}`;
  },

  exportToExcel(sheets, filename) {
    if (typeof canDo === 'function' && !canDo('export')) { U.toast('ليس لديك صلاحية تصدير Excel', 'error'); return; }
    // sheets: [{name, rows: [ {colAr: val, ...}, ... ]}]
    const wb = XLSX.utils.book_new();
    sheets.forEach(sheet => {
      const ws = XLSX.utils.json_to_sheet(sheet.rows, { skipHeader: false });
      ws['!rtl'] = true;
      // widen columns roughly
      const cols = sheet.rows.length ? Object.keys(sheet.rows[0]) : [];
      ws['!cols'] = cols.map(c => ({ wch: Math.max(12, c.length + 4) }));
      XLSX.utils.book_append_sheet(wb, ws, sheet.name);
    });
    XLSX.writeFile(wb, filename);
  },

  discountedTotal(subtotal, discountType, discountValue) {
    subtotal = Number(subtotal || 0); discountValue = Number(discountValue || 0);
    if (discountType === 'percentage') return Math.max(0, subtotal - (subtotal * discountValue / 100));
    return Math.max(0, subtotal - discountValue);
  },

  printSection(innerHTML, title='طباعة') {
    const w = window.open('', '_blank');
    w.document.write(`
      <html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>${title}</title>
      <link rel="stylesheet" href="css/print.css"></head>
      <body onload="setTimeout(()=>{window.print();}, 250)">${innerHTML}</body></html>`);
    w.document.close();
  },

  el(tag, attrs={}, children=[]) {
    const e = document.createElement(tag);
    Object.entries(attrs).forEach(([k,v]) => {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
      else e.setAttribute(k, v);
    });
    (Array.isArray(children) ? children : [children]).forEach(c => {
      if (typeof c === 'string') e.insertAdjacentHTML('beforeend', c);
      else if (c) e.appendChild(c);
    });
    return e;
  },
};

const APP_STATE = {
  currency: 'ج.م',
  clinicInfo: null,
  route: 'dashboard',
};

/* Views is populated by each module file (patients.js, visits.js, ...);
   declared here since utils.js loads first, before any module assigns to it. */
const Views = {};

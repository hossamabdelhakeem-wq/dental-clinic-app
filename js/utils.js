/* =========================================================
   utils.js — دوال مساعدة عامة
   ========================================================= */

const U = {
  money(n) {
    n = Number(n || 0);
    return n.toLocaleString('ar-EG', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' ' + APP_STATE.currency;
  },
  todayISO() { return new Date().toISOString().slice(0,10); },
  fmtDate(iso) {
    if (!iso) return '';
    const [y,m,d] = iso.split('-');
    return `${d}/${m}/${y}`;
  },
  fmtDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return U.fmtDate(d.toISOString().slice(0,10)) + ' ' + d.toTimeString().slice(0,5);
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
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.hasAttribute('data-close')) overlay.remove();
    });
    document.body.appendChild(overlay);
    return overlay;
  },
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

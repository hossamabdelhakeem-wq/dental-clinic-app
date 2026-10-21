/* =========================================================
   import.js — استيراد من Excel/CSV
   3 أنواع: سجل الزيارات والدفعات، المصروفات، بيانات المرضى التفصيلية.
   - التواريخ: بيتكشف تلقائيًا لو الملف شهر/يوم ولا يوم/شهر.
   - الاستيراد آمن للتكرار: الصفوف اللي اتستوردت قبل كده بتتخطى.
   - بعد الاستيراد: تقرير مطابقة بأرقام شهرية ومديونية كل مريض.
   ========================================================= */

const IMPORT_TYPES = {
  ledger: { label: 'سجل الزيارات والدفعات (المرضى)', fields: [
    { key: 'date', label: 'التاريخ', required: true, keywords: ['date', 'تاريخ'] },
    { key: 'fileNo', label: 'رقم الملف', required: true, keywords: ['file no', 'file', 'رقم الملف'] },
    { key: 'patientName', label: 'اسم المريض', required: true, keywords: ['patient name', 'اسم المريض', 'name'] },
    { key: 'phone', label: 'رقم الهاتف', keywords: ['phone', 'هاتف', 'موبايل', 'mobile'], exclude: ['alt', 'بديل'] },
    { key: 'serviceType', label: 'نوع الخدمة', keywords: ['service type', 'نوع الخدمة'] },
    { key: 'serviceCost', label: 'تكلفة الخدمة', keywords: ['service cost', 'تكلفة الخدمة', 'cost'] },
    { key: 'paid', label: 'المدفوع', keywords: ['paid', 'مدفوع'] },
    { key: 'remaining', label: 'المتبقي', keywords: ['remaining', 'متبقي'] },
    { key: 'totalDebt', label: 'إجمالي المديونية (للمطابقة فقط)', keywords: ['total debt', 'مديونية'] },
    { key: 'doctor', label: 'دكتور الشيفت', keywords: ['doctor', 'دكتور', 'shift'] },
  ]},
  expenses: { label: 'المصروفات', fields: [
    { key: 'date', label: 'التاريخ', required: true, keywords: ['date', 'تاريخ'] },
    { key: 'amount', label: 'المبلغ', required: true, keywords: ['amount', 'المبلغ', 'مبلغ', 'القيمة', 'قيمة', 'cost', 'price', 'سعر'] },
    { key: 'description', label: 'البيان', keywords: ['description', 'البيان', 'بيان', 'details', 'item', 'الصنف'] },
    { key: 'category', label: 'نوع المصروف', keywords: ['category', 'النوع', 'نوع', 'تصنيف', 'بند'] },
    { key: 'method', label: 'طريقة الدفع', keywords: ['method', 'طريقة', 'payment'] },
    { key: 'notes', label: 'ملاحظات', keywords: ['notes', 'note', 'ملاحظات'] },
  ]},
  patients: { label: 'بيانات المرضى التفصيلية', fields: [
    { key: 'fileNo', label: 'رقم الملف', required: true, keywords: ['file no', 'file', 'رقم الملف'] },
    { key: 'patientName', label: 'اسم المريض', required: true, keywords: ['patient name', 'اسم المريض', 'name', 'الاسم'] },
    { key: 'phone', label: 'رقم الهاتف', keywords: ['phone', 'هاتف', 'موبايل', 'mobile'], exclude: ['alt', 'بديل', '2', 'ثاني'] },
    { key: 'altPhone', label: 'رقم هاتف بديل', keywords: ['alt', 'بديل', 'phone 2', 'هاتف 2', 'ثاني'] },
    { key: 'dob', label: 'تاريخ الميلاد', keywords: ['birth', 'ميلاد', 'dob'] },
    { key: 'gender', label: 'النوع', keywords: ['gender', 'sex', 'جنس', 'النوع'] },
    { key: 'address', label: 'العنوان', keywords: ['address', 'عنوان'] },
    { key: 'source', label: 'مصدر معرفة العيادة', keywords: ['source', 'مصدر'] },
    { key: 'notes', label: 'ملاحظات', keywords: ['notes', 'note', 'ملاحظات'] },
  ]},
};

let importState = null;

/* ---------- أدوات القراءة ---------- */
function cleanCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '').replace(/\u00A0/g, ' ').trim();
  return v;
}
function pickCell(row, idx) { return idx === undefined || idx < 0 ? '' : cleanCell(row[idx]); }

function isoFromParts(y, mo, d) {
  y = Number(y); mo = Number(mo); d = Number(d);
  if (!y || !mo || !d || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (y < 100) y += 2000;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function isoFromLocalDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* بيحدد صيغة عمود التاريخ كله: 'mdy' (شهر/يوم) أو 'dmy' (يوم/شهر) من أي تاريخ يومه أكبر من 12 */
function detectDateOrder(values) {
  let dmy = 0, mdy = 0;
  for (const v of values) {
    if (v instanceof Date) continue;
    const m = String(cleanCell(v)).match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (!m) continue;
    const a = +m[1], b = +m[2];
    if (a > 12 && b <= 12) dmy++; else if (b > 12 && a <= 12) mdy++;
  }
  if (dmy && !mdy) return 'dmy';
  if (mdy && !dmy) return 'mdy';
  if (dmy && mdy) return 'mixed';
  return 'unknown';
}
function dateOrderLabel(o) {
  return ({ mdy: 'شهر/يوم/سنة (مثال 10/13/2025)', dmy: 'يوم/شهر/سنة (مثال 13/10/2025)',
    mixed: 'مختلطة — كل تاريخ بيتفهم حسب شكله، والغامض بيتقرأ يوم/شهر', unknown: 'مش واضحة من الملف — افتُرض يوم/شهر/سنة، راجع التواريخ في المعاينة' })[o];
}

function parseImportDate(val, order) {
  if (val === null || val === undefined || val === '') return null;
  if (val instanceof Date && !isNaN(val)) return isoFromLocalDate(val);
  const s = String(cleanCell(val));
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return isoFromParts(m[1], m[2], m[3]);
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]), y = Number(m[3]);
    let day, month;
    if (a > 12 && b <= 12) { day = a; month = b; }
    else if (b > 12 && a <= 12) { day = b; month = a; }
    else if (order === 'mdy') { day = b; month = a; }
    else { day = a; month = b; }
    return isoFromParts(y, month, day);
  }
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = parseFloat(s);
    if (serial > 20000 && serial < 80000) {
      const d = new Date(Math.floor(serial - 25569) * 86400 * 1000);
      return isoFromParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
  }
  const d = new Date(s);
  if (!isNaN(d)) return isoFromLocalDate(d);
  return null;
}
function parseImportNumber(val) {
  const v = cleanCell(val);
  if (v === '' || v === undefined || v === null) return 0;
  const s = String(v).replace(/,/g, '').replace(/[^\d.\-]/g, '');
  if (s === '' || s === '-' || s === '.') return 0;
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
function hasValue(v) { const c = cleanCell(v); return c !== '' && c !== '-' && c !== '//'; }
function cleanPhone(v) { const s = String(cleanCell(v)); return (s === '//' || s === '-' || s === '0') ? '' : s; }

function autoMap(fields, headers) {
  const taken = new Set(); const map = {};
  fields.forEach(f => {
    const idx = headers.findIndex((h, i) => !taken.has(i)
      && f.keywords.some(k => h.toLowerCase().includes(k.toLowerCase()))
      && !(f.exclude || []).some(x => h.toLowerCase().includes(x.toLowerCase())));
    map[f.key] = idx; if (idx >= 0) taken.add(idx);
  });
  return map;
}
function guessType(sheetName) {
  if (/database|قاعدة|بيانات المرضى/i.test(sheetName)) return 'patients';
  if (/expens|مصروف/i.test(sheetName) && !/شهري|monthly|احصائ|stat/i.test(sheetName)) return 'expenses';
  return 'ledger';
}
const looksComputed = (n) => /احصائ|stat|dashboard|الدخل|income|شهري|monthly/i.test(n);

/* ---------- المعالج: الخطوات ---------- */
function openImportWizard() {
  importState = { workbook: null, sheetName: null, type: 'ledger', headers: [], rows: [], mapping: {}, dateOrder: 'unknown' };
  const overlay = U.openModal('استيراد بيانات من Excel / CSV', `
    <p>اختر ملف Excel (.xlsx) أو CSV. تقدر تستورد كل تبويب لوحده (سجل الزيارات، المصروفات، بيانات المرضى) بتكرار الخطوات.</p>
    <input type="file" id="import-file-input" accept=".xlsx,.xls,.csv">
    <div id="import-sheet-picker" style="margin-top:14px"></div>
    <div id="import-file-status" class="muted-sm" style="margin-top:8px"></div>`, '', { wide: true });
  bindImportStage0(overlay);
}

function bindImportStage0(overlay) {
  const fileInput = overlay.querySelector('#import-file-input');
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const status = overlay.querySelector('#import-file-status');
    status.textContent = 'جاري قراءة الملف...';
    try {
      let workbook;
      if (file.name.toLowerCase().endsWith('.csv')) workbook = XLSX.read(await file.text(), { type: 'string' });
      else workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      importState.workbook = workbook;
      status.textContent = `تم تحميل الملف — عدد التبويبات: ${workbook.SheetNames.length}`;
      const names = workbook.SheetNames;
      const first = names.findIndex(n => !looksComputed(n));
      const picker = overlay.querySelector('#import-sheet-picker');
      picker.innerHTML = `
        <div class="form-grid">
          <label>التبويب (Sheet)
            <select id="import-sheet-select" class="input">${names.map((n, i) => `<option value="${U.esc(n)}" ${i === (first >= 0 ? first : 0) ? 'selected' : ''}>${U.esc(n)}${looksComputed(n) ? ' (ملخص محسوب)' : ''}</option>`).join('')}</select>
          </label>
          <label>نوع البيانات
            <select id="import-type-select" class="input">${Object.entries(IMPORT_TYPES).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join('')}</select>
          </label>
        </div>
        <p class="muted-sm" id="import-sheet-hint"></p>
        <button class="btn btn-primary" id="import-next-1">التالي — مطابقة الأعمدة</button>`;
      const sheetSel = picker.querySelector('#import-sheet-select'), typeSel = picker.querySelector('#import-type-select'), hint = picker.querySelector('#import-sheet-hint');
      const syncType = () => {
        typeSel.value = guessType(sheetSel.value);
        hint.textContent = looksComputed(sheetSel.value) ? 'التبويب ده شكله ملخص/إحصائية بيحسبها البرنامج لوحده — مش محتاج يتستورد، وهتقدر تقارن أرقامه بتقارير البرنامج بعد الاستيراد.' : '';
      };
      sheetSel.addEventListener('change', syncType); syncType();
      picker.querySelector('#import-next-1').addEventListener('click', () => {
        importState.sheetName = sheetSel.value; importState.type = typeSel.value;
        goToImportStage1(overlay);
      });
    } catch (err) {
      status.textContent = 'تعذّرت قراءة الملف — تأكد أنه ملف Excel أو CSV صحيح.';
      console.error(err);
    }
  });
}

function goToImportStage1(overlay) {
  const ws = importState.workbook.Sheets[importState.sheetName];
  const rowsRaw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, dateNF: 'yyyy-mm-dd' });
  const nonEmpty = (r) => r.filter(c => String(cleanCell(c)) !== '').length;
  let hIdx = rowsRaw.findIndex(r => nonEmpty(r) >= 3);
  if (hIdx === -1) hIdx = Math.max(0, rowsRaw.findIndex(r => nonEmpty(r) >= 1));
  const headers = (rowsRaw[hIdx] || []).map(h => String(cleanCell(h)));
  importState.headers = headers;
  importState.rows = rowsRaw.slice(hIdx + 1).filter(r => nonEmpty(r) > 0);
  const fields = IMPORT_TYPES[importState.type].fields;
  const mapping = autoMap(fields, headers);
  const body = overlay.querySelector('.modal-body');
  body.innerHTML = `
    <p>نوع البيانات: <b>${IMPORT_TYPES[importState.type].label}</b> — عدد الصفوف: <b>${importState.rows.length}</b>. طابق كل حقل بالعمود المناسب (التخمين تلقائي، عدّل لو محتاج):</p>
    <div class="form-grid" id="import-mapping-form">
      ${fields.map(f => `<label>${f.label}${f.required ? ' *' : ''}
        <select class="input" data-field="${f.key}">
          <option value="-1">${f.required ? '-- اختر عمود --' : '-- تجاهل هذا الحقل --'}</option>
          ${headers.map((h, i) => `<option value="${i}" ${mapping[f.key] === i ? 'selected' : ''}>${U.esc(h || `عمود ${i + 1}`)}</option>`).join('')}
        </select></label>`).join('')}
    </div>
    <div style="margin-top:16px"><button class="btn btn-primary" id="import-next-2">التالي — معاينة</button></div>`;
  body.querySelector('#import-next-2').addEventListener('click', () => {
    let missing = false;
    fields.forEach(f => {
      const v = Number(body.querySelector(`[data-field="${f.key}"]`).value);
      importState.mapping[f.key] = v;
      if (f.required && v === -1) missing = true;
    });
    if (missing) { U.toast('لازم تحدد عمود لكل الحقول الأساسية (المعلّمة بـ *)', 'error'); return; }
    goToImportStage2(overlay);
  });
}

function goToImportStage2(overlay) {
  const { rows, mapping, type } = importState;
  importState.dateOrder = mapping.date >= 0 ? detectDateOrder(rows.map(r => r[mapping.date])) : (mapping.dob >= 0 ? detectDateOrder(rows.map(r => r[mapping.dob])) : 'unknown');
  const o = importState.dateOrder;
  const d = (r, k) => (mapping[k] >= 0 ? parseImportDate(r[mapping[k]], o) : null) || '—';
  const cols = {
    ledger: [['التاريخ', r => d(r, 'date')], ['الملف', r => pickCell(r, mapping.fileNo)], ['الاسم', r => pickCell(r, mapping.patientName)], ['الخدمة', r => pickCell(r, mapping.serviceType) || '(غير محدد)'], ['التكلفة', r => parseImportNumber(pickCell(r, mapping.serviceCost))], ['المدفوع', r => parseImportNumber(pickCell(r, mapping.paid))], ['المتبقي', r => hasValue(pickCell(r, mapping.remaining)) ? parseImportNumber(pickCell(r, mapping.remaining)) : '(يتحسب)']],
    expenses: [['التاريخ', r => d(r, 'date')], ['النوع', r => pickCell(r, mapping.category) || '(أخرى)'], ['البيان', r => pickCell(r, mapping.description)], ['المبلغ', r => parseImportNumber(pickCell(r, mapping.amount))]],
    patients: [['الملف', r => pickCell(r, mapping.fileNo)], ['الاسم', r => pickCell(r, mapping.patientName)], ['الهاتف', r => pickCell(r, mapping.phone)], ['بديل', r => pickCell(r, mapping.altPhone)], ['الميلاد', r => d(r, 'dob')]],
  }[type];
  const body = overlay.querySelector('.modal-body');
  const hasDateCol = mapping.date >= 0 || mapping.dob >= 0;
  body.innerHTML = `
    ${hasDateCol ? `<div class="card" style="margin-bottom:10px"><b>صيغة التاريخ المكتشفة:</b> ${dateOrderLabel(o)}${(o === 'unknown' || o === 'mixed') ? '<br><span class="muted-sm">راجع عمود التاريخ في المعاينة تحت. لو غلط، ارجع وعدّل الملف أو ابعتهولي.</span>' : ''}</div>` : ''}
    <p>معاينة أول ${Math.min(8, rows.length)} صف من ${rows.length}:</p>
    <div class="table-wrap"><table class="table table-compact"><thead><tr>${cols.map(c => `<th>${c[0]}</th>`).join('')}</tr></thead>
      <tbody>${rows.slice(0, 8).map(r => `<tr>${cols.map(c => `<td>${U.esc(c[1](r))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <p class="muted-sm">الاستيراد بيضيف بس، ومش بيكرر أي صف اتستورد قبل كده.</p>
    <div style="margin-top:12px;display:flex;gap:10px">
      <button class="btn btn-secondary" data-close>إلغاء</button>
      <button class="btn btn-primary" id="import-confirm-btn">استيراد ${rows.length} صف الآن</button>
    </div>
    <div id="import-progress" class="muted-sm" style="margin-top:10px"></div>`;
  body.querySelector('#import-confirm-btn').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      if (type === 'ledger') await runImportLedger(overlay);
      else if (type === 'expenses') await runImportExpenses(overlay);
      else await runImportPatients(overlay);
    } catch (err) {
      console.error(err);
      body.querySelector('#import-progress').innerHTML = `<div class="error-box">حصل خطأ أثناء الاستيراد: ${U.esc(err.message)}<br>اللي اتستورد لحد دلوقتي فاضل زي ما هو، وتقدر تعيد الاستيراد (مش هيتكرر).</div>`;
    }
  });
}

/* ---------- عرض النتيجة ---------- */
const monthTable = (obj, extraCols) => {
  const keys = Object.keys(obj).sort();
  if (!keys.length) return '';
  return `<div class="table-wrap"><table class="table table-compact"><thead><tr><th>الشهر</th>${extraCols.map(c => `<th>${c.label}</th>`).join('')}</tr></thead><tbody>${keys.map(k => `<tr><td>${k}</td>${extraCols.map(c => `<td>${U.money(obj[k][c.key] || 0)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
};
const statCard = (label, value, bad) => `<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-value ${bad ? 'stat-bad' : ''}">${value}</div></div>`;
function showImportResult(overlay, html, exportSheets) {
  overlay.querySelector('.modal-body').innerHTML = html + `
    <div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">
      ${exportSheets ? '<button class="btn" id="import-report-btn">تنزيل تقرير المطابقة (Excel)</button>' : ''}
      <button class="btn btn-primary" id="import-done-btn">تم</button>
    </div>`;
  const rb = overlay.querySelector('#import-report-btn');
  if (rb) rb.addEventListener('click', () => U.exportToExcel(exportSheets, `تقرير_الاستيراد_${U.todayISO()}.xlsx`));
  overlay.querySelector('#import-done-btn').addEventListener('click', () => { overlay.remove(); route(); });
  U.toast('اكتمل الاستيراد');
}
const progress = (overlay, t) => { const el = overlay.querySelector('#import-progress'); if (el) el.textContent = t; };

/* ---------- 1) سجل الزيارات والدفعات ---------- */
async function runImportLedger(overlay) {
  const { rows, mapping, dateOrder } = importState;
  const today = U.todayISO();
  const [patients, services, doctors, cats, visits, counters] = await Promise.all([
    DB.all('patients'), DB.all('services'), DB.all('doctors'), DB.all('serviceCategories'), DB.all('visits'), DB.get('settings', 'counters'),
  ]);
  const num = (fileNumber) => String(parseInt(String(fileNumber).replace(/\D/g, ''), 10) || fileNumber);

  // مرور أول: تجميع بيانات كل مريض (أقدم تاريخ، كل أرقام الهاتف، آخر مديونية في الشيت)
  const info = {}; const parsed = [];
  let skipped = 0, dateFailures = 0, maxNo = 0;
  for (const r of rows) {
    const rawFileNo = String(pickCell(r, mapping.fileNo) ?? '').trim();
    const name = String(pickCell(r, mapping.patientName)).trim();
    if (!rawFileNo || !name) { skipped++; parsed.push(null); continue; }
    const nm = rawFileNo.match(/\d+/);
    if (nm) maxNo = Math.max(maxNo, parseInt(nm[0], 10));
    const fileNumber = nm ? formatSeq('P', parseInt(nm[0], 10)) : `P-${rawFileNo}`;
    let date = parseImportDate(pickCell(r, mapping.date), dateOrder);
    if (!date) { dateFailures++; date = today; }
    const cost = parseImportNumber(pickCell(r, mapping.serviceCost));
    const paid = parseImportNumber(pickCell(r, mapping.paid));
    const remRaw = mapping.remaining >= 0 ? pickCell(r, mapping.remaining) : '';
    const remaining = hasValue(remRaw) ? parseImportNumber(remRaw) : cost - paid;
    const phone = cleanPhone(pickCell(r, mapping.phone));
    const debtRaw = mapping.totalDebt >= 0 ? pickCell(r, mapping.totalDebt) : '';
    const p = info[fileNumber] || (info[fileNumber] = { name, phones: [], minDate: date, lastDebt: null });
    if (phone && !p.phones.includes(phone)) p.phones.push(phone);
    if (date < p.minDate) p.minDate = date;
    if (hasValue(debtRaw)) p.lastDebt = parseImportNumber(debtRaw);
    parsed.push({ fileNumber, date, cost, paid, remaining, service: String(pickCell(r, mapping.serviceType)).trim(), doctor: String(pickCell(r, mapping.doctor)).trim() });
  }

  // المرضى: إنشاء الجديد، وتكملة الهاتف الناقص للموجود
  const byFile = Object.fromEntries(patients.map(p => [p.fileNumber, p]));
  let patientsCreated = 0, patientsUpdated = 0;
  progress(overlay, 'جاري إنشاء المرضى...');
  for (const [fileNumber, p] of Object.entries(info)) {
    const ex = byFile[fileNumber];
    if (ex) {
      const upd = {};
      if (!ex.phone && p.phones[0]) upd.phone = p.phones[0];
      if (!ex.altPhone && p.phones[1]) upd.altPhone = p.phones[1];
      if (Object.keys(upd).length) { await DB.put('patients', { ...ex, ...upd }); patientsUpdated++; }
    } else {
      const extra = p.phones.length > 2 ? ` — أرقام إضافية: ${p.phones.slice(2).join(' ، ')}` : '';
      const id = await DB.add('patients', {
        fileNumber, fullName: p.name, phone: p.phones[0] || '', altPhone: p.phones[1] || '', dob: '', gender: '', address: '',
        source: 'أخرى', notes: 'تم الاستيراد من شيت قديم' + extra, createdAt: p.minDate || today, isDeleted: false,
      });
      byFile[fileNumber] = { id, fileNumber, fullName: p.name };
      patientsCreated++;
    }
  }

  // مفاتيح الصفوف اللي اتستوردت قبل كده (عشان الاستيراد ما يكررش)
  const patientById = Object.fromEntries(Object.values(byFile).map(p => [p.id, p]));
  const existingKeys = new Set();
  visits.forEach(v => {
    if (v.importKey) existingKeys.add(v.importKey);
    else if (v.importedFrom === 'legacy-sheet' && patientById[v.patientId]) existingKeys.add(`${num(patientById[v.patientId].fileNumber)}|${v.date}|${v.total}|${v.paid}|${v.remaining}`);
  });

  const serviceByName = {}; services.forEach(s => { serviceByName[String(s.name).trim().toLowerCase()] = s.id; });
  const doctorSet = new Set(doctors.map(d => String(d.name).trim().toLowerCase()));
  let importCat = cats.find(c => c.name === 'بيانات مستوردة');
  if (!importCat) { const id = await DB.add('serviceCategories', { name: 'بيانات مستوردة' }); importCat = { id, name: 'بيانات مستوردة' }; }

  const stats = { visits: 0, payments: 0, dupes: 0, cost: 0, paid: 0, remaining: 0 };
  const monthly = {};
  const now = new Date().toISOString();
  for (let i = 0; i < parsed.length; i++) {
    const x = parsed[i];
    if (!x) continue;
    const key = `${num(x.fileNumber)}|${x.date}|${x.cost}|${x.paid}|${x.remaining}`;
    if (existingKeys.has(key)) { stats.dupes++; continue; }
    const isPayoff = x.cost === 0 && x.paid > 0;
    const serviceName = x.service || (isPayoff ? 'سداد مبلغ مستحق' : 'خدمة (بيانات مستوردة)');
    let serviceId = serviceByName[serviceName.toLowerCase()];
    if (!serviceId) { serviceId = await DB.add('services', { name: serviceName, categoryId: importCat.id, active: true, notes: 'مستوردة تلقائيًا' }); serviceByName[serviceName.toLowerCase()] = serviceId; }
    if (x.doctor && !doctorSet.has(x.doctor.toLowerCase())) { await DB.add('doctors', { name: x.doctor, active: true }); doctorSet.add(x.doctor.toLowerCase()); }
    const patientId = byFile[x.fileNumber].id;
    const visitId = await DB.add('visits', {
      patientId, appointmentId: null, date: x.date, visitType: x.service || (isPayoff ? 'سداد مبلغ مستحق' : 'زيارة مستوردة'),
      diagnosis: '', doctorNotes: '', doctorName: x.doctor, discountType: 'fixed', discountValue: 0,
      subtotal: x.cost, total: x.cost, paid: x.paid, remaining: x.remaining, createdAt: now, isDeleted: false,
      importedFrom: 'legacy-sheet', importKey: key,
    });
    await DB.add('visitServices', { visitId, serviceId, serviceName, tooth: '', price: x.cost, qty: 1 });
    stats.visits++;
    if (x.paid > 0) {
      await DB.add('payments', { patientId, visitId, date: x.date, amount: x.paid, method: 'غير محدد', notes: 'مستورد من الشيت القديم', createdAt: now });
      stats.payments++;
    }
    stats.cost += x.cost; stats.paid += x.paid; stats.remaining += x.remaining;
    const mk = x.date.slice(0, 7);
    monthly[mk] = monthly[mk] || { cost: 0, paid: 0 };
    monthly[mk].cost += x.cost; monthly[mk].paid += x.paid;
    if (i % 15 === 0) progress(overlay, `جاري الاستيراد... ${i + 1} / ${parsed.length}`);
  }
  if (maxNo > 0) {
    const c = counters || { key: 'counters', value: {} };
    c.value.patient = Math.max(c.value.patient || 0, maxNo);
    await DB.put('settings', c);
  }

  // مطابقة المديونية: مجموع المتبقي في البرنامج مقابل "إجمالي المديونية" في آخر صف لكل مريض بالشيت
  const allVisits = (await DB.all('visits')).filter(v => !v.isDeleted);
  const debtByPatient = {};
  allVisits.forEach(v => { debtByPatient[v.patientId] = (debtByPatient[v.patientId] || 0) + Number(v.remaining || 0); });
  const mismatches = [];
  let compared = 0;
  Object.entries(info).forEach(([fileNumber, p]) => {
    if (p.lastDebt === null) return;
    compared++;
    const appDebt = debtByPatient[byFile[fileNumber].id] || 0;
    if (Math.abs(appDebt - p.lastDebt) > 0.5) mismatches.push({ fileNumber, name: p.name, sheet: p.lastDebt, app: appDebt });
  });

  const mismatchHTML = compared === 0 ? '' : (mismatches.length === 0
    ? `<p style="color:var(--good)"><b>✅ المديونية مطابقة لشيتك لكل المرضى (${compared} مريض).</b></p>`
    : `<div class="error-box" style="margin:10px 0">فيه ${mismatches.length} مريض من ${compared} مديونيتهم في البرنامج مختلفة عن عمود "إجمالي المديونية" في شيتك. الفرق ده معناه إن الشيت نفسه فيه أرقام مش متسقة (إجمالي المديونية ≠ مجموع المتبقي في صفوفه). راجع الصفوف دي في شيتك:</div>
       <div class="table-wrap"><table class="table table-compact"><thead><tr><th>الملف</th><th>الاسم</th><th>في الشيت</th><th>في البرنامج</th></tr></thead>
       <tbody>${mismatches.slice(0, 25).map(m => `<tr><td>${m.fileNumber}</td><td>${U.esc(m.name)}</td><td>${U.money(m.sheet)}</td><td>${U.money(m.app)}</td></tr>`).join('')}</tbody></table></div>${mismatches.length > 25 ? '<p class="muted-sm">(أول 25 بس — الباقي في تقرير Excel)</p>' : ''}`);
  showImportResult(overlay, `
    <div class="summary-cards">
      ${statCard('مرضى جدد', patientsCreated)}${statCard('مرضى اتكمّل رقم هاتفهم', patientsUpdated)}
      ${statCard('زيارات اتسجلت', stats.visits)}${statCard('دفعات اتسجلت', stats.payments)}
      ${statCard('صفوف اتخطّت (مستوردة قبل كده)', stats.dupes)}${statCard('صفوف ناقصة (بدون رقم ملف/اسم)', skipped, skipped)}
      ${statCard('تواريخ مش مفهومة (استُخدم تاريخ اليوم)', dateFailures, dateFailures)}
    </div>
    <div class="summary-cards">
      ${statCard('إجمالي التكلفة المستوردة', U.money(stats.cost))}${statCard('إجمالي المدفوع المستورد', U.money(stats.paid))}${statCard('صافي المتبقي المستورد', U.money(stats.remaining))}
    </div>
    <h4>المدفوع شهريًا (قارنه بتبويب الدخل الشهري في شيتك)</h4>
    ${monthTable(monthly, [{ key: 'cost', label: 'التكلفة' }, { key: 'paid', label: 'المدفوع' }])}
    <h4>مطابقة المديونية</h4>${mismatchHTML}`,
    [
      { name: 'شهري', rows: Object.keys(monthly).sort().map(k => ({ 'الشهر': k, 'التكلفة': monthly[k].cost, 'المدفوع': monthly[k].paid })) },
      { name: 'فروق المديونية', rows: mismatches.map(m => ({ 'رقم الملف': m.fileNumber, 'الاسم': m.name, 'في الشيت': m.sheet, 'في البرنامج': m.app })) },
    ]);
}

/* ---------- 2) المصروفات ---------- */
async function runImportExpenses(overlay) {
  const { rows, mapping, dateOrder } = importState;
  const today = U.todayISO();
  const [cats, expenses] = await Promise.all([DB.all('expenseCategories'), DB.all('expenses')]);
  const catByName = {}; cats.forEach(c => { catByName[String(c.name).trim().toLowerCase()] = c.id; });
  const existingKeys = new Set(expenses.filter(e => e.importKey).map(e => e.importKey));
  let imported = 0, dupes = 0, skipped = 0, dateFailures = 0, total = 0;
  const monthly = {}, byCat = {};
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const amount = parseImportNumber(pickCell(r, mapping.amount));
    if (!amount) { skipped++; continue; }
    let date = parseImportDate(pickCell(r, mapping.date), dateOrder);
    if (!date) { dateFailures++; date = today; }
    const description = String(pickCell(r, mapping.description)).trim();
    const catName = String(pickCell(r, mapping.category)).trim() || 'أخرى';
    const key = `${date}|${amount}|${description}|${catName}`;
    if (existingKeys.has(key)) { dupes++; continue; }
    let catId = catByName[catName.toLowerCase()];
    if (!catId) { catId = await DB.add('expenseCategories', { name: catName }); catByName[catName.toLowerCase()] = catId; }
    const method = String(pickCell(r, mapping.method)).trim() || 'غير محدد';
    await DB.add('expenses', {
      date, categoryId: catId, description, amount, method, notes: String(pickCell(r, mapping.notes)).trim(),
      isPaid: true, paidDate: date, importedFrom: 'legacy-sheet', importKey: key,
    });
    imported++; total += amount;
    const mk = date.slice(0, 7); monthly[mk] = monthly[mk] || { amount: 0 }; monthly[mk].amount += amount;
    byCat[catName] = (byCat[catName] || 0) + amount;
    if (i % 15 === 0) progress(overlay, `جاري الاستيراد... ${i + 1} / ${rows.length}`);
  }
  showImportResult(overlay, `
    <div class="summary-cards">
      ${statCard('مصروفات اتسجلت', imported)}${statCard('إجمالي المصروفات المستوردة', U.money(total))}
      ${statCard('صفوف اتخطّت (مستوردة قبل كده)', dupes)}${statCard('صفوف بدون مبلغ', skipped)}
      ${statCard('تواريخ مش مفهومة (استُخدم تاريخ اليوم)', dateFailures, dateFailures)}
    </div>
    <h4>المصروفات شهريًا (قارنها بتبويب المصروفات الشهرية في شيتك)</h4>${monthTable(monthly, [{ key: 'amount', label: 'الإجمالي' }])}
    <h4>حسب النوع</h4>
    <div class="table-wrap"><table class="table table-compact"><tbody>${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${U.esc(k)}</td><td>${U.money(v)}</td></tr>`).join('')}</tbody></table></div>`,
    [{ name: 'شهري', rows: Object.keys(monthly).sort().map(k => ({ 'الشهر': k, 'الإجمالي': monthly[k].amount })) },
     { name: 'حسب النوع', rows: Object.entries(byCat).map(([k, v]) => ({ 'النوع': k, 'الإجمالي': v })) }]);
}

/* ---------- 3) بيانات المرضى التفصيلية ---------- */
async function runImportPatients(overlay) {
  const { rows, mapping, dateOrder } = importState;
  const [patients, sources, counters] = await Promise.all([DB.all('patients'), DB.all('patientSources'), DB.get('settings', 'counters')]);
  const byFile = Object.fromEntries(patients.map(p => [p.fileNumber, p]));
  const sourceSet = new Set(sources.map(s => String(s.name).trim().toLowerCase()));
  const normGender = (g) => { const s = String(g).trim().toLowerCase(); if (/^(m|male|ذكر|دكر)$/.test(s)) return 'ذكر'; if (/^(f|female|أنثى|انثى|بنت|سيدة)$/.test(s)) return 'أنثى'; return ''; };
  let created = 0, updated = 0, skipped = 0, maxNo = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rawFileNo = String(pickCell(r, mapping.fileNo) ?? '').trim();
    const name = String(pickCell(r, mapping.patientName)).trim();
    if (!rawFileNo || !name) { skipped++; continue; }
    const nm = rawFileNo.match(/\d+/);
    if (nm) maxNo = Math.max(maxNo, parseInt(nm[0], 10));
    const fileNumber = nm ? formatSeq('P', parseInt(nm[0], 10)) : `P-${rawFileNo}`;
    const data = {
      phone: cleanPhone(pickCell(r, mapping.phone)), altPhone: cleanPhone(pickCell(r, mapping.altPhone)),
      dob: (mapping.dob >= 0 && parseImportDate(pickCell(r, mapping.dob), dateOrder)) || '',
      gender: mapping.gender >= 0 ? normGender(pickCell(r, mapping.gender)) : '',
      address: String(pickCell(r, mapping.address)).trim(), source: String(pickCell(r, mapping.source)).trim(), notes: String(pickCell(r, mapping.notes)).trim(),
    };
    if (data.source && !sourceSet.has(data.source.toLowerCase())) { await DB.add('patientSources', { name: data.source }); sourceSet.add(data.source.toLowerCase()); }
    const ex = byFile[fileNumber];
    if (ex) {
      const upd = {};
      if (!ex.fullName) upd.fullName = name;
      Object.keys(data).forEach(k => { if (data[k] && !ex[k]) upd[k] = data[k]; });
      if (Object.keys(upd).length) { await DB.put('patients', { ...ex, ...upd }); updated++; }
    } else {
      const id = await DB.add('patients', { fileNumber, fullName: name, ...data, source: data.source || 'أخرى', createdAt: '', isDeleted: false });
      byFile[fileNumber] = { id, fileNumber, fullName: name };
      created++;
    }
    if (i % 15 === 0) progress(overlay, `جاري الاستيراد... ${i + 1} / ${rows.length}`);
  }
  if (maxNo > 0) { const c = counters || { key: 'counters', value: {} }; c.value.patient = Math.max(c.value.patient || 0, maxNo); await DB.put('settings', c); }
  showImportResult(overlay, `
    <div class="summary-cards">
      ${statCard('مرضى جدد', created)}${statCard('مرضى اتكملت بياناتهم', updated)}${statCard('صفوف ناقصة (بدون رقم ملف/اسم)', skipped, skipped)}
    </div>
    <p class="muted">البيانات الموجودة بالفعل عند المريض ما اتغيّرتش، اتضاف بس اللي كان فاضي.</p>`, null);
}

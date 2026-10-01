/* =========================================================
   import.js — استيراد بيانات من شيت إكسل/CSV قديم
   يوزّع الصفوف تلقائيًا على المرضى والزيارات والمدفوعات
   ========================================================= */

const IMPORT_FIELDS = [
  { key: 'date', label: 'التاريخ', required: true, keywords: ['date', 'تاريخ'] },
  { key: 'fileNo', label: 'رقم الملف', required: true, keywords: ['file no', 'رقم الملف', 'file'] },
  { key: 'patientName', label: 'اسم المريض', required: true, keywords: ['patient name', 'اسم المريض', 'name'] },
  { key: 'phone', label: 'رقم الهاتف', required: false, keywords: ['phone', 'هاتف', 'موبايل'] },
  { key: 'serviceType', label: 'نوع الخدمة', required: false, keywords: ['service type', 'نوع الخدمة'] },
  { key: 'serviceCost', label: 'تكلفة الخدمة', required: false, keywords: ['service cost', 'تكلفة الخدمة', 'cost'] },
  { key: 'paid', label: 'المدفوع', required: false, keywords: ['paid', 'مدفوع'] },
  { key: 'doctor', label: 'دكتور الشيفت', required: false, keywords: ['doctor', 'دكتور', 'shift'] },
  { key: 'remaining', label: 'المتبقي', required: false, keywords: ['remaining', 'متبقي'] },
];

let importState = null;

function openImportWizard() {
  importState = { file: null, workbook: null, sheetName: null, headers: [], rows: [], mapping: {} };
  const overlay = U.openModal('استيراد بيانات من شيت قديم', renderImportStage0(), '', { wide: true });
  bindImportStage0(overlay);
}

function renderImportStage0() {
  return `
    <p>اختر ملف Excel (.xlsx) أو CSV يحتوي على بيانات المرضى والزيارات القديمة.</p>
    <input type="file" id="import-file-input" accept=".xlsx,.xls,.csv">
    <div id="import-sheet-picker" style="margin-top:14px"></div>
    <div id="import-file-status" class="muted-sm" style="margin-top:8px"></div>
  `;
}

function bindImportStage0(overlay) {
  const fileInput = overlay.querySelector('#import-file-input');
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    importState.file = file;
    const status = overlay.querySelector('#import-file-status');
    status.textContent = 'جاري قراءة الملف...';
    try {
      let workbook;
      if (file.name.toLowerCase().endsWith('.csv')) {
        const text = await file.text();
        workbook = XLSX.read(text, { type: 'string' });
      } else {
        const buf = await file.arrayBuffer();
        workbook = XLSX.read(buf, { type: 'array', cellDates: true });
      }
      importState.workbook = workbook;
      status.textContent = `تم تحميل الملف — عدد الصفحات (Sheets): ${workbook.SheetNames.length}`;
      const picker = overlay.querySelector('#import-sheet-picker');
      if (workbook.SheetNames.length > 1) {
        // خمّن الشيت الأقرب لسجل الزيارات (اسمه يحتوي على "Patient" مثلاً)
        const guessIdx = workbook.SheetNames.findIndex(n => /patient/i.test(n) && !/database/i.test(n));
        picker.innerHTML = `
          <label>اختر الصفحة (Sheet) التي تحتوي على سجل الزيارات/المرضى
            <select id="import-sheet-select" class="input">
              ${workbook.SheetNames.map((n,i) => `<option value="${U.esc(n)}" ${i===(guessIdx>=0?guessIdx:0)?'selected':''}>${U.esc(n)}</option>`).join('')}
            </select>
          </label>
          <button class="btn btn-primary" id="import-next-1" style="margin-top:10px">التالي — مطابقة الأعمدة</button>`;
        picker.querySelector('#import-next-1').addEventListener('click', () => {
          importState.sheetName = picker.querySelector('#import-sheet-select').value;
          goToImportStage1(overlay);
        });
      } else {
        importState.sheetName = workbook.SheetNames[0];
        picker.innerHTML = `<button class="btn btn-primary" id="import-next-1">التالي — مطابقة الأعمدة</button>`;
        picker.querySelector('#import-next-1').addEventListener('click', () => goToImportStage1(overlay));
      }
    } catch (err) {
      status.textContent = 'تعذّرت قراءة الملف — تأكد أنه ملف Excel أو CSV صحيح.';
      console.error(err);
    }
  });
}

function goToImportStage1(overlay) {
  const ws = importState.workbook.Sheets[importState.sheetName];
  const rowsRaw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, dateNF: 'yyyy-mm-dd' });
  // أول صف غير فارغ يعتبر صف العناوين
  let headerRowIdx = rowsRaw.findIndex(r => r.some(c => String(c).trim() !== ''));
  if (headerRowIdx === -1) headerRowIdx = 0;
  const headers = rowsRaw[headerRowIdx].map(h => String(h).trim());
  const dataRows = rowsRaw.slice(headerRowIdx + 1).filter(r => r.some(c => String(c).trim() !== ''));
  importState.headers = headers;
  importState.rows = dataRows;

  // مطابقة تلقائية للأعمدة حسب الكلمات المفتاحية
  const mapping = {};
  IMPORT_FIELDS.forEach(f => {
    const idx = headers.findIndex(h => f.keywords.some(kw => h.toLowerCase().includes(kw.toLowerCase())));
    mapping[f.key] = idx;
  });
  importState.mapping = mapping;

  const modal = overlay.querySelector('.modal-body');
  modal.innerHTML = `
    <p>عدد الصفوف المكتشفة: <b>${dataRows.length}</b>. طابق كل حقل بالعمود المناسب من الملف (تم التخمين تلقائيًا، عدّل لو محتاج):</p>
    <div class="form-grid" id="import-mapping-form">
      ${IMPORT_FIELDS.map(f => `
        <label>${f.label}${f.required?' *':''}
          <select class="input" data-field="${f.key}">
            <option value="-1">${f.required ? '-- اختر عمود --' : '-- تجاهل هذا الحقل --'}</option>
            ${headers.map((h,i) => `<option value="${i}" ${mapping[f.key]===i?'selected':''}>${U.esc(h || `عمود ${i+1}`)}</option>`).join('')}
          </select>
        </label>`).join('')}
    </div>
    <div style="margin-top:16px"><button class="btn btn-primary" id="import-next-2">التالي — معاينة</button></div>
  `;
  modal.querySelector('#import-next-2').addEventListener('click', () => {
    const form = modal.querySelector('#import-mapping-form');
    let missingRequired = false;
    IMPORT_FIELDS.forEach(f => {
      const val = Number(form.querySelector(`[data-field="${f.key}"]`).value);
      importState.mapping[f.key] = val;
      if (f.required && val === -1) missingRequired = true;
    });
    if (missingRequired) { U.toast('لازم تحدد عمود لكل الحقول الأساسية (المعلّمة بـ *)', 'error'); return; }
    goToImportStage2(overlay);
  });
}

function pickCell(row, idx) { return idx === undefined || idx < 0 ? '' : (row[idx] ?? ''); }

/* تحويل جزء تاريخ (سنة/شهر/يوم) صحيح إلى نص ISO، مع رفض القيم غير المنطقية */
function isoFromParts(y, mo, d) {
  y = Number(y); mo = Number(mo); d = Number(d);
  if (!y || !mo || !d || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (y < 100) y += 2000; // سنة بصيغة رقمين مثل 25 -> 2025
  const mm = String(mo).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}
function isoFromLocalDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/* يحلل تاريخ الصف الفعلي من ملف Excel/CSV (وليس تاريخ الاستيراد) بأي صيغة شائعة:
   - كائن Date جاهز من SheetJS
   - رقم تسلسلي من إكسل (Excel serial date)
   - نص ISO: YYYY-MM-DD
   - نص DD/MM/YYYY أو MM/DD/YYYY (يفصل بينهم عند الغموض بافتراض DD/MM كالمعتاد محليًا،
     إلا إذا كان أحد الرقمين أكبر من 12 فهو اليوم قطعًا) */
function parseImportDate(val) {
  if (val === null || val === undefined || val === '') return null;

  if (val instanceof Date && !isNaN(val)) return isoFromLocalDate(val);

  const s = String(val).trim();
  if (!s) return null;

  // YYYY-MM-DD (أو مع وقت زيادة بعدها)
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return isoFromParts(m[1], m[2], m[3]);

  // DD/MM/YYYY أو MM/DD/YYYY أو بفواصل - أو .
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) {
    let a = Number(m[1]), b = Number(m[2]), y = Number(m[3]);
    let day, month;
    if (a > 12 && b <= 12) { day = a; month = b; }        // لازم يكون DD/MM
    else if (b > 12 && a <= 12) { day = b; month = a; }   // لازم يكون MM/DD
    else { day = a; month = b; }                           // غامض -> نفترض DD/MM (المعتاد محليًا)
    return isoFromParts(y, month, day);
  }

  // رقم تسلسلي من إكسل (Excel serial date)
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = parseFloat(s);
    if (serial > 20000 && serial < 80000) {
      const utcDays = Math.floor(serial - 25569); // فرق الأيام بين تقويم إكسل (1900) ويونكس (1970)
      const d = new Date(utcDays * 86400 * 1000);
      return isoFromParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
  }

  // آخر محاولة: نسيب المتصفح يحاول يفهمها (مثال: "October 10, 2025")
  const d = new Date(s);
  if (!isNaN(d)) return isoFromLocalDate(d);

  return null;
}
function parseImportNumber(val) {
  if (val === '' || val === undefined || val === null) return 0;
  const s = String(val).trim().replace(/,/g, '');
  if (s === '-' || s === '//' || s === '') return 0;
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function goToImportStage2(overlay) {
  const { rows, mapping } = importState;
  const preview = rows.slice(0, 8).map(r => ({
    date: parseImportDate(pickCell(r, mapping.date)) || '—',
    fileNo: String(pickCell(r, mapping.fileNo) || '—'),
    name: pickCell(r, mapping.patientName) || '—',
    service: pickCell(r, mapping.serviceType) || '(غير محدد)',
    cost: parseImportNumber(pickCell(r, mapping.serviceCost)),
    paid: parseImportNumber(pickCell(r, mapping.paid)),
  }));
  const modal = overlay.querySelector('.modal-body');
  modal.innerHTML = `
    <p>معاينة أول ${preview.length} صف من إجمالي ${rows.length} صف (الاستيراد سيضيف بيانات جديدة ولن يمسح أي شيء موجود):</p>
    <div class="table-wrap"><table class="table table-compact">
      <thead><tr><th>التاريخ</th><th>رقم الملف</th><th>الاسم</th><th>الخدمة</th><th>التكلفة</th><th>المدفوع</th></tr></thead>
      <tbody>${preview.map(r => `<tr><td>${U.esc(r.date)}</td><td>${U.esc(r.fileNo)}</td><td>${U.esc(r.name)}</td><td>${U.esc(r.service)}</td><td>${r.cost}</td><td>${r.paid}</td></tr>`).join('')}</tbody>
    </table></div>
    <div style="margin-top:16px;display:flex;gap:10px">
      <button class="btn btn-secondary" data-close>إلغاء</button>
      <button class="btn btn-primary" id="import-confirm-btn">استيراد ${rows.length} صف الآن</button>
    </div>
    <div id="import-progress" class="muted-sm" style="margin-top:10px"></div>
  `;
  modal.querySelector('#import-confirm-btn').addEventListener('click', () => runImport(overlay));
}

async function runImport(overlay) {
  const progressEl = overlay.querySelector('#import-progress');
  const confirmBtn = overlay.querySelector('#import-confirm-btn');
  confirmBtn.disabled = true;
  const { rows, mapping } = importState;

  const [existingPatients, existingServices, existingDoctors, existingCats, counters] = await Promise.all([
    DB.all('patients'), DB.all('services'), DB.all('doctors'), DB.all('serviceCategories'), DB.get('settings', 'counters'),
  ]);
  const patientByFileNo = {}; // legacy fileNo string -> patientId
  existingPatients.forEach(p => { patientByFileNo[String(p.fileNumber).replace(/^P-0*/,'')] = p.id; patientByFileNo[p.fileNumber] = p.id; });
  const serviceByName = {}; existingServices.forEach(s => serviceByName[s.name.trim().toLowerCase()] = s.id);
  const doctorByName = {}; existingDoctors.forEach(d => doctorByName[d.name.trim().toLowerCase()] = d.name);
  let importCat = existingCats.find(c => c.name === 'بيانات مستوردة');
  if (!importCat) { const id = await DB.add('serviceCategories', { name: 'بيانات مستوردة' }); importCat = { id, name: 'بيانات مستوردة' }; }

  let patientsCreated = 0, visitsCreated = 0, paymentsCreated = 0, skipped = 0, dateParseFailures = 0;
  let maxNumericFileNo = 0;
  const now = new Date().toISOString();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rawFileNo = String(pickCell(r, mapping.fileNo) || '').trim();
    const name = String(pickCell(r, mapping.patientName) || '').trim();
    let date = parseImportDate(pickCell(r, mapping.date));
    if (!date) { dateParseFailures++; date = U.todayISO(); }
    if (!rawFileNo || !name) { skipped++; continue; }

    const numMatch = rawFileNo.match(/\d+/);
    if (numMatch) maxNumericFileNo = Math.max(maxNumericFileNo, parseInt(numMatch[0], 10));

    let patientId = patientByFileNo[rawFileNo];
    if (!patientId) {
      let phone = String(pickCell(r, mapping.phone) || '').trim();
      if (phone === '//' || phone === '-') phone = '';
      const fileNumber = numMatch ? formatSeq('P', parseInt(numMatch[0], 10)) : `P-${rawFileNo}`;
      patientId = await DB.add('patients', {
        fileNumber, fullName: name, phone, altPhone: '', dob: '', gender: '', address: '',
        source: 'أخرى', notes: 'تم الاستيراد من شيت قديم', createdAt: date, isDeleted: false,
      });
      patientByFileNo[rawFileNo] = patientId;
      patientsCreated++;
    }

    const serviceTypeText = String(pickCell(r, mapping.serviceType) || '').trim();
    const serviceName = serviceTypeText || 'خدمة (بيانات مستوردة)';
    let serviceId = serviceByName[serviceName.toLowerCase()];
    if (!serviceId) {
      serviceId = await DB.add('services', { name: serviceName, categoryId: importCat.id, active: true, notes: 'مستوردة تلقائيًا' });
      serviceByName[serviceName.toLowerCase()] = serviceId;
    }

    const cost = parseImportNumber(pickCell(r, mapping.serviceCost));
    const paid = parseImportNumber(pickCell(r, mapping.paid));
    const remainingRaw = mapping.remaining >= 0 ? pickCell(r, mapping.remaining) : '';
    const remaining = remainingRaw !== '' ? parseImportNumber(remainingRaw) : Math.max(0, cost - paid);
    const doctorName = String(pickCell(r, mapping.doctor) || '').trim();

    const visitId = await DB.add('visits', {
      patientId, appointmentId: null, date, visitType: serviceTypeText || 'زيارة مستوردة',
      diagnosis: '', doctorNotes: '', doctorName,
      discountType: 'fixed', discountValue: 0,
      subtotal: cost, total: cost, paid, remaining,
      createdAt: now, isDeleted: false, importedFrom: 'legacy-sheet',
    });
    await DB.add('visitServices', { visitId, serviceId, serviceName, tooth: '', price: cost, qty: 1 });
    visitsCreated++;
    if (paid > 0) {
      await DB.add('payments', { patientId, visitId, date, amount: paid, method: 'غير محدد', notes: 'مستورد من الشيت القديم', createdAt: now });
      paymentsCreated++;
    }

    if (i % 10 === 0) progressEl.textContent = `جاري الاستيراد... ${i+1} / ${rows.length}`;
  }

  if (maxNumericFileNo > 0) {
    const c = counters || { key: 'counters', value: {} };
    c.value.patient = Math.max(c.value.patient || 0, maxNumericFileNo);
    await DB.put('settings', c);
  }

  overlay.querySelector('.modal-body').innerHTML = `
    <div class="summary-cards">
      <div class="stat-card"><div class="stat-label">مرضى جدد تم إنشاؤهم</div><div class="stat-value">${patientsCreated}</div></div>
      <div class="stat-card"><div class="stat-label">زيارات تم إنشاؤها</div><div class="stat-value">${visitsCreated}</div></div>
      <div class="stat-card"><div class="stat-label">دفعات تم تسجيلها</div><div class="stat-value">${paymentsCreated}</div></div>
      <div class="stat-card"><div class="stat-label">صفوف تم تجاهلها (بيانات ناقصة)</div><div class="stat-value ${skipped?'stat-bad':''}">${skipped}</div></div>
      <div class="stat-card"><div class="stat-label">صفوف بتاريخ غير مفهوم (استُخدم تاريخ اليوم مؤقتًا)</div><div class="stat-value ${dateParseFailures?'stat-bad':''}">${dateParseFailures}</div></div>
    </div>
    <p class="muted">تم الاستيراد بنجاح — كل صف اتسجل بتاريخه الأصلي من الملف (شهره وسنته الحقيقية)، مش بتاريخ النهاردة.${dateParseFailures ? ' راجع الصفوف اللي تاريخها كان غير واضح من شاشة "الزيارات" وصحّح تاريخها يدويًا لو لزم.' : ''}</p>
    <button class="btn btn-primary" id="import-done-btn">تم</button>
  `;
  U.toast('اكتمل الاستيراد بنجاح');
  overlay.querySelector('#import-done-btn').addEventListener('click', () => {
    overlay.remove();
    route();
  });
}

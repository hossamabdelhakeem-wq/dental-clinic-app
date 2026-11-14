/* =========================================================
   doctors.js — نسب ومستحقات الأطباء
   - الشيفت = يوم عمل الدكتور (كل حالات الدكتور في نفس التاريخ).
   - دخل الحالة = المحصّل منها (المدفوع) — من غير خصم تكلفة المعمل.
   - نسبة الدكتور بتتخزّن على كل حالة وقت تسجيلها (doctorPercent)، فتعديل النسبة بعد كده ما بيغيّرش القديم.
   - مدفوعات الدكتور بتتسجل كمصروف (doctorName + doctorMonth) فبتدخل في حسابات الأرباح تلقائيًا.
   ========================================================= */
const DOCTOR_PAYOUT_CATEGORY = 'مستحقات الأطباء';
const trimName = (s) => String(s || '').trim();
const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
let DOCSTATE = { month: null, doctor: null };

async function doctorPercentFor(name) {
  const n = trimName(name); if (!n) return undefined;
  const d = (await DB.all('doctors')).find(x => trimName(x.name) === n);
  return d && typeof d.percent === 'number' ? d.percent : undefined;
}
/* أول مرة تتحدد نسبة موجبة لدكتور: حالاته القديمة (من غير نسبة محفوظة) بتاخد النسبة دي وتتثبّت */
async function onDoctorPercentSet(doctor, oldValue) {
  const pct = Number(doctor.percent);
  if (!(pct > 0) || (oldValue !== undefined && oldValue !== null && Number(oldValue) > 0)) return;
  const name = trimName(doctor.name);
  for (const v of await DB.all('visits')) {
    if (trimName(v.doctorName) === name && typeof v.doctorPercent !== 'number') await DB.put('visits', { ...v, doctorPercent: pct });
  }
}

async function computeDoctorMonth(month) {
  const [doctors, visits, vsv, patients, expenses] = await Promise.all([DB.all('doctors'), DB.all('visits'), DB.all('visitServices'), DB.all('patients'), DB.all('expenses')]);
  const patName = Object.fromEntries(patients.map(p => [p.id, p.fullName]));
  const svc = {}; vsv.forEach(l => { (svc[l.visitId] = svc[l.visitId] || []).push(l.serviceName); });
  const byDoc = {};
  const ensure = (name) => byDoc[name] || (byDoc[name] = { name, percent: (doctors.find(d => trimName(d.name) === name) || {}).percent, cases: [], shifts: [], payouts: [], income: 0, due: 0, paid: 0, remaining: 0, provisional: false });
  doctors.forEach(d => ensure(trimName(d.name)));
  const seen = new Set(); const noDoctor = { count: 0, income: 0 };
  visits.filter(v => !v.isDeleted && String(v.date || '').slice(0, 7) === month).forEach(v => {
    if (seen.has(v.id)) return; seen.add(v.id); // كل حالة بتتحسب مرة واحدة بس
    const name = trimName(v.doctorName), income = Number(v.paid || 0);
    if (!name) { noDoctor.count++; noDoctor.income += income; return; }
    const doc = ensure(name);
    const provisional = typeof v.doctorPercent !== 'number';
    const pct = provisional ? Number(doc.percent || 0) : v.doctorPercent;
    if (provisional) doc.provisional = true;
    doc.cases.push({ id: v.id, date: v.date, patient: patName[v.patientId] || '', service: (svc[v.id] || []).join('، ') || v.visitType || '', value: Number(v.total || 0), income, pct, share: income * pct / 100, provisional });
  });
  expenses.filter(e => e.doctorName && e.doctorMonth === month && e.isPaid !== false).forEach(e => ensure(trimName(e.doctorName)).payouts.push(e));
  Object.values(byDoc).forEach(d => {
    d.cases.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    const sh = {};
    d.cases.forEach(c => { const s = sh[c.date] || (sh[c.date] = { date: c.date, count: 0, income: 0, share: 0, pcts: new Set() }); s.count++; s.income += c.income; s.share += c.share; s.pcts.add(c.pct); });
    d.shifts = Object.values(sh).sort((a, b) => a.date.localeCompare(b.date)).map(s => ({ ...s, income: r2(s.income), share: r2(s.share), pct: s.pcts.size === 1 ? [...s.pcts][0] : null }));
    d.income = r2(d.cases.reduce((s, c) => s + c.income, 0));
    d.due = r2(d.shifts.reduce((s, x) => s + x.share, 0));
    d.paid = r2(d.payouts.reduce((s, e) => s + Number(e.amount || 0), 0));
    d.remaining = r2(d.due - d.paid);
  });
  return { docs: Object.values(byDoc).sort((a, b) => a.name.localeCompare(b.name, 'ar')), noDoctor };
}

const monthLabelOf = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' }); };
const pctText = (p) => (p === null || p === undefined ? 'متعددة' : `${p}%`);

Views.doctors = async function(main) {
  if (!DOCSTATE.month) DOCSTATE.month = U.todayISO().slice(0, 7);
  const month = DOCSTATE.month;
  const { docs, noDoctor } = await computeDoctorMonth(month);
  const clinic = (APP_STATE.clinicInfo && APP_STATE.clinicInfo.name) || 'العيادة';
  const monthInput = `<input type="month" id="doc-month" class="input" value="${month}">`;
  const wireMonth = () => { const mi = main.querySelector('#doc-month'); if (mi) mi.addEventListener('change', () => { if (mi.value) { DOCSTATE.month = mi.value; Views.doctors(main); } }); };
  const doc = DOCSTATE.doctor ? docs.find(d => d.name === DOCSTATE.doctor) : null;

  if (!doc) {
    DOCSTATE.doctor = null;
    const tot = docs.reduce((a, d) => ({ due: a.due + d.due, paid: a.paid + d.paid }), { due: 0, paid: 0 });
    main.innerHTML = `
      <div class="page-header"><h2>حسابات الأطباء</h2><div class="page-actions">${monthInput}</div></div>
      <div class="summary-cards cols-3">
        <div class="stat-card kpi kpi-net"><div class="stat-ico">🩺</div><div class="stat-label">إجمالي المستحق (${monthLabelOf(month)})</div><div class="stat-value">${U.money(tot.due)}</div></div>
        <div class="stat-card kpi kpi-good"><div class="stat-ico">✅</div><div class="stat-label">المدفوع للأطباء</div><div class="stat-value stat-good">${U.money(tot.paid)}</div></div>
        <div class="stat-card kpi kpi-bad"><div class="stat-ico">⏳</div><div class="stat-label">المتبقي</div><div class="stat-value stat-bad">${U.money(r2(tot.due - tot.paid))}</div></div>
      </div>
      ${noDoctor.count ? `<div class="error-box" style="margin-bottom:14px">فيه ${noDoctor.count} حالة في الشهر ده من غير دكتور (محصّل ${U.money(noDoctor.income)}) ومش محسوبة لأي دكتور. حدد الدكتور من "تعديل الزيارة".</div>` : ''}
      <div class="card">
        <p class="muted-sm" style="margin-top:0">المستحق = المحصّل من حالات الدكتور × نسبته المحفوظة وقت تسجيل الحالة، من غير خصم تكلفة المعمل. الشيفت = يوم عمل الدكتور.</p>
        <div class="table-wrap"><table class="table"><thead><tr><th>الدكتور</th><th>النسبة الحالية</th><th>الحالات</th><th>الدخل (المحصّل)</th><th>مستحق الشهر</th><th>المدفوع</th><th>المتبقي</th><th></th></tr></thead>
        <tbody>${docs.map(d => `<tr>
          <td><b>${U.esc(d.name)}</b></td><td>${typeof d.percent === 'number' ? d.percent + '%' : '<span class="text-bad">غير محددة</span>'}</td><td>${d.cases.length}</td>
          <td>${U.money(d.income)}</td><td>${U.money(d.due)}${d.provisional ? ' *' : ''}</td><td>${U.money(d.paid)}</td><td class="${d.remaining > 0 ? 'text-bad' : ''}">${U.money(d.remaining)}</td>
          <td style="white-space:nowrap"><button class="btn btn-sm btn-primary" data-doc-stmt="${U.esc(d.name)}">كشف الحساب</button> <button class="btn btn-sm" data-doc-pay="${U.esc(d.name)}">تسجيل دفعة</button></td></tr>`).join('') || '<tr><td colspan="8" class="empty-cell">أضف الأطباء ونسبهم من الإعدادات ← الأطباء</td></tr>'}</tbody></table></div>
        ${docs.some(d => d.provisional) ? '<p class="muted-sm">* فيه حالات قديمة بدون نسبة محفوظة اتحسبت بالنسبة الحالية للدكتور.</p>' : ''}
      </div>`;
    wireMonth();
    main.querySelectorAll('[data-doc-stmt]').forEach(b => b.addEventListener('click', () => { DOCSTATE.doctor = b.dataset.docStmt; Views.doctors(main); }));
    main.querySelectorAll('[data-doc-pay]').forEach(b => b.addEventListener('click', () => openDoctorPayoutModal(docs.find(d => d.name === b.dataset.docPay), month, () => Views.doctors(main))));
    return;
  }

  main.innerHTML = `
    <div class="page-header"><h2>كشف حساب د. ${U.esc(doc.name)} <span class="count-badge">${monthLabelOf(month)}</span></h2>
      <div class="page-actions">${monthInput}<button class="btn" id="doc-back">‹ كل الأطباء</button><button class="btn btn-primary" id="doc-pay">تسجيل دفعة</button><button class="btn" id="doc-print">طباعة</button><button class="btn" id="doc-export">تصدير Excel</button></div></div>
    <div class="summary-cards">
      <div class="stat-card"><div class="stat-label">النسبة الحالية</div><div class="stat-value">${typeof doc.percent === 'number' ? doc.percent + '%' : 'غير محددة'}</div></div>
      <div class="stat-card"><div class="stat-label">دخل الشهر (المحصّل)</div><div class="stat-value">${U.money(doc.income)}</div></div>
      <div class="stat-card"><div class="stat-label">مستحق الشهر</div><div class="stat-value">${U.money(doc.due)}</div></div>
      <div class="stat-card"><div class="stat-label">المدفوع</div><div class="stat-value stat-good">${U.money(doc.paid)}</div></div>
      <div class="stat-card"><div class="stat-label">المتبقي</div><div class="stat-value ${doc.remaining > 0 ? 'stat-bad' : ''}">${U.money(doc.remaining)}</div></div>
    </div>
    <div class="card"><h3>الشيفتات</h3><div class="table-wrap"><table class="table"><thead><tr><th>التاريخ</th><th>عدد الحالات</th><th>دخل الشيفت</th><th>النسبة</th><th>مستحق الشيفت</th></tr></thead>
      <tbody>${doc.shifts.map(s => `<tr><td>${U.fmtDate(s.date)}</td><td>${s.count}</td><td>${U.money(s.income)}</td><td>${pctText(s.pct)}</td><td><b>${U.money(s.share)}</b></td></tr>`).join('') || '<tr><td colspan="5" class="empty-cell">لا توجد حالات في هذا الشهر</td></tr>'}</tbody></table></div>
      <p class="muted-sm">إجمالي مستحقات الشهر = مجموع مستحقات الشيفتات = <b>${U.money(doc.due)}</b>. مفيش خصم لتكلفة المعمل.</p></div>
    <div class="card"><h3>تفاصيل الحالات</h3><div class="table-wrap"><table class="table table-compact"><thead><tr><th>التاريخ</th><th>المريض</th><th>الخدمة</th><th>قيمة الحالة</th><th>المحصّل</th><th>النسبة</th><th>المستحق</th></tr></thead>
      <tbody>${doc.cases.map(c => `<tr><td>${U.fmtDate(c.date)}</td><td>${U.esc(c.patient)}</td><td>${U.esc(c.service)}</td><td>${U.money(c.value)}</td><td>${U.money(c.income)}</td><td>${c.pct}%${c.provisional ? ' *' : ''}</td><td>${U.money(r2(c.share))}</td></tr>`).join('') || '<tr><td colspan="7" class="empty-cell">لا توجد حالات</td></tr>'}</tbody></table></div></div>
    <div class="card"><h3>المدفوعات للدكتور عن الشهر</h3><div class="table-wrap"><table class="table table-compact"><thead><tr><th>التاريخ</th><th>طريقة الدفع</th><th>ملاحظات</th><th>المبلغ</th></tr></thead>
      <tbody>${doc.payouts.map(e => `<tr><td>${U.fmtDate(e.paidDate || e.date)}</td><td>${U.esc(e.method || '')}</td><td>${U.esc(e.notes || '')}</td><td>${U.money(e.amount)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty-cell">لا توجد مدفوعات</td></tr>'}</tbody></table></div></div>`;
  wireMonth();
  main.querySelector('#doc-back').addEventListener('click', () => { DOCSTATE.doctor = null; Views.doctors(main); });
  main.querySelector('#doc-pay').addEventListener('click', () => openDoctorPayoutModal(doc, month, () => Views.doctors(main)));
  main.querySelector('#doc-export').addEventListener('click', () => U.exportToExcel([
    { name: 'الملخص', rows: [{ 'الدكتور': doc.name, 'الشهر': month, 'النسبة الحالية': doc.percent ?? '', 'الدخل (المحصّل)': doc.income, 'مستحق الشهر': doc.due, 'المدفوع': doc.paid, 'المتبقي': doc.remaining }] },
    { name: 'الشيفتات', rows: doc.shifts.map(s => ({ 'التاريخ': U.fmtDate(s.date), 'عدد الحالات': s.count, 'دخل الشيفت': s.income, 'النسبة': s.pct === null ? 'متعددة' : s.pct, 'مستحق الشيفت': s.share })) },
    { name: 'الحالات', rows: doc.cases.map(c => ({ 'التاريخ': U.fmtDate(c.date), 'المريض': c.patient, 'الخدمة': c.service, 'قيمة الحالة': c.value, 'المحصّل': c.income, 'النسبة': c.pct, 'المستحق': r2(c.share) })) },
    { name: 'المدفوعات', rows: doc.payouts.map(e => ({ 'التاريخ': U.fmtDate(e.paidDate || e.date), 'طريقة الدفع': e.method || '', 'ملاحظات': e.notes || '', 'المبلغ': e.amount })) },
  ], `كشف_حساب_${doc.name}_${month}.xlsx`));
  main.querySelector('#doc-print').addEventListener('click', () => U.printSection(`
    <div class="print-header"><h1>${U.esc(clinic)}</h1><div>كشف حساب د. ${U.esc(doc.name)} — ${monthLabelOf(month)}</div></div>
    <table class="print-table"><tr><td>النسبة</td><td>${typeof doc.percent === 'number' ? doc.percent + '%' : '—'}</td><td>دخل الشهر (المحصّل)</td><td>${U.money(doc.income)}</td></tr>
      <tr><td>مستحق الشهر</td><td>${U.money(doc.due)}</td><td>المدفوع / المتبقي</td><td>${U.money(doc.paid)} / ${U.money(doc.remaining)}</td></tr></table>
    <h3>الشيفتات</h3><table class="print-table"><tr><th>التاريخ</th><th>الحالات</th><th>دخل الشيفت</th><th>النسبة</th><th>مستحق الشيفت</th></tr>
      ${doc.shifts.map(s => `<tr><td>${U.fmtDate(s.date)}</td><td>${s.count}</td><td>${U.money(s.income)}</td><td>${pctText(s.pct)}</td><td>${U.money(s.share)}</td></tr>`).join('')}</table>
    <h3>تفاصيل الحالات</h3><table class="print-table"><tr><th>التاريخ</th><th>المريض</th><th>الخدمة</th><th>المحصّل</th><th>النسبة</th><th>المستحق</th></tr>
      ${doc.cases.map(c => `<tr><td>${U.fmtDate(c.date)}</td><td>${U.esc(c.patient)}</td><td>${U.esc(c.service)}</td><td>${U.money(c.income)}</td><td>${c.pct}%</td><td>${U.money(r2(c.share))}</td></tr>`).join('')}</table>
    <h3>المدفوعات</h3><table class="print-table"><tr><th>التاريخ</th><th>ملاحظات</th><th>المبلغ</th></tr>
      ${doc.payouts.map(e => `<tr><td>${U.fmtDate(e.paidDate || e.date)}</td><td>${U.esc(e.notes || '')}</td><td>${U.money(e.amount)}</td></tr>`).join('')}</table>
    <div class="print-footer">${U.esc(clinic)}</div>`, `كشف حساب ${doc.name}`));
};

async function openDoctorPayoutModal(doc, month, onSaved) {
  if (!doc) return;
  const methods = await DB.all('paymentMethods');
  const overlay = U.openModal(`تسجيل دفعة لـ د. ${doc.name}`, `
    <p class="muted-sm">المتبقي عن ${monthLabelOf(month)}: <b>${U.money(doc.remaining)}</b></p>
    <form id="payout-form" class="form-grid">
      <label>المبلغ *<input required type="number" name="amount" class="input" min="1" step="0.01"></label>
      <label>التاريخ<input type="date" name="date" class="input" value="${U.todayISO()}"></label>
      <label>عن شهر<input type="month" name="month" class="input" value="${month}"></label>
      <label>طريقة الدفع<select name="method" class="input">${methods.map(m => `<option>${U.esc(m.name)}</option>`).join('')}</select></label>
      <label class="span-2">ملاحظات<input name="notes" class="input"></label>
    </form>`, '<button class="btn btn-secondary" data-close>إلغاء</button><button class="btn btn-primary" id="payout-save">حفظ الدفعة</button>');
  overlay.querySelector('#payout-save').addEventListener('click', async () => {
    const f = overlay.querySelector('#payout-form'); if (!f.reportValidity()) return;
    const d = Object.fromEntries(new FormData(f).entries()); const amount = Number(d.amount);
    if (!(amount > 0) || !d.month) { U.toast('المبلغ والشهر مطلوبين', 'error'); return; }
    if (d.month === month && amount > doc.remaining + 0.005 && !(await U.confirm(`المبلغ (${U.money(amount)}) أكبر من المتبقي (${U.money(doc.remaining)}). متابعة؟`))) return;
    let cat = (await DB.all('expenseCategories')).find(c => c.name === DOCTOR_PAYOUT_CATEGORY);
    if (!cat) { const id = await DB.add('expenseCategories', { name: DOCTOR_PAYOUT_CATEGORY }); cat = { id }; }
    await DB.add('expenses', { date: d.date, categoryId: cat.id, description: `مستحقات د. ${doc.name} — ${d.month}`, amount, method: d.method, notes: d.notes || '',
      isPaid: true, paidDate: d.date, doctorName: doc.name, doctorMonth: d.month });
    U.toast('تم تسجيل الدفعة'); overlay.remove(); if (onSaved) onSaved();
  });
}

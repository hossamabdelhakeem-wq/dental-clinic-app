/* =========================================================
   patients.js — المرضى: القائمة، الملف الشخصي، الإضافة/التعديل
   ========================================================= */

Views.patients = async function(main, param) {
  if (param) return renderPatientProfile(main, Number(param));
  return renderPatientsList(main);
};

async function renderPatientsList(main) {
  const patients = (await DB.all('patients')).filter(p => !p.isDeleted).sort((a,b) => b.id - a.id);
  main.innerHTML = `
    <div class="page-header">
      <h2>المرضى <span class="count-badge">${patients.length}</span></h2>
      <div class="page-actions">
        <input type="text" id="patients-search" class="input" placeholder="بحث بالاسم / الملف / الموبايل" style="width:260px">
        <button class="btn btn-primary" id="btn-new-patient">+ إضافة مريض</button>
      </div>
    </div>
    <div class="table-wrap">
      <table class="table">
        <thead><tr>
          <th>رقم الملف</th><th>الاسم</th><th>الموبايل</th><th>النوع</th><th>المصدر</th><th>تاريخ التسجيل</th><th></th>
        </tr></thead>
        <tbody id="patients-tbody"></tbody>
      </table>
    </div>`;
  const tbody = main.querySelector('#patients-tbody');
  const renderRows = (list) => {
    tbody.innerHTML = list.map(p => `
      <tr class="row-click" data-href="#patients/${p.id}">
        <td>${U.esc(p.fileNumber)}</td>
        <td><b>${U.esc(p.fullName)}</b></td>
        <td>${U.esc(p.phone)}</td>
        <td>${U.esc(p.gender||'')}</td>
        <td>${U.esc(p.source||'')}</td>
        <td>${U.esc(U.fmtDate(p.createdAt?.slice(0,10)))}</td>
        <td style="white-space:nowrap">
          <a class="btn btn-sm" href="#patients/${p.id}">فتح</a>
          <button class="btn btn-sm" data-edit-patient="${p.id}">تعديل</button>
          <button class="btn btn-sm btn-danger" data-del-patient="${p.id}">حذف</button>
        </td>
      </tr>`).join('') || `<tr><td colspan="7" class="empty-cell">لا يوجد مرضى بعد</td></tr>`;
    tbody.querySelectorAll('.row-click').forEach(tr => tr.addEventListener('click', (e) => {
      if (e.target.closest('a,button')) return;
      goto(tr.dataset.href);
    }));
    tbody.querySelectorAll('[data-edit-patient]').forEach(b => b.addEventListener('click', () => {
      const p = patients.find(x => x.id === Number(b.dataset.editPatient));
      if (p) Views.openEditPatientModal(p, () => route());
    }));
    tbody.querySelectorAll('[data-del-patient]').forEach(b => b.addEventListener('click', () => {
      const p = patients.find(x => x.id === Number(b.dataset.delPatient));
      if (p) deletePatientFlow(p, () => route());
    }));
  };
  renderRows(patients);
  main.querySelector('#patients-search').addEventListener('input', U.debounce((e) => {
    const q = e.target.value.trim().toLowerCase();
    const filtered = !q ? patients : patients.filter(p =>
      p.fullName.toLowerCase().includes(q) || p.phone.includes(q) || p.fileNumber.toLowerCase().includes(q));
    renderRows(filtered);
  }, 150));
  main.querySelector('#btn-new-patient').addEventListener('click', () => Views.openNewPatientModal());
}

Views.openNewPatientModal = function(onSaved) {
  const sourcesPromise = DB.all('patientSources');
  sourcesPromise.then(sources => {
    const overlay = U.openModal('إضافة مريض جديد', `
      <form id="patient-form" class="form-grid">
        <label>الاسم بالكامل *<input required name="fullName" class="input"></label>
        <label>رقم الموبايل *<input required name="phone" class="input" placeholder="01xxxxxxxxx"></label>
        <label>رقم موبايل بديل<input name="altPhone" class="input"></label>
        <label>تاريخ الميلاد<input type="date" name="dob" class="input"></label>
        <label>تاريخ التسجيل<input type="date" name="createdAt" class="input" value="${U.todayISO()}"></label>
        <label>النوع
          <select name="gender" class="input">
            <option value="ذكر">ذكر</option><option value="أنثى">أنثى</option>
          </select>
        </label>
        <label>مصدر معرفة العيادة
          <select name="source" class="input">
            ${sources.map(s => `<option value="${U.esc(s.name)}">${U.esc(s.name)}</option>`).join('')}
          </select>
        </label>
        <label class="span-2">العنوان<input name="address" class="input"></label>
        <label class="span-2">ملاحظات<textarea name="notes" class="input" rows="2"></textarea></label>
      </form>`, `
      <button class="btn btn-secondary" data-close>إلغاء</button>
      <button class="btn btn-primary" id="save-patient-btn">حفظ</button>
    `);
    overlay.querySelector('#save-patient-btn').addEventListener('click', async () => {
      const form = overlay.querySelector('#patient-form');
      if (!form.reportValidity()) return;
      const data = Object.fromEntries(new FormData(form).entries());
      if (!(await checkPatientInput(data, null, null))) return;
      const fileNumber = await nextFileNumber();
      const id = await DB.add('patients', { ...data, fileNumber, createdAt: data.createdAt || U.todayISO(), isDeleted: false });
      U.toast(`تم إنشاء المريض برقم ملف ${fileNumber}`);
      overlay.remove();
      if (onSaved) onSaved(id);
      else {
        // اقتراح إجراء تالٍ سريع بدون الرجوع لشاشة أخرى
        offerNextActionAfterNewPatient(id, data.fullName);
      }
    });
  });
};

function offerNextActionAfterNewPatient(patientId, name) {
  const overlay = U.openModal(`تم إضافة ${U.esc(name)}`, `
    <p>ماذا تريد أن تفعل الآن؟</p>`, `
    <button class="btn btn-secondary" data-close>لاحقًا</button>
    <button class="btn btn-secondary" id="act-appt">حجز موعد</button>
    <button class="btn btn-primary" id="act-visit">تسجيل زيارة</button>
  `);
  overlay.querySelector('#act-visit').addEventListener('click', () => { overlay.remove(); Views.openNewVisitModal(patientId); });
  overlay.querySelector('#act-appt').addEventListener('click', () => { overlay.remove(); Views.openNewAppointmentModal(patientId); });
}

Views.openEditPatientModal = function(patient, onSaved) {
  DB.all('patientSources').then(sources => {
    const overlay = U.openModal('تعديل بيانات المريض', `
      <form id="patient-edit-form" class="form-grid">
        <label>الاسم بالكامل *<input required name="fullName" class="input" value="${U.esc(patient.fullName)}"></label>
        <label>رقم الموبايل *<input required name="phone" class="input" value="${U.esc(patient.phone)}"></label>
        <label>رقم موبايل بديل<input name="altPhone" class="input" value="${U.esc(patient.altPhone||'')}"></label>
        <label>تاريخ الميلاد<input type="date" name="dob" class="input" value="${U.esc(patient.dob||'')}"></label>
        <label>تاريخ التسجيل<input type="date" name="createdAt" class="input" value="${U.esc((patient.createdAt||'').slice(0,10))}"></label>
        <label>النوع
          <select name="gender" class="input">
            <option value="ذكر" ${patient.gender==='ذكر'?'selected':''}>ذكر</option>
            <option value="أنثى" ${patient.gender==='أنثى'?'selected':''}>أنثى</option>
          </select>
        </label>
        <label>مصدر معرفة العيادة
          <select name="source" class="input">
            ${sources.map(s => `<option value="${U.esc(s.name)}" ${patient.source===s.name?'selected':''}>${U.esc(s.name)}</option>`).join('')}
          </select>
        </label>
        <label class="span-2">العنوان<input name="address" class="input" value="${U.esc(patient.address||'')}"></label>
        <label class="span-2">ملاحظات<textarea name="notes" class="input" rows="2">${U.esc(patient.notes||'')}</textarea></label>
      </form>`, `
      <button class="btn btn-secondary" data-close>إلغاء</button>
      <button class="btn btn-primary" id="save-edit-btn">حفظ التعديلات</button>
    `);
    overlay.querySelector('#save-edit-btn').addEventListener('click', async () => {
      const form = overlay.querySelector('#patient-edit-form');
      if (!form.reportValidity()) return;
      const data = Object.fromEntries(new FormData(form).entries());
      if (!(await checkPatientInput(data, patient.id, patient))) return;
      if (!data.createdAt) data.createdAt = patient.createdAt || U.todayISO();
      await DB.put('patients', { ...patient, ...data });
      U.toast('تم حفظ التعديلات');
      overlay.remove();
      if (onSaved) onSaved();
    });
  });
};

async function renderPatientProfile(main, patientId) {
  const patient = await DB.get('patients', patientId);
  if (!patient) { main.innerHTML = `<div class="error-box">المريض غير موجود</div>`; return; }
  const visits = (await DB.byIndex('visits', 'patientId', patientId)).filter(v => !v.isDeleted).sort((a,b)=>b.date.localeCompare(a.date));
  const payments = await DB.byIndex('payments', 'patientId', patientId);
  const totalServices = visits.reduce((s,v)=>s+Number(v.total||0),0);
  const totalPaid = payments.reduce((s,p)=>s+Number(p.amount||0),0);
  const totalDiscount = visits.reduce((s,v)=>s+Math.max(0,Number(v.subtotal||0)-Number(v.total||0)),0);
  const remaining = totalServices - totalPaid;

  main.innerHTML = `
    <div class="page-header">
      <div>
        <a href="#patients" class="back-link">← رجوع لقائمة المرضى</a>
        <h2>${U.esc(patient.fullName)} <span class="tag">${U.esc(patient.fileNumber)}</span></h2>
        <div class="muted">${U.esc(patient.phone)} ${patient.altPhone ? ' / ' + U.esc(patient.altPhone) : ''}</div>
      </div>
      <div class="page-actions">
        <button class="btn" id="btn-wa-patient">واتساب</button>
        <button class="btn" id="btn-edit-patient">تعديل البيانات</button>
        <button class="btn btn-danger" id="btn-delete-patient">حذف المريض</button>
        <button class="btn" id="btn-print-summary">طباعة ملخص</button>
        <button class="btn" id="btn-export-patient">تصدير Excel</button>
      </div>
    </div>

    <div class="summary-cards">
      <div class="stat-card"><div class="stat-label">إجمالي الخدمات</div><div class="stat-value">${U.money(totalServices)}</div></div>
      <div class="stat-card"><div class="stat-label">إجمالي المدفوع</div><div class="stat-value stat-good">${U.money(totalPaid)}</div></div>
      <div class="stat-card"><div class="stat-label">المبلغ المتبقي</div><div class="stat-value ${remaining>0?'stat-bad':''}">${U.money(remaining)}</div></div>
      <div class="stat-card"><div class="stat-label">إجمالي الخصومات</div><div class="stat-value">${U.money(totalDiscount)}</div></div>
    </div>

    <div class="quick-actions-row">
      <button class="btn btn-primary" id="qa-new-visit">+ زيارة جديدة</button>
      <button class="btn" id="qa-new-appt">+ حجز موعد</button>
      <button class="btn" id="qa-add-payment">+ تسجيل دفعة</button>
      <button class="btn" id="qa-new-rx">+ إنشاء روشتة</button>
      <button class="btn" id="qa-new-plan">+ إضافة لخطة العلاج</button>
    </div>

    <div class="two-col">
      <div class="card">
        <h3>تاريخ الزيارات</h3>
        <div class="table-wrap">
          <table class="table table-compact">
            <thead><tr><th>التاريخ</th><th>نوع الزيارة</th><th>الخدمات</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th></tr></thead>
            <tbody>
              ${visits.map(v => `<tr class="row-click" data-href="#visits/${v.id}">
                <td>${U.fmtDate(v.date)}</td><td>${U.esc(v.visitType||'')}</td>
                <td>${U.esc(v._servicesLabel||'')}</td>
                <td>${U.money(v.total)}</td><td>${U.money(v.paid)}</td>
                <td class="${v.remaining>0?'text-bad':''}">${U.money(v.remaining)}</td>
              </tr>`).join('') || `<tr><td colspan="6" class="empty-cell">لا توجد زيارات مسجلة</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <h3>سجل المدفوعات</h3>
        <div class="table-wrap">
          <table class="table table-compact">
            <thead><tr><th>التاريخ</th><th>المبلغ</th><th>الطريقة</th><th></th></tr></thead>
            <tbody>
              ${payments.sort((a,b)=>b.date.localeCompare(a.date)).map(p => `<tr>
                <td>${U.fmtDate(p.date)}</td><td>${U.money(p.amount)}</td><td>${U.esc(p.method)}</td><td style="white-space:nowrap"><button class="btn btn-sm" data-edit-pay="${p.id}">تعديل</button> <button class="btn btn-sm btn-danger" data-del-pay="${p.id}">حذف</button></td>
              </tr>`).join('') || `<tr><td colspan="4" class="empty-cell">لا توجد مدفوعات</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="card" id="rx-history-card"></div>
    <div class="card" id="plan-history-card"></div>
  `;

  // fill visit services labels
  for (const v of visits) {
    const vs = await DB.byIndex('visitServices', 'visitId', v.id);
    v._servicesLabel = vs.map(s => s.serviceName).join('، ');
  }
  main.querySelectorAll('.row-click').forEach(tr => tr.addEventListener('click', () => goto(tr.dataset.href)));

  await renderPrescriptionHistoryCard(main.querySelector('#rx-history-card'), patient);
  await renderPlanHistoryCard(main.querySelector('#plan-history-card'), patient);

  main.querySelector('#btn-edit-patient').addEventListener('click', () => Views.openEditPatientModal(patient, () => route()));
  main.querySelector('#btn-delete-patient').addEventListener('click', () => deletePatientFlow(patient, () => goto('#patients')));
  main.querySelector('#btn-wa-patient').addEventListener('click', () => openWhatsAppQuickActions(patient));
  main.querySelector('#btn-print-summary').addEventListener('click', () => printPatientSummary(patient, visits, payments, {totalServices, totalPaid, remaining, totalDiscount}));
  main.querySelector('#btn-export-patient').addEventListener('click', () => exportPatientExcel(patient, visits, payments));
  main.querySelector('#qa-new-visit').addEventListener('click', () => Views.openNewVisitModal(patient.id));
  main.querySelector('#qa-new-appt').addEventListener('click', () => Views.openNewAppointmentModal(patient.id));
  main.querySelector('#qa-add-payment').addEventListener('click', () => Views.openAddPaymentModal(patient.id, null, () => route()));
  bindPaymentEdit(main);
  main.querySelector('#qa-new-rx').addEventListener('click', () => Views.openNewPrescriptionModal(patient.id, null, () => route()));
  main.querySelector('#qa-new-plan').addEventListener('click', () => Views.openNewTreatmentPlanModal(patient.id, () => route()));
}

function openWhatsAppQuickActions(patient) {
  const info = APP_STATE.clinicInfo;
  const messages = {
    reminder: `مرحبًا ${patient.fullName}،\nتذكير بموعدك القادم في ${info.name}.\nنتشرف بزيارتكم.`,
    payment: `مرحبًا ${patient.fullName}،\nملخص الحساب:\nنشكر لكم التعامل مع ${info.name}.`,
    followup: `مرحبًا ${patient.fullName}،\nنتمنى لكم دوام الصحة، هذه رسالة متابعة من ${info.name}.`,
  };
  const overlay = U.openModal(`واتساب - ${U.esc(patient.fullName)}`, `
    <div class="stack-btns">
      <button class="btn" data-msg="reminder">إرسال تذكير موعد</button>
      <button class="btn" data-msg="payment">إرسال ملخص مدفوعات</button>
      <button class="btn" data-msg="followup">إرسال رسالة متابعة</button>
      <button class="btn" data-msg="blank">فتح واتساب بدون رسالة محددة</button>
    </div>`, `<button class="btn btn-secondary" data-close>إغلاق</button>`);
  overlay.querySelectorAll('[data-msg]').forEach(b => b.addEventListener('click', () => {
    const text = b.dataset.msg === 'blank' ? '' : messages[b.dataset.msg];
    window.open(U.waLink(patient.phone, text), '_blank');
    overlay.remove();
  }));
}

function printPatientSummary(patient, visits, payments, totals) {
  const info = APP_STATE.clinicInfo;
  const html = `
    <div class="print-header">
      <img src="assets/icon-navy-128.png" class="print-logo" alt="">
      <h1>${U.esc(info.name)}</h1>
      <div>ملخص بيانات المريض</div>
    </div>
    <table class="print-table">
      <tr><td>الاسم</td><td>${U.esc(patient.fullName)}</td><td>رقم الملف</td><td>${U.esc(patient.fileNumber)}</td></tr>
      <tr><td>الموبايل</td><td>${U.esc(patient.phone)}</td><td>تاريخ الطباعة</td><td>${U.fmtDate(U.todayISO())}</td></tr>
    </table>
    <h3>الملخص المالي</h3>
    <table class="print-table">
      <tr><td>إجمالي الخدمات</td><td>${U.money(totals.totalServices)}</td><td>إجمالي المدفوع</td><td>${U.money(totals.totalPaid)}</td></tr>
      <tr><td>المتبقي</td><td>${U.money(totals.remaining)}</td><td>إجمالي الخصومات</td><td>${U.money(totals.totalDiscount)}</td></tr>
    </table>
    <h3>تاريخ الزيارات</h3>
    <table class="print-table">
      <thead><tr><th>التاريخ</th><th>نوع الزيارة</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th></tr></thead>
      <tbody>${visits.map(v => `<tr><td>${U.fmtDate(v.date)}</td><td>${U.esc(v.visitType||'')}</td><td>${U.money(v.total)}</td><td>${U.money(v.paid)}</td><td>${U.money(v.remaining)}</td></tr>`).join('')}</tbody>
    </table>
    <div class="print-footer">${U.esc(info.name)} — ${U.esc(info.phone||'')}</div>
  `;
  U.printSection(html, 'ملخص المريض');
}

function exportPatientExcel(patient, visits, payments) {
  U.exportToExcel([
    { name: 'الزيارات', rows: visits.map(v => ({ 'التاريخ': U.fmtDate(v.date), 'نوع الزيارة': v.visitType, 'الإجمالي': v.total, 'المدفوع': v.paid, 'المتبقي': v.remaining })) },
    { name: 'المدفوعات', rows: payments.map(p => ({ 'التاريخ': U.fmtDate(p.date), 'المبلغ': p.amount, 'الطريقة': p.method })) },
  ], `بيانات_${patient.fileNumber}.xlsx`);
}

async function renderPrescriptionHistoryCard(container, patient) {
  const rxs = (await DB.byIndex('prescriptions', 'patientId', patient.id)).sort((a,b)=>b.date.localeCompare(a.date));
  container.innerHTML = `
    <h3>سجل الروشتات</h3>
    <div class="table-wrap">
      <table class="table table-compact">
        <thead><tr><th>التاريخ</th><th>رقم الروشتة</th><th>الطبيب</th><th>التشخيص</th><th></th></tr></thead>
        <tbody>
        ${rxs.map(r => `<tr>
          <td>${U.fmtDate(r.date)}</td><td>${U.esc(r.prescriptionNumber)}</td><td>${U.esc(r.doctorName)}</td><td>${U.esc(r.diagnosis||'')}</td>
          <td><button class="btn btn-sm" data-rx="${r.id}">عرض/طباعة</button></td>
        </tr>`).join('') || `<tr><td colspan="5" class="empty-cell">لا توجد روشتات</td></tr>`}
        </tbody>
      </table>
    </div>`;
  container.querySelectorAll('[data-rx]').forEach(b => b.addEventListener('click', () => Views.viewPrescription(Number(b.dataset.rx))));
}

async function renderPlanHistoryCard(container, patient) {
  const plans = (await DB.byIndex('treatmentPlans', 'patientId', patient.id));
  const total = plans.reduce((s,p)=>s+Number(p.price||0),0);
  const done = plans.filter(p=>p.status==='مكتمل').reduce((s,p)=>s+Number(p.price||0),0);
  container.innerHTML = `
    <h3>خطة العلاج</h3>
    <div class="table-wrap">
      <table class="table table-compact">
        <thead><tr><th>السن</th><th>العلاج</th><th>السعر</th><th>الأولوية</th><th>الحالة</th><th></th></tr></thead>
        <tbody>
        ${plans.map(p => `<tr>
          <td>${U.esc(p.tooth||'')}</td><td>${U.esc(p.treatment)}</td><td>${U.money(p.price)}</td><td>${U.esc(p.priority)}</td><td>${U.esc(p.status)}</td>
          <td>${p.status!=='مكتمل' && !p.convertedVisitId ? `<button class="btn btn-sm" data-conv="${p.id}">تحويل لزيارة</button>` : ''}</td>
        </tr>`).join('') || `<tr><td colspan="6" class="empty-cell">لا توجد خطة علاج</td></tr>`}
        </tbody>
      </table>
      <div class="muted">إجمالي الخطة: ${U.money(total)} — المكتمل: ${U.money(done)}</div>
    </div>`;
  container.querySelectorAll('[data-conv]').forEach(b => b.addEventListener('click', async () => {
    const plan = await DB.get('treatmentPlans', Number(b.dataset.conv));
    Views.openNewVisitModal(patient.id, { prefillService: plan });
  }));
}


/* ---------- حذف مريض (مع كل سجلاته) ---------- */
async function deletePatientFlow(patient, onDone) {
  if (typeof canDo === 'function' && !canDo('delete')) { U.toast('ليس لديك صلاحية الحذف', 'error'); return; }
  const [appts, visits, payments, rxs, plans] = await Promise.all([
    DB.byIndex('appointments', 'patientId', patient.id), DB.byIndex('visits', 'patientId', patient.id),
    DB.byIndex('payments', 'patientId', patient.id), DB.byIndex('prescriptions', 'patientId', patient.id),
    DB.byIndex('treatmentPlans', 'patientId', patient.id),
  ]);
  const parts = [];
  if (visits.length) parts.push(`${visits.length} زيارة`);
  if (payments.length) parts.push(`${payments.length} دفعة`);
  if (appts.length) parts.push(`${appts.length} موعد`);
  if (rxs.length) parts.push(`${rxs.length} روشتة`);
  if (plans.length) parts.push(`${plans.length} بند في خطة العلاج`);
  const name = `${patient.fullName} (${patient.fileNumber})`;
  const msg = parts.length
    ? `المريض ${name} عنده ${parts.join('، ')}. الحذف هيمسحه هو وكل السجلات دي نهائيًا، ومش هتقدر ترجّعها إلا من نسخة احتياطية. متأكد؟`
    : `حذف المريض ${name} نهائيًا؟`;
  if (!(await U.confirm(msg))) return;
  for (const v of visits) {
    for (const s of await DB.byIndex('visitServices', 'visitId', v.id)) await DB.delete('visitServices', s.id);
    await DB.delete('visits', v.id);
  }
  for (const x of payments) await DB.delete('payments', x.id);
  for (const rx of rxs) {
    for (const it of await DB.byIndex('prescriptionItems', 'prescriptionId', rx.id)) await DB.delete('prescriptionItems', it.id);
    await DB.delete('prescriptions', rx.id);
  }
  for (const a of appts) await DB.delete('appointments', a.id);
  for (const pl of plans) await DB.delete('treatmentPlans', pl.id);
  await DB.delete('patients', patient.id);
  U.toast('تم حذف المريض');
  onDone();
}


/* تحقق قبل حفظ المريض: رقم موبايل غلط أو مريض مكرر (نفس الرقم/الاسم) */
async function checkPatientInput(data, selfId, orig) {
  for (const [k, label] of [['phone', 'رقم الموبايل'], ['altPhone', 'رقم الموبايل البديل']]) {
    if (data[k] && String(data[k]).trim() && !(orig && orig[k] === data[k]) && !U.validPhone(data[k])
        && !(await U.confirm(`${label} (${data[k]}) شكله غير صحيح (المفروض 11 رقم يبدأ بـ 01). تكمل برضه؟`))) return false;
  }
  const nm = String(data.fullName || '').trim().replace(/\s+/g, ' ');
  const ph = U.validPhone(data.phone) ? U.normPhone(data.phone) : '';
  if (orig && String(orig.fullName || '').trim().replace(/\s+/g, ' ') === nm && U.normPhone(orig.phone) === ph) return true;
  const all = (await DB.all('patients')).filter(p => !p.isDeleted && p.id !== selfId);
  const dupPhone = ph && all.find(p => U.normPhone(p.phone) === ph || U.normPhone(p.altPhone) === ph);
  const dupName = nm && all.find(p => String(p.fullName || '').trim().replace(/\s+/g, ' ') === nm);
  const d = dupPhone || dupName;
  if (d) return U.confirm(`فيه مريض ${dupPhone ? 'بنفس رقم الموبايل' : 'بنفس الاسم'} بالفعل: ${d.fullName} (${d.fileNumber}). تحفظ برضه؟`);
  return true;
}

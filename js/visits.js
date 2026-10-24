/* =========================================================
   visits.js — الزيارات والعلاجات
   ========================================================= */

Views.visits = async function(main, param) {
  if (param) return renderVisitDetail(main, Number(param));
  const visits = (await DB.all('visits')).filter(v => !v.isDeleted).sort((a,b) => b.date.localeCompare(a.date) || b.id-a.id);
  const patients = Object.fromEntries((await DB.all('patients')).map(p => [p.id, p]));
  main.innerHTML = `
    <div class="page-header">
      <h2>الزيارات والعلاجات <span class="count-badge">${visits.length}</span></h2>
      <div class="page-actions">
        <input type="date" id="visits-filter-date" class="input">
        <button class="btn" id="btn-export-ledger">تصدير كشف الحسابات</button>
        <button class="btn btn-primary" id="btn-new-visit">+ تسجيل زيارة</button>
      </div>
    </div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>التاريخ</th><th>رقم الملف</th><th>المريض</th><th>نوع الزيارة</th><th>دكتور الشيفت</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th></tr></thead>
      <tbody id="visits-tbody"></tbody>
    </table></div>`;
  const tbody = main.querySelector('#visits-tbody');
  const draw = (list) => {
    tbody.innerHTML = list.map(v => `<tr class="row-click" data-href="#visits/${v.id}">
      <td>${U.fmtDate(v.date)}</td><td>${U.esc((patients[v.patientId]||{}).fileNumber||'')}</td>
      <td>${U.esc((patients[v.patientId]||{}).fullName||'')}</td>
      <td>${U.esc(v.visitType||'')}</td><td>${U.esc(v.doctorName||'')}</td><td>${U.money(v.total)}</td><td>${U.money(v.paid)}</td>
      <td class="${v.remaining>0?'text-bad':''}">${U.money(v.remaining)}</td>
    </tr>`).join('') || `<tr><td colspan="8" class="empty-cell">لا توجد زيارات</td></tr>`;
    tbody.querySelectorAll('.row-click').forEach(tr => tr.addEventListener('click', () => goto(tr.dataset.href)));
  };
  draw(visits);
  main.querySelector('#visits-filter-date').addEventListener('change', (e) => {
    const d = e.target.value;
    draw(d ? visits.filter(v => v.date === d) : visits);
  });
  main.querySelector('#btn-new-visit').addEventListener('click', () => Views.openNewVisitModal());
  main.querySelector('#btn-export-ledger').addEventListener('click', () => exportPatientLedgerExcel());
};

const TOOTH_NUMBERS = [
  ...[18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28],
  ...[48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38],
];

Views.openNewVisitModal = function(patientId, opts={}) {
  Promise.all([DB.all('patients'), DB.all('visitTypes'), DB.all('services'), DB.all('serviceCategories'), DB.all('doctors')]).then(([patients, visitTypes, services, cats, doctors]) => {
    let lineItems = [];
    if (opts.prefillService) {
      lineItems.push({ serviceId: null, serviceName: opts.prefillService.treatment, tooth: opts.prefillService.tooth || '', price: opts.prefillService.price || 0, qty: 1 });
    }
    const overlay = U.openModal('تسجيل زيارة جديدة', `
      <form id="visit-form" class="form-grid">
        <label class="span-2">المريض *
          <select name="patientId" required class="input" id="visit-patient-select" ${patientId?'disabled':''}>
            <option value="">اختر مريض...</option>
            ${patients.filter(p=>!p.isDeleted).map(p => `<option value="${p.id}" ${patientId===p.id?'selected':''}>${U.esc(p.fullName)} (${U.esc(p.fileNumber)})</option>`).join('')}
          </select>
          ${patientId?`<input type="hidden" name="patientId" value="${patientId}">`:''}
        </label>
        <label>تاريخ الزيارة<input type="date" name="date" class="input" value="${U.todayISO()}"></label>
        <label>نوع الزيارة
          <select name="visitType" class="input">${visitTypes.map(v => `<option ${opts.visitType===v.name?'selected':''}>${U.esc(v.name)}</option>`).join('')}</select>
        </label>
        <label>دكتور الشيفت
          <select name="doctorName" class="input">
            <option value="">بدون تحديد</option>
            ${doctors.filter(d=>d.active!==false).map(d => `<option>${U.esc(d.name)}</option>`).join('')}
          </select>
        </label>
        <label class="span-2">التشخيص<input name="diagnosis" class="input"></label>
      </form>

      <h4>الخدمات</h4>
      <div id="visit-service-picker" class="service-picker-row">
        <select id="svc-select" class="input">
          <option value="">الخدمة: اختر من القائمة...</option>
          ${cats.map(c => `<optgroup label="${U.esc(c.name)}">${services.filter(s=>s.categoryId===c.id && s.active!==false).map(s => `<option value="${s.id}" data-name="${U.esc(s.name)}">${U.esc(s.name)}</option>`).join('')}</optgroup>`).join('')}
        </select>
        <input type="text" id="svc-tooth" class="input" placeholder="السن (اختياري)" list="tooth-list" style="width:130px">
        <datalist id="tooth-list">${TOOTH_NUMBERS.map(t => `<option value="${t}">`).join('')}</datalist>
        <input type="number" id="svc-price" class="input" placeholder="السعر (جنيه)" min="0" step="0.01" style="width:150px">
        <button type="button" class="btn" id="add-svc-btn">+ إضافة خدمة</button>
      </div>
      <div class="muted-sm" style="margin:-4px 0 10px">السعر يُكتب يدويًا لكل حالة — لا يوجد سعر افتراضي أو ثابت للخدمة.</div>
      <div class="table-wrap">
        <table class="table table-compact">
          <thead><tr><th>الخدمة</th><th>السن</th><th>السعر</th><th></th></tr></thead>
          <tbody id="visit-items-tbody"></tbody>
        </table>
      </div>

      <div class="form-grid" style="margin-top:10px">
        <label>نوع الخصم
          <select id="discount-type" class="input"><option value="fixed">مبلغ ثابت</option><option value="percentage">نسبة %</option></select>
        </label>
        <label>قيمة الخصم<input type="number" id="discount-value" class="input" value="0" min="0"></label>
        <label>المدفوع الآن<input type="number" id="paid-now" class="input" value="0" min="0"></label>
        <label class="span-2">ملاحظات الطبيب<textarea id="doctor-notes" class="input" rows="2"></textarea></label>
      </div>
      <div class="visit-totals">
        <div>الإجمالي الفرعي: <b id="tot-subtotal">${U.money(0)}</b></div>
        <div>بعد الخصم: <b id="tot-total">${U.money(0)}</b></div>
        <div>المدفوع: <b id="tot-paid">${U.money(0)}</b></div>
        <div>المتبقي: <b id="tot-remaining">${U.money(0)}</b></div>
      </div>
      `, `
      <button class="btn btn-secondary" data-close>إلغاء</button>
      <button class="btn btn-primary" id="save-visit-btn">حفظ الزيارة</button>
    `, {wide:true});

    const itemsTbody = overlay.querySelector('#visit-items-tbody');
    const renderItems = () => {
      itemsTbody.innerHTML = lineItems.map((it,i) => `<tr>
        <td>${U.esc(it.serviceName)}</td><td>${U.esc(it.tooth||'-')}</td>
        <td><input type="number" class="input input-sm item-price" data-i="${i}" value="${it.price}"></td>
        <td><button type="button" class="btn btn-sm btn-danger" data-rm="${i}">حذف</button></td>
      </tr>`).join('') || `<tr><td colspan="4" class="empty-cell">لم تُضَف خدمات بعد</td></tr>`;
      itemsTbody.querySelectorAll('.item-price').forEach(inp => inp.addEventListener('input', () => {
        lineItems[Number(inp.dataset.i)].price = Number(inp.value)||0; recalcTotals();
      }));
      itemsTbody.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => {
        lineItems.splice(Number(b.dataset.rm),1); renderItems(); recalcTotals();
      }));
    };
    const recalcTotals = () => {
      const subtotal = lineItems.reduce((s,it)=>s+Number(it.price||0),0);
      const dType = overlay.querySelector('#discount-type').value;
      const dVal = Number(overlay.querySelector('#discount-value').value)||0;
      const total = U.discountedTotal(subtotal, dType, dVal);
      const paid = Number(overlay.querySelector('#paid-now').value)||0;
      overlay.querySelector('#tot-subtotal').textContent = U.money(subtotal);
      overlay.querySelector('#tot-total').textContent = U.money(total);
      overlay.querySelector('#tot-paid').textContent = U.money(Math.min(paid,total));
      overlay.querySelector('#tot-remaining').textContent = U.money(Math.max(0,total-paid));
    };
    renderItems(); recalcTotals();

    overlay.querySelector('#add-svc-btn').addEventListener('click', () => {
      const sel = overlay.querySelector('#svc-select');
      const opt = sel.selectedOptions[0];
      const priceInput = overlay.querySelector('#svc-price');
      if (!opt || !opt.value) { U.toast('اختر الخدمة أولًا', 'error'); return; }
      if (priceInput.value === '' || isNaN(Number(priceInput.value))) { U.toast('أدخل سعر هذه الحالة قبل الإضافة', 'error'); priceInput.focus(); return; }
      lineItems.push({ serviceId: Number(opt.value), serviceName: opt.dataset.name, tooth: overlay.querySelector('#svc-tooth').value, price: Number(priceInput.value) });
      sel.value = ''; overlay.querySelector('#svc-tooth').value = ''; priceInput.value = '';
      renderItems(); recalcTotals();
    });
    overlay.querySelector('#discount-type').addEventListener('change', recalcTotals);
    overlay.querySelector('#discount-value').addEventListener('input', recalcTotals);
    overlay.querySelector('#paid-now').addEventListener('input', recalcTotals);

    overlay.querySelector('#save-visit-btn').addEventListener('click', async () => {
      const form = overlay.querySelector('#visit-form');
      const data = Object.fromEntries(new FormData(form).entries());
      if (!data.patientId) { U.toast('اختر المريض أولًا', 'error'); return; }
      if (lineItems.length === 0) { U.toast('أضف خدمة واحدة على الأقل', 'error'); return; }
      const subtotal = lineItems.reduce((s,it)=>s+Number(it.price||0),0);
      const dType = overlay.querySelector('#discount-type').value;
      const dVal = Number(overlay.querySelector('#discount-value').value)||0;
      const total = U.discountedTotal(subtotal, dType, dVal);
      let paid = Number(overlay.querySelector('#paid-now').value)||0;
      if (paid > total) { U.toast('المبلغ المدفوع أكبر من المستحق — تم ضبطه على قيمة الإجمالي', 'error'); paid = total; }
      const visitId = await DB.add('visits', {
        patientId: Number(data.patientId), appointmentId: opts.appointmentId || null,
        date: data.date, visitType: data.visitType, diagnosis: data.diagnosis || '', doctorNotes: overlay.querySelector('#doctor-notes').value,
        doctorName: data.doctorName || '',
        discountType: dType, discountValue: dVal, subtotal, total, paid, remaining: total - paid, createdAt: new Date().toISOString(), isDeleted: false,
      });
      for (const it of lineItems) await DB.add('visitServices', { visitId, serviceId: it.serviceId, serviceName: it.serviceName, tooth: it.tooth||'', price: it.price, qty: 1 });
      if (paid > 0) await DB.add('payments', { patientId: Number(data.patientId), visitId, date: data.date, amount: paid, method: 'كاش', notes: 'دفعة عند تسجيل الزيارة', createdAt: new Date().toISOString() });
      if (opts.prefillService && opts.prefillService.id) {
        await DB.put('treatmentPlans', { ...opts.prefillService, status: 'مكتمل', convertedVisitId: visitId });
      }
      U.toast('تم حفظ الزيارة بنجاح'); overlay.remove();
      goto(`#visits/${visitId}`);
    });
  });
};

async function renderVisitDetail(main, visitId) {
  const visit = await DB.get('visits', visitId);
  if (!visit) { main.innerHTML = `<div class="error-box">الزيارة غير موجودة</div>`; return; }
  const patient = await DB.get('patients', visit.patientId);
  const items = await DB.byIndex('visitServices', 'visitId', visitId);
  const payments = (await DB.byIndex('payments', 'visitId', visitId)).sort((a,b)=>b.date.localeCompare(a.date));
  main.innerHTML = `
    <div class="page-header">
      <div>
        <a href="#patients/${patient.id}" class="back-link">← رجوع لملف المريض</a>
        <h2>زيارة ${U.fmtDate(visit.date)} — ${U.esc(patient.fullName)}</h2>
      </div>
      <div class="page-actions">
        <button class="btn" id="btn-add-payment">+ تسجيل دفعة</button>
        <button class="btn" id="btn-edit-visit-date">تعديل التاريخ</button>
        <button class="btn" id="btn-print-visit">طباعة</button>
      </div>
    </div>
    <div class="two-col">
      <div class="card">
        <h3>الخدمات</h3>
        <table class="table table-compact">
          <thead><tr><th>الخدمة</th><th>السن</th><th>السعر</th></tr></thead>
          <tbody>${items.map(it => `<tr><td>${U.esc(it.serviceName)}</td><td>${U.esc(it.tooth||'-')}</td><td>${U.money(it.price)}</td></tr>`).join('')}</tbody>
        </table>
        <div class="visit-totals" style="margin-top:10px">
          <div>الإجمالي الفرعي: <b>${U.money(visit.subtotal)}</b></div>
          <div>الخصم: <b>${visit.discountType==='percentage'? visit.discountValue+'%' : U.money(visit.discountValue)}</b></div>
          <div>الإجمالي: <b>${U.money(visit.total)}</b></div>
          <div>المدفوع: <b>${U.money(visit.paid)}</b></div>
          <div>المتبقي: <b class="${visit.remaining>0?'text-bad':''}">${U.money(visit.remaining)}</b></div>
        </div>
        ${visit.diagnosis ? `<p><b>التشخيص:</b> ${U.esc(visit.diagnosis)}</p>` : ''}
        ${visit.doctorName ? `<p><b>دكتور الشيفت:</b> ${U.esc(visit.doctorName)}</p>` : ''}
        ${visit.doctorNotes ? `<p><b>ملاحظات الطبيب:</b> ${U.esc(visit.doctorNotes)}</p>` : ''}
      </div>
      <div class="card">
        <h3>الدفعات المرتبطة بهذه الزيارة</h3>
        <table class="table table-compact">
          <thead><tr><th>التاريخ</th><th>المبلغ</th><th>الطريقة</th></tr></thead>
          <tbody>${payments.map(p => `<tr><td>${U.fmtDate(p.date)}</td><td>${U.money(p.amount)}</td><td>${U.esc(p.method)}</td></tr>`).join('') || `<tr><td colspan="3" class="empty-cell">لا توجد دفعات</td></tr>`}</tbody>
        </table>
      </div>
    </div>`;
  main.querySelector('#btn-add-payment').addEventListener('click', () => Views.openAddPaymentModal(patient.id, visitId, () => route()));
  main.querySelector('#btn-edit-visit-date').addEventListener('click', () => {
    const ov = U.openModal('تعديل تاريخ الزيارة', `<label>التاريخ<input type="date" id="vd-input" class="input" value="${visit.date}"></label>`,
      '<button class="btn btn-secondary" data-close>إلغاء</button><button class="btn btn-primary" id="vd-save">حفظ</button>');
    ov.querySelector('#vd-save').addEventListener('click', async () => {
      const nd = ov.querySelector('#vd-input').value; if (!nd) return;
      await DB.put('visits', { ...visit, date: nd });
      for (const p of payments) if (p.date === visit.date) await DB.put('payments', { ...p, date: nd });
      ov.remove(); U.toast('تم تحديث التاريخ'); route();
    });
  });
  main.querySelector('#btn-print-visit').addEventListener('click', () => {
    const info = APP_STATE.clinicInfo;
    U.printSection(`
      <div class="print-header"><img src="assets/icon-navy-128.png" class="print-logo" alt=""><h1>${U.esc(info.name)}</h1><div>فاتورة زيارة</div></div>
      <table class="print-table"><tr><td>المريض</td><td>${U.esc(patient.fullName)}</td><td>رقم الملف</td><td>${U.esc(patient.fileNumber)}</td></tr>
      <tr><td>التاريخ</td><td>${U.fmtDate(visit.date)}</td><td>نوع الزيارة</td><td>${U.esc(visit.visitType||'')}</td></tr>
      <tr><td>دكتور الشيفت</td><td colspan="3">${U.esc(visit.doctorName||'')}</td></tr></table>
      <table class="print-table"><thead><tr><th>الخدمة</th><th>السن</th><th>السعر</th></tr></thead>
      <tbody>${items.map(it => `<tr><td>${U.esc(it.serviceName)}</td><td>${U.esc(it.tooth||'-')}</td><td>${U.money(it.price)}</td></tr>`).join('')}</tbody></table>
      <table class="print-table"><tr><td>الإجمالي</td><td>${U.money(visit.total)}</td><td>المدفوع</td><td>${U.money(visit.paid)}</td><td>المتبقي</td><td>${U.money(visit.remaining)}</td></tr></table>
      <div class="print-footer">${U.esc(info.name)} — ${U.esc(info.phone||'')}</div>
    `, 'فاتورة زيارة');
  });
}

/* تصدير كشف حسابات المرضى بنفس شكل الشيت المستخدم سابقًا في العيادة */
async function exportPatientLedgerExcel(fromDate, toDate) {
  const [visits, patients, vServices] = await Promise.all([DB.all('visits'), DB.all('patients'), DB.all('visitServices')]);
  const patientMap = Object.fromEntries(patients.map(p => [p.id, p]));
  const activeVisits = visits.filter(v => !v.isDeleted);

  // إجمالي المديونية الحالية لكل مريض (مجموع المتبقي على كل زياراته حتى الآن)
  const totalDebtByPatient = {};
  activeVisits.forEach(v => { totalDebtByPatient[v.patientId] = (totalDebtByPatient[v.patientId]||0) + Number(v.remaining||0); });

  const vsByVisit = {};
  vServices.forEach(vs => { (vsByVisit[vs.visitId] = vsByVisit[vs.visitId] || []).push(vs); });

  let filtered = activeVisits;
  if (fromDate) filtered = filtered.filter(v => v.date >= fromDate);
  if (toDate) filtered = filtered.filter(v => v.date <= toDate);
  filtered = filtered.sort((a,b) => a.date.localeCompare(b.date) || a.id-b.id);

  const rows = filtered.map(v => {
    const p = patientMap[v.patientId] || {};
    const services = (vsByVisit[v.id] || []).map(s => s.serviceName).join('، ');
    return {
      'Date': U.fmtDate(v.date),
      'File No': p.fileNumber || '',
      'Patient Name-اسم المريض': p.fullName || '',
      'Phone': p.phone || '',
      'Service Type - نوع الخدمة': services,
      'Service Cost- تكلفة الخدمة': v.total,
      'Paid- المدفوع': v.paid,
      'Total Debt - إجمالي المديونية': totalDebtByPatient[v.patientId] || 0,
      'Shift Doctor - دكتور الشيفت': v.doctorName || '',
      'Remaining- المتبقي': v.remaining,
    };
  });

  U.exportToExcel([{ name: 'Patients', rows }], `كشف_حسابات_المرضى_${U.todayISO()}.xlsx`);
}

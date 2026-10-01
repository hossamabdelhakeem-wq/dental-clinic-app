/* =========================================================
   reports.js — التقارير
   ========================================================= */

Views.reports = async function(main) {
  main.innerHTML = `
    <div class="page-header"><h2>التقارير</h2></div>
    <div class="card">
      <div class="form-grid">
        <label>الفترة
          <select id="rep-range" class="input">
            <option value="today">اليوم</option>
            <option value="yesterday">أمس</option>
            <option value="week">هذا الأسبوع</option>
            <option value="month" selected>هذا الشهر</option>
            <option value="lastmonth">الشهر الماضي</option>
            <option value="year">هذا العام</option>
            <option value="custom">فترة مخصصة</option>
          </select>
        </label>
        <label>من<input type="date" id="rep-from" class="input" disabled></label>
        <label>إلى<input type="date" id="rep-to" class="input" disabled></label>
        <label style="align-self:end"><button class="btn btn-primary" id="rep-run">عرض التقرير</button></label>
      </div>
    </div>
    <div id="rep-output"></div>
  `;
  const rangeSel = main.querySelector('#rep-range');
  const fromI = main.querySelector('#rep-from'), toI = main.querySelector('#rep-to');
  rangeSel.addEventListener('change', () => {
    const custom = rangeSel.value === 'custom';
    fromI.disabled = !custom; toI.disabled = !custom;
  });
  main.querySelector('#rep-run').addEventListener('click', () => runReport(main, rangeSel.value, fromI.value, toI.value));
  runReport(main, 'month');
};

function computeRange(rangeKey, fromV, toV) {
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0,10);
  let from, to;
  if (rangeKey === 'today') { from = to = iso(today); }
  else if (rangeKey === 'yesterday') { const y = new Date(today); y.setDate(y.getDate()-1); from = to = iso(y); }
  else if (rangeKey === 'week') { const s = new Date(today); s.setDate(s.getDate()-s.getDay()); from = iso(s); to = iso(today); }
  else if (rangeKey === 'month') { from = iso(today).slice(0,8)+'01'; to = iso(today); }
  else if (rangeKey === 'lastmonth') {
    const s = new Date(today.getFullYear(), today.getMonth()-1, 1);
    const e = new Date(today.getFullYear(), today.getMonth(), 0);
    from = iso(s); to = iso(e);
  }
  else if (rangeKey === 'year') { from = today.getFullYear()+'-01-01'; to = iso(today); }
  else { from = fromV || iso(today); to = toV || iso(today); }
  return { from, to };
}

async function runReport(main, rangeKey, fromV, toV) {
  const { from, to } = computeRange(rangeKey, fromV, toV);
  const [visits, payments, expenses, patients, appointments, prescriptions, plans, expCats, vServices] = await Promise.all([
    DB.all('visits'), DB.all('payments'), DB.all('expenses'), DB.all('patients'), DB.all('appointments'), DB.all('prescriptions'), DB.all('treatmentPlans'), DB.all('expenseCategories'), DB.all('visitServices'),
  ]);
  const inRange = (d) => d >= from && d <= to;
  const rVisits = visits.filter(v => !v.isDeleted && inRange(v.date));
  const rPayments = payments.filter(p => inRange(p.date));
  const rExpenses = expenses.filter(e => isExpensePaid(e) && inRange(expenseEffectiveDate(e)));
  const rDebtsOpened = expenses.filter(e => !isExpensePaid(e) && inRange(e.date));
  const outstandingDebtTotal = expenses.filter(e => !isExpensePaid(e)).reduce((s,e)=>s+Number(e.amount||0),0);
  const rPatients = patients.filter(p => !p.isDeleted && inRange((p.createdAt||'').slice(0,10)));
  const rAppts = appointments.filter(a => inRange(a.date));
  const rPrescriptions = prescriptions.filter(r => inRange(r.date));

  const revenue = rPayments.reduce((s,p)=>s+Number(p.amount),0);
  const expTotal = rExpenses.reduce((s,e)=>s+Number(e.amount),0);
  const profit = revenue - expTotal;
  const outstanding = rVisits.reduce((s,v)=>s+Number(v.remaining||0),0);

  const returningPatients = new Set(rVisits.map(v=>v.patientId)).size;

  const svcCount = {};
  const vIds = new Set(rVisits.map(v=>v.id));
  vServices.filter(vs => vIds.has(vs.visitId)).forEach(vs => {
    svcCount[vs.serviceName] = svcCount[vs.serviceName] || { count:0, revenue:0, min:null, max:null };
    const d = svcCount[vs.serviceName];
    const price = Number(vs.price||0);
    d.count++; d.revenue += price;
    d.min = d.min === null ? price : Math.min(d.min, price);
    d.max = d.max === null ? price : Math.max(d.max, price);
  });
  const svcRows = Object.entries(svcCount).sort((a,b)=>b[1].revenue-a[1].revenue);

  const apptDone = rAppts.filter(a=>a.status==='تم الكشف').length;
  const apptCancelled = rAppts.filter(a=>a.status==='ملغي').length;
  const apptNoShow = rAppts.filter(a=>a.status==='لم يحضر').length;

  const expByCat = expCats.map(c => ({ name: c.name, total: rExpenses.filter(e=>e.categoryId===c.id).reduce((s,e)=>s+Number(e.amount),0) })).filter(x=>x.total>0);

  const planTotal = plans.reduce((s,p)=>s+Number(p.price||0),0);
  const planDone = plans.filter(p=>p.status==='مكتمل').reduce((s,p)=>s+Number(p.price||0),0);

  const out = main.querySelector('#rep-output');
  out.innerHTML = `
    <div class="report-range-label">الفترة من ${U.fmtDate(from)} إلى ${U.fmtDate(to)}</div>

    <div class="card">
      <div class="card-header-row"><h3>تقرير الإيرادات والمصروفات والأرباح</h3>
        <button class="btn btn-sm" data-exp="financial">تصدير Excel</button></div>
      <div class="summary-cards">
        <div class="stat-card"><div class="stat-label">الإيرادات</div><div class="stat-value stat-good">${U.money(revenue)}</div></div>
        <div class="stat-card"><div class="stat-label">المصروفات</div><div class="stat-value stat-bad">${U.money(expTotal)}</div></div>
        <div class="stat-card"><div class="stat-label">صافي الربح</div><div class="stat-value">${U.money(profit)}</div></div>
        <div class="stat-card"><div class="stat-label">المبالغ المستحقة</div><div class="stat-value stat-bad">${U.money(outstanding)}</div></div>
        <div class="stat-card"><div class="stat-label">ديون فُتحت بالفترة (موردين/معامل)</div><div class="stat-value stat-bad">${U.money(rDebtsOpened.reduce((s,e)=>s+Number(e.amount||0),0))}</div></div>
        <div class="stat-card"><div class="stat-label">إجمالي الديون المفتوحة حاليًا</div><div class="stat-value stat-bad">${U.money(outstandingDebtTotal)}</div></div>
      </div>
      ${expByCat.length ? `<h4>المصروفات حسب النوع</h4><table class="table table-compact"><tbody>${expByCat.map(x=>`<tr><td>${U.esc(x.name)}</td><td>${U.money(x.total)}</td></tr>`).join('')}</tbody></table>` : ''}
    </div>

    <div class="card">
      <div class="card-header-row"><h3>تقرير المرضى</h3>
        <button class="btn btn-sm" data-exp="patients">تصدير Excel</button></div>
      <div class="summary-cards">
        <div class="stat-card"><div class="stat-label">إجمالي المرضى</div><div class="stat-value">${patients.filter(p=>!p.isDeleted).length}</div></div>
        <div class="stat-card"><div class="stat-label">مرضى جدد بالفترة</div><div class="stat-value">${rPatients.length}</div></div>
        <div class="stat-card"><div class="stat-label">مرضى لهم زيارات بالفترة</div><div class="stat-value">${returningPatients}</div></div>
      </div>
    </div>

    <div class="card">
      <div class="card-header-row"><h3>تقرير الخدمات</h3>
        <button class="btn btn-sm" data-exp="services">تصدير Excel</button></div>
      <table class="table table-compact"><thead><tr><th>الخدمة</th><th>عدد المرات</th><th>الإيراد</th><th>متوسط السعر الفعلي</th><th>أعلى سعر</th><th>أقل سعر</th></tr></thead>
        <tbody>${svcRows.map(([name,d]) => `<tr><td>${U.esc(name)}</td><td>${d.count}</td><td>${U.money(d.revenue)}</td><td>${U.money(d.revenue/d.count)}</td><td>${U.money(d.max)}</td><td>${U.money(d.min)}</td></tr>`).join('') || `<tr><td colspan="6" class="empty-cell">لا توجد بيانات</td></tr>`}</tbody>
      </table>
    </div>

    <div class="card">
      <div class="card-header-row"><h3>تقرير المواعيد</h3>
        <button class="btn btn-sm" data-exp="appointments">تصدير Excel</button></div>
      <div class="summary-cards">
        <div class="stat-card"><div class="stat-label">إجمالي المواعيد</div><div class="stat-value">${rAppts.length}</div></div>
        <div class="stat-card"><div class="stat-label">تم الكشف</div><div class="stat-value stat-good">${apptDone}</div></div>
        <div class="stat-card"><div class="stat-label">ملغي</div><div class="stat-value stat-bad">${apptCancelled}</div></div>
        <div class="stat-card"><div class="stat-label">لم يحضر</div><div class="stat-value stat-bad">${apptNoShow}</div></div>
      </div>
    </div>

    <div class="card">
      <div class="card-header-row"><h3>تقرير الروشتات وخطط العلاج</h3>
        <button class="btn btn-sm" data-exp="rxplans">تصدير Excel</button></div>
      <div class="summary-cards">
        <div class="stat-card"><div class="stat-label">روشتات بالفترة</div><div class="stat-value">${rPrescriptions.length}</div></div>
        <div class="stat-card"><div class="stat-label">إجمالي خطط العلاج</div><div class="stat-value">${U.money(planTotal)}</div></div>
        <div class="stat-card"><div class="stat-label">المكتمل من الخطة</div><div class="stat-value stat-good">${U.money(planDone)}</div></div>
      </div>
    </div>

    <div style="margin:16px 0;display:flex;gap:10px">
      <button class="btn btn-primary" id="export-full-report">تصدير التقرير الكامل (كل الشيتات)</button>
      <button class="btn" id="export-ledger-report">تصدير كشف حسابات المرضى (بنفس شكل شيت العيادة)</button>
    </div>
  `;

  const patientMap = Object.fromEntries(patients.map(p=>[p.id,p]));
  out.querySelectorAll('[data-exp]').forEach(b => b.addEventListener('click', () => {
    const kind = b.dataset.exp;
    if (kind === 'financial') U.exportToExcel([
      { name: 'الإيرادات', rows: rPayments.map(p => ({'التاريخ':U.fmtDate(p.date),'المريض':(patientMap[p.patientId]||{}).fullName||'','المبلغ':p.amount,'الطريقة':p.method})) },
      { name: 'المصروفات المدفوعة', rows: rExpenses.map(e => ({'التاريخ':U.fmtDate(expenseEffectiveDate(e)),'البيان':e.description||'','المبلغ':e.amount})) },
      { name: 'الديون المفتوحة حاليًا', rows: expenses.filter(e=>!isExpensePaid(e)).map(e => ({'تاريخ التسجيل':U.fmtDate(e.date),'البيان':e.description||'','المبلغ':e.amount})) },
    ], 'تقرير_مالي.xlsx');
    if (kind === 'patients') U.exportToExcel([{ name: 'المرضى', rows: rPatients.map(p => ({'رقم الملف':p.fileNumber,'الاسم':p.fullName,'الموبايل':p.phone,'تاريخ التسجيل':U.fmtDate((p.createdAt||'').slice(0,10))})) }], 'تقرير_المرضى.xlsx');
    if (kind === 'services') U.exportToExcel([{ name: 'الخدمات', rows: svcRows.map(([name,d]) => ({'الخدمة':name,'عدد المرات':d.count,'الإيراد':d.revenue,'متوسط السعر الفعلي':Math.round((d.revenue/d.count)*100)/100,'أعلى سعر':d.max,'أقل سعر':d.min})) }], 'تقرير_الخدمات.xlsx');
    if (kind === 'appointments') U.exportToExcel([{ name: 'المواعيد', rows: rAppts.map(a => ({'التاريخ':U.fmtDate(a.date),'الوقت':a.time,'المريض':(patientMap[a.patientId]||{}).fullName||'','الحالة':a.status})) }], 'تقرير_المواعيد.xlsx');
    if (kind === 'rxplans') U.exportToExcel([
      { name: 'الروشتات', rows: rPrescriptions.map(r => ({'التاريخ':U.fmtDate(r.date),'رقم الروشتة':r.prescriptionNumber,'المريض':(patientMap[r.patientId]||{}).fullName||''})) },
      { name: 'خطط العلاج', rows: plans.map(p => ({'المريض':(patientMap[p.patientId]||{}).fullName||'','العلاج':p.treatment,'السعر':p.price,'الحالة':p.status})) },
    ], 'تقرير_الروشتات_والخطط.xlsx');
  }));
  out.querySelector('#export-full-report').addEventListener('click', () => {
    U.exportToExcel([
      { name: 'الإيرادات', rows: rPayments.map(p => ({'التاريخ':U.fmtDate(p.date),'المريض':(patientMap[p.patientId]||{}).fullName||'','المبلغ':p.amount,'الطريقة':p.method})) },
      { name: 'المصروفات المدفوعة', rows: rExpenses.map(e => ({'التاريخ':U.fmtDate(expenseEffectiveDate(e)),'البيان':e.description||'','المبلغ':e.amount})) },
      { name: 'الديون المفتوحة حاليًا', rows: expenses.filter(e=>!isExpensePaid(e)).map(e => ({'تاريخ التسجيل':U.fmtDate(e.date),'البيان':e.description||'','المبلغ':e.amount})) },
      { name: 'المرضى', rows: rPatients.map(p => ({'رقم الملف':p.fileNumber,'الاسم':p.fullName,'الموبايل':p.phone})) },
      { name: 'الخدمات', rows: svcRows.map(([name,d]) => ({'الخدمة':name,'عدد المرات':d.count,'الإيراد':d.revenue})) },
      { name: 'المواعيد', rows: rAppts.map(a => ({'التاريخ':U.fmtDate(a.date),'المريض':(patientMap[a.patientId]||{}).fullName||'','الحالة':a.status})) },
    ], `تقرير_شامل_${from}_${to}.xlsx`);
  });
  out.querySelector('#export-ledger-report').addEventListener('click', () => exportPatientLedgerExcel(from, to));
}

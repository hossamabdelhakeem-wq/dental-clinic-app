/* =========================================================
   dashboard.js — لوحة التحكم
   ========================================================= */

Views.dashboard = async function(main) {
  const [patients, visits, payments, expenses, appointments, services] = await Promise.all([
    DB.all('patients'), DB.all('visits'), DB.all('payments'), DB.all('expenses'), DB.all('appointments'), DB.all('services'),
  ]);
  const today = U.todayISO();
  const activePatients = patients.filter(p => !p.isDeleted);
  const activeVisits = visits.filter(v => !v.isDeleted);

  const todayAppts = appointments.filter(a => a.date === today);
  const todayCompleted = activeVisits.filter(v => v.date === today);
  const todayNewPatients = activePatients.filter(p => (p.createdAt||'').slice(0,10) === today);
  const todayRevenue = payments.filter(p => p.date === today).reduce((s,p)=>s+Number(p.amount),0);
  const todayExpenses = expenses.filter(e => isExpensePaid(e) && expenseEffectiveDate(e) === today).reduce((s,e)=>s+Number(e.amount),0);

  const monthStr = today.slice(0,7);
  const monthPatients = activePatients.filter(p => (p.createdAt||'').slice(0,7) === monthStr);
  const monthVisits = activeVisits.filter(v => v.date.slice(0,7) === monthStr);
  const monthRevenue = payments.filter(p => p.date.slice(0,7) === monthStr).reduce((s,p)=>s+Number(p.amount),0);
  const monthExpenses = expenses.filter(e => isExpensePaid(e) && (expenseEffectiveDate(e)||'').slice(0,7) === monthStr).reduce((s,e)=>s+Number(e.amount),0);
  const outstandingDebt = expenses.filter(e => !isExpensePaid(e)).reduce((s,e)=>s+Number(e.amount||0),0);
  const outstanding = activeVisits.reduce((s,v)=>s+Number(v.remaining||0),0);

  // last 14 days revenue
  const days = [...Array(14)].map((_,i) => { const d = new Date(); d.setDate(d.getDate() - (13-i)); return U.isoLocal(d); });
  const revenueByDay = days.map(d => payments.filter(p => p.date === d).reduce((s,p)=>s+Number(p.amount),0));

  // expenses by category (this month)
  const expCats = await DB.all('expenseCategories');
  const expByCat = expCats.map(c => ({ name: c.name, total: expenses.filter(e => isExpensePaid(e) && e.categoryId===c.id && (expenseEffectiveDate(e)||'').slice(0,7)===monthStr).reduce((s,e)=>s+Number(e.amount),0) })).filter(x=>x.total>0);

  // most used services (this month)
  const allVS = await DB.all('visitServices');
  const monthVisitIds = new Set(monthVisits.map(v=>v.id));
  const svcCounts = {};
  allVS.filter(vs => monthVisitIds.has(vs.visitId)).forEach(vs => { svcCounts[vs.serviceName] = (svcCounts[vs.serviceName]||0)+1; });
  const topServices = Object.entries(svcCounts).sort((a,b)=>b[1]-a[1]).slice(0,6);

  main.innerHTML = `
    <div class="page-header"><h2>لوحة التحكم</h2></div>

    <h3 class="section-title">اليوم</h3>
    <div class="summary-cards">
      <div class="stat-card"><div class="stat-label">عدد مواعيد اليوم</div><div class="stat-value">${todayAppts.length}</div></div>
      <div class="stat-card"><div class="stat-label">زيارات مكتملة</div><div class="stat-value">${todayCompleted.length}</div></div>
      <div class="stat-card"><div class="stat-label">مرضى جدد</div><div class="stat-value">${todayNewPatients.length}</div></div>
      <div class="stat-card"><div class="stat-label">إيرادات اليوم</div><div class="stat-value stat-good">${U.money(todayRevenue)}</div></div>
      <div class="stat-card"><div class="stat-label">مصروفات اليوم</div><div class="stat-value stat-bad">${U.money(todayExpenses)}</div></div>
      <div class="stat-card"><div class="stat-label">صافي دخل اليوم</div><div class="stat-value">${U.money(todayRevenue-todayExpenses)}</div></div>
    </div>

    <h3 class="section-title">هذا الشهر</h3>
    <div class="summary-cards">
      <div class="stat-card"><div class="stat-label">إجمالي المرضى</div><div class="stat-value">${activePatients.length}</div></div>
      <div class="stat-card"><div class="stat-label">مرضى جدد هذا الشهر</div><div class="stat-value">${monthPatients.length}</div></div>
      <div class="stat-card"><div class="stat-label">عدد الزيارات</div><div class="stat-value">${monthVisits.length}</div></div>
      <div class="stat-card"><div class="stat-label">إيرادات الشهر</div><div class="stat-value stat-good">${U.money(monthRevenue)}</div></div>
      <div class="stat-card"><div class="stat-label">مصروفات الشهر</div><div class="stat-value stat-bad">${U.money(monthExpenses)}</div></div>
      <div class="stat-card"><div class="stat-label">صافي أرباح الشهر</div><div class="stat-value">${U.money(monthRevenue-monthExpenses)}</div></div>
      <div class="stat-card"><div class="stat-label">المبالغ المستحقة</div><div class="stat-value stat-bad">${U.money(outstanding)}</div></div>
      <div class="stat-card"><div class="stat-label">ديون على العيادة (موردين/معامل)</div><div class="stat-value stat-bad">${U.money(outstandingDebt)}</div></div>
    </div>

    <div class="two-col">
      <div class="card">
        <h3>الإيرادات - آخر 14 يومًا</h3>
        ${barChart(days.map(d=>U.fmtDate(d).slice(0,5)), revenueByDay)}
      </div>
      <div class="card">
        <h3>المصروفات حسب النوع (هذا الشهر)</h3>
        ${expByCat.length ? barChart(expByCat.map(x=>x.name), expByCat.map(x=>x.total)) : '<div class="empty-cell">لا توجد مصروفات هذا الشهر</div>'}
      </div>
    </div>
    <div class="two-col">
      <div class="card">
        <h3>الخدمات الأكثر طلبًا (هذا الشهر)</h3>
        ${topServices.length ? `<table class="table table-compact"><tbody>${topServices.map(([name,count]) => `<tr><td>${U.esc(name)}</td><td>${count}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-cell">لا توجد بيانات</div>'}
      </div>
      <div class="card">
        <h3>وصول سريع</h3>
        <div class="stack-btns">
          <a class="btn" href="#appointments">عرض المواعيد</a>
          <a class="btn" href="#reports">التقارير التفصيلية</a>
          <a class="btn" href="#backup">نسخة احتياطية</a>
        </div>
      </div>
    </div>
  `;
};

function barChart(labels, values) {
  const w = 560, h = 200, pad = 30;
  const max = Math.max(1, ...values);
  const barW = (w - pad*2) / values.length * 0.7;
  const gap = (w - pad*2) / values.length;
  const bars = values.map((v,i) => {
    const bh = max ? (v/max) * (h - pad*2) : 0;
    const x = pad + i*gap + (gap-barW)/2;
    const y = h - pad - bh;
    return `<rect x="${x}" y="${y}" width="${barW}" height="${bh}" rx="3" fill="var(--accent)"></rect>
      <text x="${x+barW/2}" y="${h-10}" text-anchor="middle" font-size="9" fill="var(--muted)">${U.esc(String(labels[i]))}</text>
      ${v>0?`<text x="${x+barW/2}" y="${y-4}" text-anchor="middle" font-size="9" fill="var(--text)">${Math.round(v)}</text>`:''}`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" class="chart-svg">${bars}</svg>`;
}

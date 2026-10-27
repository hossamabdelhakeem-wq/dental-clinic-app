/* =========================================================
   dashboard.js — لوحة التحكم
   ========================================================= */

const DASH = { mode: 'day', day: null, month: null };

Views.dashboard = async function(main) {
  const [patients, visits, payments, expenses, appointments, allVS, expCats] = await Promise.all([
    DB.all('patients'), DB.all('visits'), DB.all('payments'), DB.all('expenses'), DB.all('appointments'), DB.all('visitServices'), DB.all('expenseCategories'),
  ]);
  if (!DASH.day) { DASH.day = U.todayISO(); DASH.month = DASH.day.slice(0, 7); }
  const isDay = DASH.mode === 'day';
  const inP = (d) => !!d && (isDay ? d === DASH.day : d.slice(0, 7) === DASH.month);
  const activePatients = patients.filter(p => !p.isDeleted);
  const activeVisits = visits.filter(v => !v.isDeleted);
  const pAppts = appointments.filter(a => inP(a.date));
  const pVisits = activeVisits.filter(v => inP(v.date));
  const pNew = activePatients.filter(p => inP((p.createdAt || '').slice(0, 10)));
  const revenue = payments.filter(p => inP(p.date)).reduce((s, p) => s + Number(p.amount), 0);
  const pExp = expenses.filter(e => isExpensePaid(e) && inP(expenseEffectiveDate(e)));
  const expTotal = pExp.reduce((s, e) => s + Number(e.amount), 0);
  const outstanding = activeVisits.reduce((s, v) => s + Number(v.remaining || 0), 0);
  const outstandingDebt = expenses.filter(e => !isExpensePaid(e)).reduce((s, e) => s + Number(e.amount || 0), 0);
  const expByCat = expCats.map(c => ({ name: c.name, total: pExp.filter(e => e.categoryId === c.id).reduce((s, e) => s + Number(e.amount), 0) })).filter(x => x.total > 0);
  const vIds = new Set(pVisits.map(v => v.id));
  const svcCounts = {};
  allVS.filter(vs => vIds.has(vs.visitId)).forEach(vs => { svcCounts[vs.serviceName] = (svcCounts[vs.serviceName] || 0) + 1; });
  const topServices = Object.entries(svcCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  // الإيرادات: يوم مختار => آخر 14 يوم حتى اليوم ده، شهر مختار => أيام الشهر كلها
  const payByDate = {}; payments.forEach(p => { payByDate[p.date] = (payByDate[p.date] || 0) + Number(p.amount); });
  let days;
  if (isDay) { const [y, m, d] = DASH.day.split('-').map(Number); days = [...Array(14)].map((_, i) => U.isoLocal(new Date(y, m - 1, d - (13 - i)))); }
  else { const [y, m] = DASH.month.split('-').map(Number); days = [...Array(new Date(y, m, 0).getDate())].map((_, i) => `${DASH.month}-${String(i + 1).padStart(2, '0')}`); }
  const monthLabel = (() => { const [y, m] = DASH.month.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' }); })();
  const label = isDay ? U.fmtDate(DASH.day) : monthLabel;
  const card = (l, v, cls) => `<div class="stat-card"><div class="stat-label">${l}</div><div class="stat-value ${cls || ''}">${v}</div></div>`;

  main.innerHTML = `
    <div class="page-header"><h2>لوحة التحكم</h2>
      <div class="page-actions">
        <div class="seg-control" id="dash-mode">
          <button data-m="day" class="${isDay ? 'active' : ''}">يومي</button><button data-m="month" class="${isDay ? '' : 'active'}">شهري</button>
        </div>
        ${isDay ? `<input type="date" id="dash-date" class="input" value="${DASH.day}">` : `<input type="month" id="dash-month" class="input" value="${DASH.month}">`}
        <button class="btn" id="dash-today">${isDay ? 'اليوم' : 'هذا الشهر'}</button>
      </div>
    </div>

    <h3 class="section-title">${isDay ? 'اليوم' : 'الشهر'}: ${label}</h3>
    <div class="summary-cards">
      ${card('عدد المواعيد', pAppts.length)}${card('عدد الزيارات', pVisits.length)}${card('مرضى جدد', pNew.length)}
      ${card('الإيرادات', U.money(revenue), 'stat-good')}${card('المصروفات', U.money(expTotal), 'stat-bad')}${card('صافي الربح', U.money(revenue - expTotal))}
    </div>
    <h3 class="section-title">الوضع الحالي (مش مرتبط بالفترة)</h3>
    <div class="summary-cards">
      ${card('إجمالي المرضى', activePatients.length)}${card('المبالغ المستحقة', U.money(outstanding), 'stat-bad')}${card('ديون على العيادة (موردين/معامل)', U.money(outstandingDebt), 'stat-bad')}
    </div>

    <div class="two-col">
      <div class="card">
        <h3>${isDay ? 'الإيرادات - آخر 14 يومًا حتى ' + label : 'الإيرادات اليومية - ' + label}</h3>
        ${barChart(days.map(d => U.fmtDate(d).slice(0, 5)), days.map(d => payByDate[d] || 0))}
      </div>
      <div class="card">
        <h3>المصروفات حسب النوع (${label})</h3>
        ${expByCat.length ? barChart(expByCat.map(x => x.name), expByCat.map(x => x.total)) : '<div class="empty-cell">لا توجد مصروفات في هذه الفترة</div>'}
      </div>
    </div>
    <div class="two-col">
      <div class="card">
        <h3>الخدمات الأكثر طلبًا (${label})</h3>
        ${topServices.length ? `<table class="table table-compact"><tbody>${topServices.map(([name, count]) => `<tr><td>${U.esc(name)}</td><td>${count}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-cell">لا توجد بيانات</div>'}
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
  main.querySelectorAll('#dash-mode button').forEach(b => b.addEventListener('click', () => { DASH.mode = b.dataset.m; Views.dashboard(main); }));
  const di = main.querySelector('#dash-date'), mi = main.querySelector('#dash-month');
  if (di) di.addEventListener('change', () => { if (di.value) { DASH.day = di.value; DASH.month = di.value.slice(0, 7); Views.dashboard(main); } });
  if (mi) mi.addEventListener('change', () => { if (mi.value) { DASH.month = mi.value; Views.dashboard(main); } });
  main.querySelector('#dash-today').addEventListener('click', () => { DASH.day = U.todayISO(); DASH.month = DASH.day.slice(0, 7); Views.dashboard(main); });
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

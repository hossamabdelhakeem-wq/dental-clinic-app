/* =========================================================
   dashboard.js — لوحة التحكم
   ========================================================= */

/* ===== تذكير تنظيف الجير: أي خدمة اسمها فيه "جير" أو "تنظيف" بتعتبر تنظيف ===== */
const normAr = (s) => String(s || '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
const isDescaleName = (n) => { const t = normAr(n); return t.includes('جير') || t.includes('تنظيف'); };
function addMonthsISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(y, m - 1 + n, 1); const dim = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(d, dim)); return U.isoLocal(t);
}
function monthsBetween(a, b) {
  const [ya, ma, da] = a.split('-').map(Number), [yb, mb, db] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma) - (db < da ? 1 : 0);
}
/* آخر تنظيف لكل مريض (من زياراته الفعلية)، ومحتاج تذكير لو عدّى أكتر من 6 شهور ومحدش اتواصل معاه عن نفس الدورة.
   لما يتسجل تنظيف جديد، التاريخ بيتغيّر والدورة بتبدأ من جديد تلقائيًا. */
function computeDescale(patients, visits, vsv, today) {
  const cleanVisits = new Set(vsv.filter(l => isDescaleName(l.serviceName)).map(l => l.visitId));
  const last = {};
  visits.forEach(v => { if (!v.isDeleted && cleanVisits.has(v.id) && v.date <= today && (!last[v.patientId] || v.date > last[v.patientId])) last[v.patientId] = v.date; });
  const due = [], contacted = [];
  patients.forEach(p => {
    const ld = last[p.id]; if (p.isDeleted || !ld) return;
    if (p.descaleContactedFor === ld) { contacted.push({ p, last: ld, at: p.descaleContactedAt }); return; }
    if (today > addMonthsISO(ld, 6)) due.push({ p, last: ld });
  });
  due.sort((a, b) => a.last.localeCompare(b.last));
  contacted.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  return { due, contacted };
}

const DASH = { mode: 'day', day: null, month: null, descaleAll: false, descaleContacted: false };

Views.dashboard = async function(main) {
  const [patients, visits, payments, expenses, appointments, allVS, expCats, statuses] = await Promise.all([
    DB.all('patients'), DB.all('visits'), DB.all('payments'), DB.all('expenses'), DB.all('appointments'), DB.all('visitServices'), DB.all('expenseCategories'), DB.all('appointmentStatuses'),
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
  const patById = Object.fromEntries(patients.map(p => [p.id, p]));
  const clinic = (APP_STATE.clinicInfo && APP_STATE.clinicInfo.name) || 'العيادة';
  const agendaDay = isDay ? DASH.day : U.todayISO();
  const byTime = (a, b) => (a.time || '').localeCompare(b.time || '');
  const agenda = appointments.filter(a => a.date === agendaDay).sort(byTime);
  const now = new Date(); const tomorrow = U.isoLocal(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const tmr = appointments.filter(a => a.date === tomorrow && a.status !== 'ملغي').sort(byTime);
  const quick = ['وصل', 'تم الكشف', 'لم يحضر'].filter(n => statuses.some(s => s.name === n));
  const canAppt = canDo('appointments'), canVisit = canDo('visits');
  const today = U.todayISO(), canPat = canDo('patients');
  const ds = computeDescale(patients, visits, allVS, today);
  const dsRow = (x) => { const p = x.p; return `<tr><td><a href="#patients/${p.id}">${U.esc(p.fullName)}</a></td><td>${U.esc(p.phone || '')}</td><td>${U.fmtDate(x.last)}</td><td>${monthsBetween(x.last, today)} شهر</td>
    <td style="white-space:nowrap">${canPat ? `${p.phone ? `<button class="btn btn-sm" data-wa="${U.esc(U.waLink(p.phone, `السلام عليكم ${p.fullName}، عدّى أكتر من 6 شهور على آخر تنظيف جير لحضرتك عندنا في ${clinic} (${U.fmtDate(x.last)}). تنظيف الجير كل 6 شهور بيحافظ على صحة اللثة والأسنان. تحب نحجزلك موعد؟`))}">واتساب</button> ` : ''}<button class="btn btn-sm btn-primary" data-ds-done="${p.id}">تم التواصل</button>` : ''}</td></tr>`; };
  const descaleHTML = (ds.due.length || ds.contacted.length) ? `
    <div class="card" id="descale-card">
      <h3>🦷 تذكير تنظيف الجير — عدّى أكتر من 6 شهور (${ds.due.length})</h3>
      ${ds.due.length ? `<div class="table-wrap"><table class="table table-compact"><thead><tr><th>المريض</th><th>الموبايل</th><th>آخر تنظيف</th><th>من</th><th></th></tr></thead>
        <tbody>${(DASH.descaleAll ? ds.due : ds.due.slice(0, 8)).map(dsRow).join('')}</tbody></table></div>
        ${ds.due.length > 8 ? `<p><button class="btn btn-sm" id="ds-toggle-all">${DASH.descaleAll ? 'عرض أقل' : `عرض الكل (${ds.due.length})`}</button></p>` : ''}` : '<div class="empty-cell">مفيش مرضى محتاجين تذكير دلوقتي 🎉</div>'}
      ${ds.contacted.length ? `<p><button class="btn btn-sm" id="ds-toggle-contacted">${DASH.descaleContacted ? 'إخفاء' : 'اللي اتواصلنا معاهم'} (${ds.contacted.length})</button></p>
        ${DASH.descaleContacted ? `<div class="table-wrap"><table class="table table-compact"><thead><tr><th>المريض</th><th>آخر تنظيف</th><th>تاريخ التواصل</th><th></th></tr></thead>
          <tbody>${ds.contacted.map(x => `<tr><td><a href="#patients/${x.p.id}">${U.esc(x.p.fullName)}</a></td><td>${U.fmtDate(x.last)}</td><td>${x.at ? U.fmtDate(x.at) : ''}</td><td>${canPat ? `<button class="btn btn-sm" data-ds-undo="${x.p.id}">تراجع</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}` : ''}
    </div>` : '';
  const card = (l, v, cls, ico, kind) => `<div class="stat-card ${kind || ''}">${ico ? `<div class="stat-ico">${ico}</div>` : ''}<div class="stat-label">${l}</div><div class="stat-value ${cls || ''}">${v}</div></div>`;

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
    <div class="summary-cards cols-3">
      ${card('الإيرادات', U.money(revenue), 'stat-good', '💰', 'kpi kpi-good')}${card('المصروفات', U.money(expTotal), 'stat-bad', '🧾', 'kpi kpi-bad')}${card('صافي الربح', U.money(revenue - expTotal), '', '📈', 'kpi kpi-net')}
    </div>
    <div class="summary-cards cols-3">
      ${card('عدد المواعيد', pAppts.length, '', '📅')}${card('عدد الزيارات', pVisits.length, '', '🦷')}${card('مرضى جدد', pNew.length, '', '👤')}
    </div>
    <h3 class="section-title">الوضع الحالي (مش مرتبط بالفترة)</h3>
    <div class="summary-cards cols-3">
      ${card('إجمالي المرضى', activePatients.length, '', '👥')}${card('المبالغ المستحقة', U.money(outstanding), 'stat-bad', '📋')}${card('ديون على العيادة (موردين/معامل)', U.money(outstandingDebt), 'stat-bad', '🏷️')}
    </div>

    <div class="two-col agenda-row">
      <div class="card">
        <h3>جدول ${agendaDay === U.todayISO() ? 'اليوم' : U.fmtDate(agendaDay)} (${agenda.length})</h3>
        <div class="table-wrap"><table class="table table-compact"><tbody>${agenda.map(a => `<tr>
          <td>${U.esc(a.time || '')}</td><td>${U.esc((patById[a.patientId] || {}).fullName || '')}</td><td>${U.esc(a.status || '')}</td>
          <td style="white-space:nowrap">${canAppt ? quick.filter(n => n !== a.status).map(n => `<button class="btn btn-sm" data-ag-st="${a.id}" data-st="${U.esc(n)}">${n}</button>`).join(' ') : ''}
            ${canVisit ? `<button class="btn btn-sm btn-primary" data-ag-visit="${a.id}">زيارة</button>` : ''}</td></tr>`).join('') || '<tr><td class="empty-cell">لا توجد مواعيد</td></tr>'}</tbody></table></div>
      </div>
      <div class="card">
        <h3>تذكير مواعيد بكرة (${tmr.length})</h3>
        <div class="table-wrap"><table class="table table-compact"><tbody>${tmr.map(a => { const p = patById[a.patientId] || {}; return `<tr>
          <td>${U.esc(a.time || '')}</td><td>${U.esc(p.fullName || '')}</td>
          <td>${p.phone ? `<button class="btn btn-sm" data-wa="${U.esc(U.waLink(p.phone, `السلام عليكم ${p.fullName}، تذكير بموعدك في ${clinic} غدًا ${U.fmtDate(tomorrow)} الساعة ${a.time}. برجاء التأكيد.`))}">واتساب</button>` : '<span class="muted-sm">بدون رقم</span>'}</td></tr>`; }).join('') || '<tr><td class="empty-cell">لا توجد مواعيد بكرة</td></tr>'}</tbody></table></div>
      </div>
    </div>
    ${descaleHTML}
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
  main.querySelectorAll('[data-ag-st]').forEach(b => b.addEventListener('click', async () => {
    const a = appointments.find(x => x.id === Number(b.dataset.agSt));
    await DB.put('appointments', { ...a, status: b.dataset.st }); Views.dashboard(main);
  }));
  main.querySelectorAll('[data-ag-visit]').forEach(b => b.addEventListener('click', () => {
    const a = appointments.find(x => x.id === Number(b.dataset.agVisit));
    Views.openNewVisitModal(a.patientId, { appointmentId: a.id, visitType: a.visitType });
  }));
  main.querySelectorAll('[data-wa]').forEach(b => b.addEventListener('click', () => window.open(b.dataset.wa, '_blank')));
  const dsPatch = async (pid, patch) => { const p = patients.find(x => x.id === pid); await DB.put('patients', { ...p, ...patch }); Views.dashboard(main); };
  main.querySelectorAll('[data-ds-done]').forEach(b => b.addEventListener('click', () => {
    const x = ds.due.find(y => y.p.id === Number(b.dataset.dsDone));
    dsPatch(x.p.id, { descaleContactedFor: x.last, descaleContactedAt: today }); U.toast('اتسجل إنه تم التواصل');
  }));
  main.querySelectorAll('[data-ds-undo]').forEach(b => b.addEventListener('click', () => dsPatch(Number(b.dataset.dsUndo), { descaleContactedFor: null, descaleContactedAt: null })));
  const dsAll = main.querySelector('#ds-toggle-all'); if (dsAll) dsAll.addEventListener('click', () => { DASH.descaleAll = !DASH.descaleAll; Views.dashboard(main); });
  const dsCon = main.querySelector('#ds-toggle-contacted'); if (dsCon) dsCon.addEventListener('click', () => { DASH.descaleContacted = !DASH.descaleContacted; Views.dashboard(main); });
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

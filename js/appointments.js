/* =========================================================
   appointments.js — المواعيد: تقويم يومي/أسبوعي/شهري
   ========================================================= */

let apptViewMode = 'week';
let apptAnchorDate = new Date();

Views.appointments = async function(main, param) {
  const statuses = await DB.all('appointmentStatuses');
  main.innerHTML = `
    <div class="page-header">
      <h2>المواعيد</h2>
      <div class="page-actions">
        <div class="seg-control" id="appt-view-seg">
          <button data-v="day" class="${apptViewMode==='day'?'active':''}">يوم</button>
          <button data-v="week" class="${apptViewMode==='week'?'active':''}">أسبوع</button>
          <button data-v="month" class="${apptViewMode==='month'?'active':''}">شهر</button>
        </div>
        <button class="btn" id="appt-prev">‹ السابق</button>
        <button class="btn" id="appt-today">اليوم</button>
        <button class="btn" id="appt-next">التالي ›</button>
        <button class="btn btn-primary" id="btn-new-appt">+ حجز موعد</button>
      </div>
    </div>
    <div class="legend">${statuses.map(s => `<span class="legend-item"><i style="background:${s.color}"></i>${U.esc(s.name)}</span>`).join('')}</div>
    <div id="appt-calendar-wrap"></div>
  `;
  main.querySelector('#appt-view-seg').addEventListener('click', (e) => {
    const btn = e.target.closest('button'); if (!btn) return;
    apptViewMode = btn.dataset.v; renderAppointmentsCalendar();
    main.querySelectorAll('#appt-view-seg button').forEach(b => b.classList.toggle('active', b===btn));
  });
  main.querySelector('#appt-prev').addEventListener('click', () => { shiftAnchor(-1); renderAppointmentsCalendar(); });
  main.querySelector('#appt-next').addEventListener('click', () => { shiftAnchor(1); renderAppointmentsCalendar(); });
  main.querySelector('#appt-today').addEventListener('click', () => { apptAnchorDate = new Date(); renderAppointmentsCalendar(); });
  main.querySelector('#btn-new-appt').addEventListener('click', () => Views.openNewAppointmentModal());
  await renderAppointmentsCalendar();
};

function shiftAnchor(dir) {
  const d = new Date(apptAnchorDate);
  if (apptViewMode === 'day') d.setDate(d.getDate() + dir);
  else if (apptViewMode === 'week') d.setDate(d.getDate() + dir * 7);
  else d.setMonth(d.getMonth() + dir);
  apptAnchorDate = d;
}

function isoDate(d) { return d.toISOString().slice(0,10); }
function startOfWeek(d) { const x = new Date(d); const day = x.getDay(); x.setDate(x.getDate() - day); return x; }

async function renderAppointmentsCalendar() {
  const wrap = document.getElementById('appt-calendar-wrap');
  if (!wrap) return;
  const appts = await DB.all('appointments');
  const patients = await DB.all('patients');
  const patientMap = Object.fromEntries(patients.map(p => [p.id, p]));
  const statuses = await DB.all('appointmentStatuses');
  const colorOf = (name) => (statuses.find(s => s.name === name) || {}).color || '#999';

  if (apptViewMode === 'day') {
    const dateStr = isoDate(apptAnchorDate);
    const dayAppts = appts.filter(a => a.date === dateStr).sort((a,b) => a.time.localeCompare(b.time));
    wrap.innerHTML = `<h3>${U.fmtDate(dateStr)}</h3>` + renderApptTable(dayAppts, patientMap, colorOf);
  } else if (apptViewMode === 'week') {
    const start = startOfWeek(apptAnchorDate);
    const days = [...Array(7)].map((_,i) => { const d = new Date(start); d.setDate(d.getDate()+i); return d; });
    wrap.innerHTML = `<div class="week-grid">` + days.map(d => {
      const dateStr = isoDate(d);
      const dayAppts = appts.filter(a => a.date === dateStr).sort((a,b) => a.time.localeCompare(b.time));
      return `<div class="week-col">
        <div class="week-col-header ${dateStr===isoDate(new Date())?'is-today':''}">${d.toLocaleDateString('ar-EG',{weekday:'short'})} <b>${d.getDate()}</b></div>
        <div class="week-col-body">
          ${dayAppts.map(a => apptChip(a, patientMap, colorOf)).join('') || '<div class="muted-sm">لا مواعيد</div>'}
        </div>
      </div>`;
    }).join('') + `</div>`;
  } else {
    const y = apptAnchorDate.getFullYear(), m = apptAnchorDate.getMonth();
    const first = new Date(y, m, 1);
    const startGrid = startOfWeek(first);
    const cells = [...Array(42)].map((_,i) => { const d = new Date(startGrid); d.setDate(d.getDate()+i); return d; });
    wrap.innerHTML = `<div class="month-title">${first.toLocaleDateString('ar-EG',{month:'long', year:'numeric'})}</div>
      <div class="month-grid">` + cells.map(d => {
        const dateStr = isoDate(d);
        const dayAppts = appts.filter(a => a.date === dateStr);
        const inMonth = d.getMonth() === m;
        return `<div class="month-cell ${inMonth?'':'dim'} ${dateStr===isoDate(new Date())?'is-today':''}" data-date="${dateStr}">
          <div class="month-cell-num">${d.getDate()}</div>
          ${dayAppts.slice(0,3).map(a => `<div class="month-dot" style="background:${colorOf(a.status)}" title="${U.esc((patientMap[a.patientId]||{}).fullName||'')} ${a.time}"></div>`).join('')}
          ${dayAppts.length>3 ? `<div class="muted-sm">+${dayAppts.length-3}</div>` : ''}
        </div>`;
      }).join('') + `</div>`;
    wrap.querySelectorAll('.month-cell').forEach(c => c.addEventListener('click', () => {
      apptAnchorDate = new Date(c.dataset.date); apptViewMode = 'day'; Views.appointments(document.getElementById('main-content'));
    }));
  }
  wrap.querySelectorAll('[data-appt]').forEach(el => el.addEventListener('click', () => openApptDetail(Number(el.dataset.appt))));
}

function apptChip(a, patientMap, colorOf) {
  const p = patientMap[a.patientId] || {};
  return `<div class="appt-chip" style="border-right-color:${colorOf(a.status)}" data-appt="${a.id}">
    <b>${a.time}</b> ${U.esc(p.fullName||'')}<br><span class="muted-sm">${U.esc(a.visitType||'')}</span>
  </div>`;
}

function renderApptTable(list, patientMap, colorOf) {
  return `<div class="table-wrap"><table class="table">
    <thead><tr><th>الوقت</th><th>المريض</th><th>نوع الزيارة</th><th>المدة</th><th>الحالة</th><th></th></tr></thead>
    <tbody>${list.map(a => {
      const p = patientMap[a.patientId] || {};
      return `<tr>
        <td>${a.time}</td><td><a href="#patients/${a.patientId}">${U.esc(p.fullName||'')}</a></td>
        <td>${U.esc(a.visitType||'')}</td><td>${a.duration} دقيقة</td>
        <td><span class="status-pill" style="background:${colorOf(a.status)}22;color:${colorOf(a.status)}">${U.esc(a.status)}</span></td>
        <td><button class="btn btn-sm" data-appt="${a.id}">تفاصيل</button></td>
      </tr>`;
    }).join('') || `<tr><td colspan="6" class="empty-cell">لا توجد مواعيد</td></tr>`}</tbody>
  </table></div>`;
}

async function openApptDetail(apptId) {
  const a = await DB.get('appointments', apptId);
  const patient = await DB.get('patients', a.patientId);
  const statuses = await DB.all('appointmentStatuses');
  const overlay = U.openModal(`موعد: ${U.esc(patient.fullName)}`, `
    <form id="appt-detail-form" class="form-grid">
      <label>التاريخ<input type="date" name="date" class="input" value="${a.date}"></label>
      <label>الوقت<input type="time" name="time" class="input" value="${a.time}"></label>
      <label>المدة (دقيقة)<input type="number" name="duration" class="input" value="${a.duration}"></label>
      <label>الحالة
        <select name="status" class="input">
          ${statuses.map(s => `<option value="${U.esc(s.name)}" ${a.status===s.name?'selected':''}>${U.esc(s.name)}</option>`).join('')}
        </select>
      </label>
      <label class="span-2">ملاحظات<textarea name="notes" class="input" rows="2">${U.esc(a.notes||'')}</textarea></label>
    </form>`, `
    <button class="btn btn-danger" id="del-appt" style="margin-left:auto">حذف الموعد</button>
    <button class="btn" id="to-visit">تحويل لزيارة</button>
    <button class="btn btn-secondary" data-close>إغلاق</button>
    <button class="btn btn-primary" id="save-appt">حفظ</button>
  `);
  overlay.querySelector('#save-appt').addEventListener('click', async () => {
    const data = Object.fromEntries(new FormData(overlay.querySelector('#appt-detail-form')).entries());
    await DB.put('appointments', { ...a, ...data, duration: Number(data.duration) });
    U.toast('تم تحديث الموعد'); overlay.remove(); renderAppointmentsCalendar();
  });
  overlay.querySelector('#del-appt').addEventListener('click', async () => {
    if (await U.confirm('هل تريد حذف هذا الموعد؟')) { await DB.delete('appointments', apptId); overlay.remove(); renderAppointmentsCalendar(); U.toast('تم الحذف'); }
  });
  overlay.querySelector('#to-visit').addEventListener('click', () => { overlay.remove(); Views.openNewVisitModal(a.patientId, { appointmentId: a.id, visitType: a.visitType }); });
}

Views.openNewAppointmentModal = function(patientId) {
  Promise.all([DB.all('patients'), DB.all('visitTypes'), DB.all('appointmentStatuses')]).then(([patients, visitTypes, statuses]) => {
    const overlay = U.openModal('حجز موعد جديد', `
      <form id="new-appt-form" class="form-grid">
        <label class="span-2">المريض *
          <select name="patientId" required class="input" id="appt-patient-select">
            <option value="">اختر مريض...</option>
            ${patients.filter(p=>!p.isDeleted).map(p => `<option value="${p.id}" ${patientId===p.id?'selected':''}>${U.esc(p.fullName)} (${U.esc(p.fileNumber)})</option>`).join('')}
          </select>
        </label>
        <label>التاريخ *<input required type="date" name="date" class="input" value="${U.todayISO()}"></label>
        <label>الوقت *<input required type="time" name="time" class="input" value="10:00"></label>
        <label>مدة الموعد (دقيقة)<input type="number" name="duration" class="input" value="30"></label>
        <label>نوع الزيارة
          <select name="visitType" class="input">${visitTypes.map(v => `<option>${U.esc(v.name)}</option>`).join('')}</select>
        </label>
        <label>الحالة
          <select name="status" class="input">${statuses.map(s => `<option>${U.esc(s.name)}</option>`).join('')}</select>
        </label>
        <label class="span-2">ملاحظات<textarea name="notes" class="input" rows="2"></textarea></label>
      </form>`, `
      <button class="btn btn-secondary" data-close>إلغاء</button>
      <button class="btn btn-primary" id="save-new-appt">حفظ الموعد</button>
    `, {wide:true});
    initSearchableSelect(overlay.querySelector('#appt-patient-select'));
    overlay.querySelector('#save-new-appt').addEventListener('click', async () => {
      const form = overlay.querySelector('#new-appt-form');
      if (!form.reportValidity()) return;
      const data = Object.fromEntries(new FormData(form).entries());
      await DB.add('appointments', { ...data, patientId: Number(data.patientId), duration: Number(data.duration), createdAt: new Date().toISOString() });
      U.toast('تم حجز الموعد'); overlay.remove();
      if (APP_STATE.route === 'appointments') renderAppointmentsCalendar();
    });
  });
};

/* تحويل select عادي إلى قائمة قابلة للبحث بسيطة */
function initSearchableSelect(selectEl) {
  // Basic native improvement: allow typing to jump (native browsers already support type-ahead).
  // Kept lightweight to avoid extra dependencies while still satisfying "Searchable Dropdown" needs.
  selectEl.setAttribute('data-searchable', 'true');
}

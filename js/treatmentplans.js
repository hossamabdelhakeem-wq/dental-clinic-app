/* =========================================================
   treatmentplans.js — خطط العلاج
   ========================================================= */

Views.treatmentplans = async function(main) {
  const plans = await DB.all('treatmentPlans');
  const patients = Object.fromEntries((await DB.all('patients')).map(p=>[p.id,p]));
  main.innerHTML = `
    <div class="page-header">
      <h2>خطط العلاج <span class="count-badge">${plans.length}</span></h2>
      <button class="btn btn-primary" id="btn-new-plan">+ إضافة لخطة علاج</button>
    </div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>المريض</th><th>السن</th><th>العلاج</th><th>السعر</th><th>الأولوية</th><th>الحالة</th><th></th></tr></thead>
      <tbody>${plans.map(p => `<tr>
        <td><a href="#patients/${p.patientId}">${U.esc((patients[p.patientId]||{}).fullName||'')}</a></td>
        <td>${U.esc(p.tooth||'')}</td><td>${U.esc(p.treatment)}</td><td>${U.money(p.price)}</td>
        <td>${U.esc(p.priority)}</td>
        <td><select class="input input-sm" data-status="${p.id}">
          ${['مخطط','قيد التنفيذ','مكتمل','ملغي'].map(s => `<option ${((p.status==='مكتمل'&&s==='مكتمل')||p.status===s)?'selected':''}>${s}</option>`).join('')}
        </select></td>
        <td>${!p.convertedVisitId ? `<button class="btn btn-sm" data-conv="${p.id}">تحويل لزيارة</button>` : `<a class="btn btn-sm" href="#visits/${p.convertedVisitId}">عرض الزيارة</a>`}</td>
      </tr>`).join('') || `<tr><td colspan="7" class="empty-cell">لا توجد خطط علاج</td></tr>`}</tbody>
    </table></div>`;
  main.querySelector('#btn-new-plan').addEventListener('click', () => Views.openNewTreatmentPlanModal(null, () => route()));
  main.querySelectorAll('[data-conv]').forEach(b => b.addEventListener('click', async () => {
    const plan = await DB.get('treatmentPlans', Number(b.dataset.conv));
    Views.openNewVisitModal(plan.patientId, { prefillService: plan });
  }));
  main.querySelectorAll('[data-status]').forEach(sel => sel.addEventListener('change', async () => {
    const plan = await DB.get('treatmentPlans', Number(sel.dataset.status));
    await DB.put('treatmentPlans', { ...plan, status: sel.value });
    U.toast('تم تحديث حالة العنصر');
  }));
};

Views.openNewTreatmentPlanModal = function(patientId, onSaved) {
  DB.all('patients').then(patients => {
    const overlay = U.openModal('إضافة إلى خطة العلاج', `
      <form id="plan-form" class="form-grid">
        <label class="span-2">المريض *
          <select name="patientId" required class="input" ${patientId?'disabled':''}>
            <option value="">اختر مريض...</option>
            ${patients.filter(p=>!p.isDeleted).map(p => `<option value="${p.id}" ${patientId===p.id?'selected':''}>${U.esc(p.fullName)} (${U.esc(p.fileNumber)})</option>`).join('')}
          </select>
          ${patientId?`<input type="hidden" name="patientId" value="${patientId}">`:''}
        </label>
        <label>رقم السن<input name="tooth" class="input" list="tooth-list-plan"></label>
        <datalist id="tooth-list-plan">${TOOTH_NUMBERS.map(t => `<option value="${t}">`).join('')}</datalist>
        <label>العلاج المقترح *<input required name="treatment" class="input"></label>
        <label>السعر التقديري<input type="number" name="price" class="input" value="0"></label>
        <label>الأولوية
          <select name="priority" class="input"><option>عالية</option><option selected>متوسطة</option><option>منخفضة</option></select>
        </label>
        <label class="span-2">ملاحظات<textarea name="notes" class="input" rows="2"></textarea></label>
      </form>`, `
      <button class="btn btn-secondary" data-close>إلغاء</button>
      <button class="btn btn-primary" id="save-plan-btn">حفظ</button>
    `);
    overlay.querySelector('#save-plan-btn').addEventListener('click', async () => {
      const form = overlay.querySelector('#plan-form');
      if (!form.reportValidity()) return;
      const data = Object.fromEntries(new FormData(form).entries());
      await DB.add('treatmentPlans', { ...data, patientId: Number(data.patientId), price: Number(data.price)||0, status: 'مخطط', convertedVisitId: null, createdAt: new Date().toISOString() });
      U.toast('تمت إضافة العنصر لخطة العلاج'); overlay.remove();
      if (onSaved) onSaved();
    });
  });
};

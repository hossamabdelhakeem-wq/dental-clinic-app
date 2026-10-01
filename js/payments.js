/* =========================================================
   payments.js — المدفوعات
   ========================================================= */

Views.payments = async function(main) {
  const payments = (await DB.all('payments')).sort((a,b) => b.date.localeCompare(a.date) || b.id-a.id);
  const patients = Object.fromEntries((await DB.all('patients')).map(p => [p.id, p]));
  main.innerHTML = `
    <div class="page-header">
      <h2>المدفوعات <span class="count-badge">${payments.length}</span></h2>
      <div class="page-actions">
        <button class="btn" id="btn-export-payments">تصدير Excel</button>
        <button class="btn btn-primary" id="btn-new-payment">+ تسجيل دفعة</button>
      </div>
    </div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>التاريخ</th><th>المريض</th><th>المبلغ</th><th>الطريقة</th><th>ملاحظات</th></tr></thead>
      <tbody>${payments.map(p => `<tr>
        <td>${U.fmtDate(p.date)}</td><td><a href="#patients/${p.patientId}">${U.esc((patients[p.patientId]||{}).fullName||'')}</a></td>
        <td>${U.money(p.amount)}</td><td>${U.esc(p.method)}</td><td>${U.esc(p.notes||'')}</td>
      </tr>`).join('') || `<tr><td colspan="5" class="empty-cell">لا توجد مدفوعات</td></tr>`}</tbody>
    </table></div>`;
  main.querySelector('#btn-new-payment').addEventListener('click', () => Views.openAddPaymentModal(null, null, () => route()));
  main.querySelector('#btn-export-payments').addEventListener('click', () => {
    U.exportToExcel([{ name: 'المدفوعات', rows: payments.map(p => ({
      'التاريخ': U.fmtDate(p.date), 'المريض': (patients[p.patientId]||{}).fullName||'', 'المبلغ': p.amount, 'الطريقة': p.method, 'ملاحظات': p.notes||''
    })) }], 'المدفوعات.xlsx');
  });
};

Views.openAddPaymentModal = function(patientId, visitId, onSaved) {
  Promise.all([DB.all('patients'), DB.all('paymentMethods')]).then(async ([patients, methods]) => {
    let visits = visitId ? [await DB.get('visits', visitId)] : (patientId ? await DB.byIndex('visits', 'patientId', patientId) : []);
    const overlay = U.openModal('تسجيل دفعة', `
      <form id="payment-form" class="form-grid">
        <label class="span-2">المريض *
          <select name="patientId" required class="input" id="pay-patient-select" ${patientId?'disabled':''}>
            <option value="">اختر مريض...</option>
            ${patients.filter(p=>!p.isDeleted).map(p => `<option value="${p.id}" ${patientId===p.id?'selected':''}>${U.esc(p.fullName)} (${U.esc(p.fileNumber)})</option>`).join('')}
          </select>
          ${patientId?`<input type="hidden" name="patientId" value="${patientId}">`:''}
        </label>
        <label class="span-2">الزيارة (اختياري)
          <select name="visitId" class="input" id="pay-visit-select">
            <option value="">بدون ربط بزيارة محددة</option>
            ${visits.map(v => `<option value="${v.id}" ${visitId===v.id?'selected':''}>${U.fmtDate(v.date)} — متبقي ${U.money(v.remaining)}</option>`).join('')}
          </select>
        </label>
        <label>التاريخ<input type="date" name="date" class="input" value="${U.todayISO()}"></label>
        <label>المبلغ *<input required type="number" name="amount" class="input" min="0"></label>
        <label>طريقة الدفع
          <select name="method" class="input">${methods.map(m => `<option>${U.esc(m.name)}</option>`).join('')}</select>
        </label>
        <label class="span-2">ملاحظات<input name="notes" class="input"></label>
      </form>`, `
      <button class="btn btn-secondary" data-close>إلغاء</button>
      <button class="btn btn-primary" id="save-payment-btn">حفظ الدفعة</button>
    `);
    if (!patientId) {
      overlay.querySelector('#pay-patient-select').addEventListener('change', async (e) => {
        const pid = Number(e.target.value);
        const pvisits = pid ? await DB.byIndex('visits','patientId',pid) : [];
        overlay.querySelector('#pay-visit-select').innerHTML = `<option value="">بدون ربط بزيارة محددة</option>` +
          pvisits.map(v => `<option value="${v.id}">${U.fmtDate(v.date)} — متبقي ${U.money(v.remaining)}</option>`).join('');
      });
    }
    overlay.querySelector('#save-payment-btn').addEventListener('click', async () => {
      const form = overlay.querySelector('#payment-form');
      if (!form.reportValidity()) return;
      const data = Object.fromEntries(new FormData(form).entries());
      const amount = Number(data.amount);
      let linkedVisit = null;
      if (data.visitId) {
        linkedVisit = await DB.get('visits', Number(data.visitId));
        if (amount > linkedVisit.remaining) {
          const ok = await U.confirm(`المبلغ (${U.money(amount)}) أكبر من المتبقي على هذه الزيارة (${U.money(linkedVisit.remaining)}). هل تريد المتابعة وتسجيله كدفعة زائدة؟`);
          if (!ok) return;
        }
      }
      await DB.add('payments', {
        patientId: Number(data.patientId), visitId: data.visitId ? Number(data.visitId) : null,
        date: data.date, amount, method: data.method, notes: data.notes||'', createdAt: new Date().toISOString(),
      });
      if (linkedVisit) {
        const newPaid = Number(linkedVisit.paid) + amount;
        await DB.put('visits', { ...linkedVisit, paid: newPaid, remaining: Math.max(0, linkedVisit.total - newPaid) });
      }
      U.toast('تم تسجيل الدفعة'); overlay.remove();
      if (onSaved) onSaved();
    });
  });
};

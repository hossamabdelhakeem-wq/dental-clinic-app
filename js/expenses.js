/* =========================================================
   expenses.js — المصروفات (بما فيها الديون/المستحقات على العيادة)
   ========================================================= */

/* مصروف "مدفوع" لو isPaid !== false. القديم بدون الحقل يُعتبر مدفوعًا لضمان توافق البيانات القديمة. */
function isExpensePaid(e) { return e.isPaid !== false; }
/* التاريخ الفعلي لخروج الفلوس فعليًا (تاريخ السداد لو دين اتسدد، أو تاريخ التسجيل لو مصروف عادي) */
function expenseEffectiveDate(e) { return isExpensePaid(e) ? (e.paidDate || e.date) : null; }

Views.expenses = async function(main) {
  const expenses = (await DB.all('expenses')).sort((a,b) => b.date.localeCompare(a.date) || b.id-a.id);
  const cats = Object.fromEntries((await DB.all('expenseCategories')).map(c => [c.id, c]));
  const debts = expenses.filter(e => !isExpensePaid(e));
  const totalDebt = debts.reduce((s,e) => s + Number(e.amount||0), 0);

  main.innerHTML = `
    <div class="page-header">
      <h2>المصروفات <span class="count-badge">${expenses.length}</span></h2>
      <div class="page-actions">
        <button class="btn" id="btn-export-expenses">تصدير Excel</button>
        <button class="btn btn-primary" id="btn-new-expense">+ إضافة مصروف</button>
      </div>
    </div>

    ${debts.length ? `
    <div class="card">
      <div class="card-header-row"><h3>الديون والمستحقات على العيادة</h3></div>
      <div class="summary-cards">
        <div class="stat-card"><div class="stat-label">إجمالي المستحق</div><div class="stat-value stat-bad">${U.money(totalDebt)}</div></div>
        <div class="stat-card"><div class="stat-label">عدد الديون المفتوحة</div><div class="stat-value">${debts.length}</div></div>
      </div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>تاريخ التسجيل</th><th>الجهة/النوع</th><th>البيان</th><th>المبلغ</th><th></th></tr></thead>
        <tbody>${debts.map(e => `<tr class="row-click" data-edit="${e.id}">
          <td>${U.fmtDate(e.date)}</td><td>${U.esc((cats[e.categoryId]||{}).name||'')}</td>
          <td>${U.esc(e.description||'')}</td><td class="text-bad">${U.money(e.amount)}</td>
          <td><button class="btn btn-sm btn-primary" data-pay="${e.id}">تم الدفع</button></td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>` : ''}

    <div class="card">
      <div class="card-header-row"><h3>سجل المصروفات المدفوعة</h3></div>
      <div class="muted-sm" style="margin-bottom:8px">دوس على أي صف عشان تعدّله أو تحذفه.</div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>التاريخ</th><th>النوع</th><th>البيان</th><th>المبلغ</th><th>طريقة الدفع</th><th>الحالة</th></tr></thead>
        <tbody>${expenses.map(e => `<tr class="row-click" data-edit="${e.id}">
          <td>${U.fmtDate(isExpensePaid(e) ? (e.paidDate||e.date) : e.date)}</td><td>${U.esc((cats[e.categoryId]||{}).name||'')}</td>
          <td>${U.esc(e.description||'')}</td><td>${U.money(e.amount)}</td><td>${U.esc(e.method||'')}</td>
          <td>${isExpensePaid(e) ? '<span class="status-pill" style="background:#2f8f5b22;color:#2f8f5b">مدفوع</span>' : '<span class="status-pill" style="background:#c0392b22;color:#c0392b">دين</span>'}</td>
        </tr>`).join('') || `<tr><td colspan="6" class="empty-cell">لا توجد مصروفات</td></tr>`}</tbody>
      </table></div>
    </div>`;

  main.querySelector('#btn-new-expense').addEventListener('click', () => Views.openNewExpenseModal(() => route()));
  main.querySelectorAll('[data-pay]').forEach(btn => btn.addEventListener('click', (e) => { e.stopPropagation(); openMarkExpensePaidModal(Number(btn.dataset.pay), () => route()); }));
  main.querySelectorAll('[data-edit]').forEach(tr => tr.addEventListener('click', () => openEditExpenseModal(Number(tr.dataset.edit), () => route())));
  main.querySelector('#btn-export-expenses').addEventListener('click', () => {
    U.exportToExcel([{ name: 'المصروفات', rows: expenses.map(e => ({
      'التاريخ': U.fmtDate(isExpensePaid(e) ? (e.paidDate||e.date) : e.date), 'النوع': (cats[e.categoryId]||{}).name||'', 'البيان': e.description||'',
      'المبلغ': e.amount, 'طريقة الدفع': e.method||'', 'الحالة': isExpensePaid(e) ? 'مدفوع' : 'دين مستحق'
    })) }], 'المصروفات.xlsx');
  });
};

Views.openNewExpenseModal = function(onSaved) {
  Promise.all([DB.all('expenseCategories'), DB.all('paymentMethods')]).then(([cats, methods]) => {
    const overlay = U.openModal('إضافة مصروف', `
      <form id="expense-form" class="form-grid">
        <label>التاريخ<input type="date" name="date" class="input" value="${U.todayISO()}"></label>
        <label>نوع المصروف
          <select name="categoryId" class="input">${cats.map(c => `<option value="${c.id}">${U.esc(c.name)}</option>`).join('')}</select>
        </label>
        <label class="span-2">البيان<input name="description" class="input" placeholder="مثال: معمل الأسنان، مستلزمات طبية..."></label>
        <label>المبلغ *<input required type="number" name="amount" class="input" min="0"></label>
        <label id="method-field-wrap">طريقة الدفع
          <select name="method" class="input">${methods.map(m => `<option>${U.esc(m.name)}</option>`).join('')}</select>
        </label>
        <label class="span-2 inline-chk" style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" id="expense-is-debt" name="isDebt">
          دين عليّ لسه مادفعتوش (زي فاتورة معمل أو مورد لسه ما اتسددتش)
        </label>
        <label class="span-2">ملاحظات<input name="notes" class="input"></label>
      </form>`, `
      <button class="btn btn-secondary" data-close>إلغاء</button>
      <button class="btn btn-primary" id="save-expense-btn">حفظ</button>
    `);
    const debtChk = overlay.querySelector('#expense-is-debt');
    const methodWrap = overlay.querySelector('#method-field-wrap');
    debtChk.addEventListener('change', () => { methodWrap.style.display = debtChk.checked ? 'none' : ''; });

    overlay.querySelector('#save-expense-btn').addEventListener('click', async () => {
      const form = overlay.querySelector('#expense-form');
      if (!form.reportValidity()) return;
      const data = Object.fromEntries(new FormData(form).entries());
      const isDebt = !!data.isDebt;
      await DB.add('expenses', {
        date: data.date, categoryId: Number(data.categoryId), description: data.description||'', amount: Number(data.amount),
        method: isDebt ? '' : data.method, notes: data.notes||'',
        isPaid: !isDebt, paidDate: isDebt ? null : data.date,
      });
      U.toast(isDebt ? 'تم تسجيل الدين — هيفضل يظهر لحد ما تدوس "تم الدفع"' : 'تم إضافة المصروف');
      overlay.remove();
      if (onSaved) onSaved();
    });
  });
};

function openMarkExpensePaidModal(expenseId, onSaved) {
  Promise.all([DB.get('expenses', expenseId), DB.all('paymentMethods')]).then(([expense, methods]) => {
    if (!expense) return;
    const overlay = U.openModal('تسجيل السداد', `
      <form id="pay-expense-form" class="form-grid">
        <label>تاريخ السداد<input type="date" name="paidDate" class="input" value="${U.todayISO()}"></label>
        <label>طريقة الدفع
          <select name="method" class="input">${methods.map(m => `<option>${U.esc(m.name)}</option>`).join('')}</select>
        </label>
        <label class="span-2">المبلغ<input class="input" value="${U.money(expense.amount)}" disabled></label>
      </form>`, `
      <button class="btn btn-secondary" data-close>إلغاء</button>
      <button class="btn btn-primary" id="confirm-pay-btn">تأكيد السداد</button>
    `);
    overlay.querySelector('#confirm-pay-btn').addEventListener('click', async () => {
      const data = Object.fromEntries(new FormData(overlay.querySelector('#pay-expense-form')).entries());
      await DB.put('expenses', { ...expense, isPaid: true, paidDate: data.paidDate, method: data.method });
      U.toast('تم تسجيل السداد — بقى مصروف دائم في السجل');
      overlay.remove();
      if (onSaved) onSaved();
    });
  });
}

function openEditExpenseModal(expenseId, onSaved) {
  Promise.all([DB.get('expenses', expenseId), DB.all('expenseCategories'), DB.all('paymentMethods')]).then(([expense, cats, methods]) => {
    if (!expense) return;
    const isDebtNow = !isExpensePaid(expense);
    const overlay = U.openModal('تعديل المصروف', `
      <form id="expense-edit-form" class="form-grid">
        <label>التاريخ<input type="date" name="date" class="input" value="${expense.date}"></label>
        <label>نوع المصروف
          <select name="categoryId" class="input">${cats.map(c => `<option value="${c.id}" ${expense.categoryId===c.id?'selected':''}>${U.esc(c.name)}</option>`).join('')}</select>
        </label>
        <label class="span-2">البيان<input name="description" class="input" value="${U.esc(expense.description||'')}"></label>
        <label>المبلغ *<input required type="number" name="amount" class="input" min="0" value="${expense.amount}"></label>
        <label id="method-field-wrap-edit" style="${isDebtNow?'display:none':''}">طريقة الدفع
          <select name="method" class="input">${methods.map(m => `<option ${expense.method===m.name?'selected':''}>${U.esc(m.name)}</option>`).join('')}</select>
        </label>
        <label class="span-2 inline-chk" style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" id="expense-is-debt-edit" name="isDebt" ${isDebtNow?'checked':''}>
          دين عليّ لسه مادفعتوش
        </label>
        <label class="span-2">ملاحظات<input name="notes" class="input" value="${U.esc(expense.notes||'')}"></label>
      </form>`, `
      <button class="btn btn-danger" id="delete-expense-btn" style="margin-left:auto">حذف المصروف</button>
      <button class="btn btn-secondary" data-close>إلغاء</button>
      <button class="btn btn-primary" id="save-expense-edit-btn">حفظ التعديلات</button>
    `);
    const debtChk = overlay.querySelector('#expense-is-debt-edit');
    const methodWrap = overlay.querySelector('#method-field-wrap-edit');
    debtChk.addEventListener('change', () => { methodWrap.style.display = debtChk.checked ? 'none' : ''; });

    overlay.querySelector('#save-expense-edit-btn').addEventListener('click', async () => {
      const form = overlay.querySelector('#expense-edit-form');
      if (!form.reportValidity()) return;
      const data = Object.fromEntries(new FormData(form).entries());
      const isDebt = !!data.isDebt;
      await DB.put('expenses', {
        ...expense,
        date: data.date, categoryId: Number(data.categoryId), description: data.description||'', amount: Number(data.amount),
        method: isDebt ? '' : data.method, notes: data.notes||'',
        isPaid: !isDebt,
        paidDate: isDebt ? null : (expense.paidDate || data.date),
      });
      U.toast('تم حفظ التعديلات');
      overlay.remove();
      if (onSaved) onSaved();
    });
    overlay.querySelector('#delete-expense-btn').addEventListener('click', async () => {
      if (await U.confirm('هل تريد حذف هذا المصروف نهائيًا؟')) {
        await DB.delete('expenses', expenseId);
        U.toast('تم حذف المصروف');
        overlay.remove();
        if (onSaved) onSaved();
      }
    });
  });
}

/* =========================================================
   backup.js — النسخ الاحتياطي والاستعادة + بيانات تجريبية
   ========================================================= */

const ALL_STORE_NAMES = ['patients','appointments','visits','visitServices','services','serviceCategories','payments','expenses','expenseCategories','visitTypes','paymentMethods','appointmentStatuses','patientSources','drugs','prescriptions','prescriptionItems','prescriptionTemplates','treatmentPlans','doctors','settings'];

Views.backup = async function(main) {
  main.innerHTML = `
    <div class="page-header"><h2>النسخ الاحتياطي</h2></div>
    <div class="card">
      <h3>نسخة احتياطية يدوية</h3>
      <p class="muted">يتم حفظ كل بيانات العيادة في ملف واحد (JSON) يمكنك تخزينه في أي مكان آمن (فلاشة، جوجل درايف، إلخ).</p>
      <button class="btn btn-primary" id="btn-backup-now">تحميل نسخة احتياطية الآن</button>
    </div>
    <div class="card">
      <h3>استعادة نسخة احتياطية</h3>
      <p class="muted">تحذير: استعادة نسخة احتياطية ستستبدل كل البيانات الحالية في التطبيق.</p>
      <input type="file" id="restore-file" accept=".json">
      <button class="btn btn-danger" id="btn-restore-now">استعادة الآن</button>
    </div>
    <div class="card">
      <h3>استيراد بيانات من شيت إكسل قديم</h3>
      <p class="muted">لو كنت شغّال على شيت جوجل/إكسل قديم فيه بيانات المرضى والزيارات والمدفوعات، تقدر ترفعه هنا ويتوزع تلقائيًا على شاشات المرضى والزيارات والمدفوعات في البرنامج. الاستيراد يُضيف بيانات جديدة ولا يمسح أي بيانات موجودة حاليًا. ننصح بأخذ نسخة احتياطية قبل الاستيراد.</p>
      <button class="btn" id="btn-open-import">استيراد من ملف Excel / CSV</button>
    </div>
    <div class="card">
      <h3>بيانات تجريبية (Demo)</h3>
      <p class="muted">لتجربة النظام يمكنك تحميل بيانات تجريبية (10 مرضى، 20 موعد، زيارات ومدفوعات ومصروفات)، ويمكن حذفها بسهولة لاحقًا.</p>
      <button class="btn" id="btn-load-demo">تحميل بيانات تجريبية</button>
      <button class="btn btn-danger" id="btn-clear-demo">حذف كل البيانات التشغيلية</button>
    </div>
  `;
  main.querySelector('#btn-backup-now').addEventListener('click', doBackup);
  main.querySelector('#btn-restore-now').addEventListener('click', doRestore);
  main.querySelector('#btn-open-import').addEventListener('click', () => openImportWizard());
  main.querySelector('#btn-load-demo').addEventListener('click', async () => {
    if (await U.confirm('سيتم إضافة بيانات تجريبية للنظام. متابعة؟')) {
      await loadDemoData(); U.toast('تم تحميل البيانات التجريبية'); route();
    }
  });
  main.querySelector('#btn-clear-demo').addEventListener('click', async () => {
    if (await U.confirm('سيتم حذف كل المرضى والزيارات والمواعيد والمدفوعات والمصروفات والروشتات وخطط العلاج نهائيًا. هذا الإجراء لا يمكن التراجع عنه. متابعة؟')) {
      await deleteDemoData(); U.toast('تم حذف البيانات'); route();
    }
  });
};

async function doBackup() {
  const dump = {};
  for (const s of ALL_STORE_NAMES) dump[s] = await DB.all(s);
  dump._meta = { exportedAt: new Date().toISOString(), version: DB_VERSION };
  const blob = new Blob([JSON.stringify(dump)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `نسخة_احتياطية_عيادة_الاسنان_${U.todayISO()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  U.toast('تم تحميل النسخة الاحتياطية');
}

async function doRestore() {
  const fileInput = document.getElementById('restore-file');
  if (!fileInput.files.length) { U.toast('اختر ملف النسخة الاحتياطية أولًا', 'error'); return; }
  if (!(await U.confirm('سيتم استبدال كل البيانات الحالية بمحتوى الملف المختار. هل أنت متأكد؟'))) return;
  try {
    const text = await fileInput.files[0].text();
    const dump = JSON.parse(text);
    for (const s of ALL_STORE_NAMES) {
      await DB.clear(s);
      if (Array.isArray(dump[s])) for (const item of dump[s]) await DB.put(s, item);
    }
    U.toast('تم استعادة النسخة الاحتياطية بنجاح');
    location.hash = 'dashboard';
    setTimeout(() => location.reload(), 600);
  } catch (err) {
    U.toast('تعذّرت قراءة الملف، تأكد أنه نسخة احتياطية صحيحة', 'error');
  }
}

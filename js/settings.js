/* =========================================================
   settings.js — الإعدادات: بيانات العيادة وإدارة القوائم
   ========================================================= */

const LIST_CONFIGS = [
  { key: 'services', title: 'الخدمات', fields: [
    { name: 'name', label: 'اسم الخدمة', type: 'text' },
    { name: 'categoryId', label: 'التصنيف', type: 'select-cat' },
    { name: 'active', label: 'مفعّلة', type: 'checkbox' },
  ]},
  { key: 'serviceCategories', title: 'تصنيفات الخدمات', fields: [{ name: 'name', label: 'الاسم', type: 'text' }] },
  { key: 'visitTypes', title: 'أنواع الزيارات', fields: [{ name: 'name', label: 'الاسم', type: 'text' }] },
  { key: 'expenseCategories', title: 'تصنيفات المصروفات', fields: [{ name: 'name', label: 'الاسم', type: 'text' }] },
  { key: 'paymentMethods', title: 'طرق الدفع', fields: [{ name: 'name', label: 'الاسم', type: 'text' }] },
  { key: 'appointmentStatuses', title: 'حالات المواعيد', fields: [{ name: 'name', label: 'الاسم', type: 'text' }, { name: 'color', label: 'اللون', type: 'color' }] },
  { key: 'patientSources', title: 'مصادر معرفة العيادة', fields: [{ name: 'name', label: 'الاسم', type: 'text' }] },
  { key: 'drugs', title: 'قاعدة بيانات الأدوية', fields: [
    { name: 'tradeName', label: 'الاسم التجاري', type: 'text' },
    { name: 'activeIngredient', label: 'المادة الفعالة', type: 'text' },
    { name: 'form', label: 'الشكل الدوائي', type: 'text' },
    { name: 'strength', label: 'التركيز', type: 'text' },
  ]},
  { key: 'doctors', title: 'الأطباء', fields: [{ name: 'name', label: 'اسم الطبيب', type: 'text' }, { name: 'active', label: 'مفعّل', type: 'checkbox' }] },
];

Views.settings = async function(main, param) {
  const info = (await DB.get('settings', 'clinicInfo')).value;
  main.innerHTML = `
    <div class="page-header"><h2>الإعدادات</h2></div>
    <div class="card">
      <h3>بيانات العيادة</h3>
      <form id="clinic-info-form" class="form-grid">
        <label>اسم العيادة<input name="name" class="input" value="${U.esc(info.name)}"></label>
        <label>اسم الطبيب<input name="doctorName" class="input" value="${U.esc(info.doctorName)}"></label>
        <label>الهاتف<input name="phone" class="input" value="${U.esc(info.phone||'')}"></label>
        <label>العملة<input name="currency" class="input" value="${U.esc(info.currency||'ج.م')}"></label>
        <label class="span-2">العنوان<input name="address" class="input" value="${U.esc(info.address||'')}"></label>
      </form>
      <button class="btn btn-primary" id="save-clinic-info">حفظ بيانات العيادة</button>
    </div>

    <div class="card">
      <h3>إدارة القوائم</h3>
      <div class="seg-control" id="list-tabs">
        ${LIST_CONFIGS.map((c,i) => `<button data-k="${c.key}" class="${i===0?'active':''}">${c.title}</button>`).join('')}
      </div>
      <div id="list-manager-body"></div>
    </div>

    <div class="card" id="rx-template-card"></div>
    <div class="card" id="sync-card"></div>
  `;
  main.querySelector('#save-clinic-info').addEventListener('click', async () => {
    const data = Object.fromEntries(new FormData(main.querySelector('#clinic-info-form')).entries());
    const updated = { ...info, ...data };
    await DB.put('settings', { key: 'clinicInfo', value: updated });
    APP_STATE.clinicInfo = updated; APP_STATE.currency = updated.currency;
    document.getElementById('clinic-name-title').textContent = updated.name;
    U.toast('تم حفظ بيانات العيادة');
  });

  const tabs = main.querySelector('#list-tabs');
  const body = main.querySelector('#list-manager-body');
  const showList = async (key) => {
    tabs.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.k === key));
    await renderListManager(body, LIST_CONFIGS.find(c => c.key === key));
  };
  tabs.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showList(b.dataset.k); });
  showList(LIST_CONFIGS[0].key);

  renderRxTemplateCard(main.querySelector('#rx-template-card'));
  renderSyncCard(main.querySelector('#sync-card'));
};

async function renderSyncCard(container) {
  const cfg = await getSyncConfig();
  container.innerHTML = `
    <h3>المزامنة السحابية بين جهازين</h3>
    <p class="muted">البرنامج يفضل شغال بالكامل من غير إنترنت. لو وصّلت الحساب السحابي تحت، أي بيانات تدخلها هتتزامن تلقائيًا مع الجهاز التاني لما يبقى في نت — من غير ما تعمل حاجة يدويًا.</p>
    ${cfg.enabled ? `
      <div class="summary-cards">
        <div class="stat-card"><div class="stat-label">حالة الاتصال</div><div class="stat-value" id="sync-card-status">جاري الفحص...</div></div>
        <div class="stat-card"><div class="stat-label">آخر مزامنة</div><div class="stat-value" style="font-size:14px">${cfg.lastSyncAt ? U.fmtDateTime(cfg.lastSyncAt) : 'لسه ماحصلتش'}</div></div>
      </div>
      <div class="stack-btns" style="flex-direction:row">
        <button class="btn btn-primary" id="sync-now-btn">مزامنة الآن</button>
        <button class="btn btn-danger" id="sync-disconnect-btn">فصل المزامنة</button>
      </div>
    ` : `
      <form id="sync-connect-form" class="form-grid">
        <label class="span-2">رابط المشروع (Project URL)<input name="url" class="input" placeholder="https://xxxxxxxx.supabase.co" value="${U.esc(cfg.url||'')}"></label>
        <label class="span-2">المفتاح العام (anon public key)<input name="anonKey" class="input" placeholder="eyJhbGciOi..." value="${U.esc(cfg.anonKey||'')}"></label>
      </form>
      <button class="btn btn-primary" id="sync-connect-btn">تفعيل المزامنة</button>
    `}
  `;
  if (cfg.enabled) {
    const statusEl = container.querySelector('#sync-card-status');
    const updateStatus = () => { statusEl.textContent = navigator.onLine ? 'متصل ✅' : 'غير متصل بالإنترنت ⚪'; };
    updateStatus();
    window.addEventListener('online', updateStatus);
    container.querySelector('#sync-now-btn').addEventListener('click', async () => {
      U.toast('جاري المزامنة...');
      await runSyncPass('both');
      U.toast('تمت المزامنة');
      renderSyncCard(container);
    });
    container.querySelector('#sync-disconnect-btn').addEventListener('click', async () => {
      if (await U.confirm('هل تريد فصل المزامنة السحابية؟ بياناتك المحلية هتفضل موجودة عندك زي ما هي.')) {
        await disconnectSync();
        renderSyncCard(container);
      }
    });
  } else {
    container.querySelector('#sync-connect-btn').addEventListener('click', async () => {
      const data = Object.fromEntries(new FormData(container.querySelector('#sync-connect-form')).entries());
      if (!data.url || !data.anonKey) { U.toast('أدخل الرابط والمفتاح أولًا', 'error'); return; }
      U.toast('جاري الاتصال والمزامنة الأولى...');
      await connectSyncNow(data.url.trim(), data.anonKey.trim());
      U.toast('تم تفعيل المزامنة بنجاح');
      renderSyncCard(container);
    });
  }
}

async function renderListManager(container, config) {
  const items = await DB.all(config.key);
  const cats = config.key === 'services' ? await DB.all('serviceCategories') : [];
  const catName = (id) => (cats.find(c=>c.id===id)||{}).name || '';

  container.innerHTML = `
    ${config.key === 'services' ? '<div class="muted-sm" style="margin-bottom:8px">الخدمة هنا اسم/تصنيف فقط — لا يوجد سعر ثابت أو افتراضي. السعر يُكتب يدويًا وبحرية عند تسجيل كل زيارة.</div>' : ''}
    <div class="table-wrap"><table class="table table-compact">
      <thead><tr>${config.fields.map(f => `<th>${f.label}</th>`).join('')}<th></th></tr></thead>
      <tbody>${items.map(it => `<tr data-id="${it.id}">
        ${config.fields.map(f => `<td>${renderFieldCell(f, it, catName)}</td>`).join('')}
        <td><button class="btn btn-sm btn-danger" data-del="${it.id}">حذف</button></td>
      </tr>`).join('') || `<tr><td colspan="${config.fields.length+1}" class="empty-cell">لا توجد عناصر</td></tr>`}</tbody>
    </table></div>
    <div class="add-row-form">
      ${config.fields.map(f => renderFieldInput(f, cats)).join('')}
      <button class="btn btn-primary" id="add-list-item">+ إضافة</button>
    </div>`;

  container.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    if (await U.confirm('هل تريد حذف هذا العنصر؟')) {
      await DB.delete(config.key, Number(b.dataset.del));
      renderListManager(container, config);
    }
  }));
  container.querySelectorAll('.field-edit').forEach(input => input.addEventListener('change', async () => {
    const tr = input.closest('tr');
    const id = Number(tr.dataset.id);
    const item = items.find(x => x.id === id);
    const field = input.dataset.field;
    let val = input.type === 'checkbox' ? input.checked : input.value;
    if (input.dataset.numeric) val = Number(val);
    item[field] = val;
    await DB.put(config.key, item);
    U.toast('تم الحفظ');
  }));
  container.querySelector('#add-list-item').addEventListener('click', async () => {
    const obj = {};
    config.fields.forEach(f => {
      const inp = container.querySelector(`[data-new="${f.name}"]`);
      if (f.type === 'checkbox') obj[f.name] = inp.checked;
      else if (f.type === 'number') obj[f.name] = Number(inp.value)||0;
      else if (f.type === 'select-cat') obj[f.name] = Number(inp.value)||null;
      else obj[f.name] = inp.value;
    });
    if (config.fields.some(f=>f.name==='name') && !obj.name) { U.toast('أدخل الاسم أولًا', 'error'); return; }
    await DB.add(config.key, obj);
    U.toast('تمت الإضافة');
    renderListManager(container, config);
  });
}

function renderFieldCell(f, item, catName) {
  const val = item[f.name];
  if (f.type === 'checkbox') return `<input type="checkbox" class="field-edit" data-field="${f.name}" ${val?'checked':''}>`;
  if (f.type === 'color') return `<input type="color" class="field-edit" data-field="${f.name}" value="${U.esc(val||'#999999')}">`;
  if (f.type === 'select-cat') return U.esc(catName(val));
  if (f.type === 'number') return `<input type="number" class="input input-sm field-edit" data-field="${f.name}" data-numeric="1" value="${U.esc(val)}">`;
  return `<input type="text" class="input input-sm field-edit" data-field="${f.name}" value="${U.esc(val||'')}">`;
}
function renderFieldInput(f, cats) {
  if (f.type === 'checkbox') return `<label class="inline-chk"><input type="checkbox" data-new="${f.name}" checked> ${f.label}</label>`;
  if (f.type === 'color') return `<input type="color" class="input" data-new="${f.name}" value="#3d6ff0">`;
  if (f.type === 'select-cat') return `<select class="input" data-new="${f.name}"><option value="">${f.label}...</option>${cats.map(c=>`<option value="${c.id}">${U.esc(c.name)}</option>`).join('')}</select>`;
  if (f.type === 'number') return `<input type="number" class="input" data-new="${f.name}" placeholder="${f.label}" value="0">`;
  return `<input type="text" class="input" data-new="${f.name}" placeholder="${f.label}">`;
}

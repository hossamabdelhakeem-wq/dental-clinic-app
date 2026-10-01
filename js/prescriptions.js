/* =========================================================
   prescriptions.js — الروشتة الإلكترونية
   ========================================================= */

const RX_PRESETS = {
  dose: ['قرص واحد','قرصان','5 مل','10 مل','حسب الحاجة','أخرى'],
  frequency: ['مرة يوميًا','مرتين يوميًا','3 مرات يوميًا','كل 8 ساعات','كل 12 ساعة','عند اللزوم','أخرى'],
  duration: ['3 أيام','5 أيام','7 أيام','10 أيام','أخرى'],
  route: ['عن طريق الفم','موضعي','غسول فم','أخرى'],
  instructions: ['بعد الأكل','قبل الأكل','بعد المضمضة','عند اللزوم','أخرى'],
};

Views.prescriptions = async function(main) {
  const rxs = (await DB.all('prescriptions')).sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id);
  const patients = Object.fromEntries((await DB.all('patients')).map(p=>[p.id,p]));
  main.innerHTML = `
    <div class="page-header">
      <h2>الروشتات الإلكترونية <span class="count-badge">${rxs.length}</span></h2>
      <button class="btn btn-primary" id="btn-new-rx">+ إنشاء روشتة</button>
    </div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>رقم الروشتة</th><th>التاريخ</th><th>المريض</th><th>التشخيص</th><th></th></tr></thead>
      <tbody>${rxs.map(r => `<tr>
        <td>${U.esc(r.prescriptionNumber)}</td><td>${U.fmtDate(r.date)}</td>
        <td><a href="#patients/${r.patientId}">${U.esc((patients[r.patientId]||{}).fullName||'')}</a></td>
        <td>${U.esc(r.diagnosis||'')}</td>
        <td><button class="btn btn-sm" data-view="${r.id}">عرض</button></td>
      </tr>`).join('') || `<tr><td colspan="5" class="empty-cell">لا توجد روشتات بعد</td></tr>`}</tbody>
    </table></div>`;
  main.querySelector('#btn-new-rx').addEventListener('click', () => Views.openNewPrescriptionModal(null, null, () => route()));
  main.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => Views.viewPrescription(Number(b.dataset.view))));
};

Views.openNewPrescriptionModal = function(patientId, visitId, onSaved) {
  Promise.all([DB.all('patients'), DB.all('drugs'), DB.all('prescriptionTemplates'), DB.all('doctors')]).then(([patients, drugs, templates, doctors]) => {
    let items = [];
    const overlay = U.openModal('إنشاء روشتة إلكترونية', `
      <form id="rx-form" class="form-grid">
        <label class="span-2">المريض *
          <select name="patientId" required class="input" ${patientId?'disabled':''}>
            <option value="">اختر مريض...</option>
            ${patients.filter(p=>!p.isDeleted).map(p => `<option value="${p.id}" ${patientId===p.id?'selected':''}>${U.esc(p.fullName)} (${U.esc(p.fileNumber)})</option>`).join('')}
          </select>
          ${patientId?`<input type="hidden" name="patientId" value="${patientId}">`:''}
        </label>
        <label>الطبيب
          <select name="doctorName" class="input">${doctors.map(d => `<option>${U.esc(d.name)}</option>`).join('')}</select>
        </label>
        <label>التاريخ<input type="date" name="date" class="input" value="${U.todayISO()}"></label>
        <label class="span-2">التشخيص<input name="diagnosis" class="input"></label>
      </form>

      <div class="form-inline">
        <label>تحميل Template
          <select id="rx-template-select" class="input">
            <option value="">اختر Template...</option>
            ${templates.map(t => `<option value="${t.id}">${U.esc(t.name)}</option>`).join('')}
          </select>
        </label>
      </div>

      <h4>الأدوية</h4>
      <div class="service-picker-row">
        <select id="rx-drug-select" class="input">
          <option value="">اختر دواء...</option>
          ${drugs.map(d => `<option value="${d.id}" data-name="${U.esc(d.tradeName)}">${U.esc(d.tradeName)} (${U.esc(d.activeIngredient)})</option>`).join('')}
        </select>
        <button type="button" class="btn" id="rx-add-drug">+ إضافة</button>
      </div>
      <div class="table-wrap">
        <table class="table table-compact">
          <thead><tr><th>الدواء</th><th>الجرعة</th><th>عدد المرات</th><th>المدة</th><th>الطريقة</th><th>تعليمات</th><th></th></tr></thead>
          <tbody id="rx-items-tbody"></tbody>
        </table>
      </div>
      <label class="span-2" style="display:block;margin-top:10px">ملاحظات إضافية<textarea id="rx-notes" class="input" rows="2"></textarea></label>
      `, `
      <button class="btn btn-secondary" data-close>إلغاء</button>
      <button class="btn btn-primary" id="save-rx-btn">حفظ وإصدار الروشتة</button>
    `, {wide:true});

    const selectHTML = (list, current) => list.map(v => `<option value="${U.esc(v)}" ${current===v?'selected':''}>${U.esc(v)}</option>`).join('');
    const itemsTbody = overlay.querySelector('#rx-items-tbody');
    const renderItems = () => {
      itemsTbody.innerHTML = items.map((it,i) => `<tr>
        <td>${U.esc(it.drugName)}</td>
        <td><select class="input input-sm" data-f="dose" data-i="${i}">${selectHTML(RX_PRESETS.dose, it.dose)}</select></td>
        <td><select class="input input-sm" data-f="frequency" data-i="${i}">${selectHTML(RX_PRESETS.frequency, it.frequency)}</select></td>
        <td><select class="input input-sm" data-f="duration" data-i="${i}">${selectHTML(RX_PRESETS.duration, it.duration)}</select></td>
        <td><select class="input input-sm" data-f="route" data-i="${i}">${selectHTML(RX_PRESETS.route, it.route)}</select></td>
        <td><select class="input input-sm" data-f="instructions" data-i="${i}">${selectHTML(RX_PRESETS.instructions, it.instructions)}</select></td>
        <td><button type="button" class="btn btn-sm btn-danger" data-rm="${i}">حذف</button></td>
      </tr>`).join('') || `<tr><td colspan="7" class="empty-cell">لم تُضَف أدوية بعد</td></tr>`;
      itemsTbody.querySelectorAll('select[data-f]').forEach(sel => sel.addEventListener('change', () => {
        items[Number(sel.dataset.i)][sel.dataset.f] = sel.value;
      }));
      itemsTbody.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { items.splice(Number(b.dataset.rm),1); renderItems(); }));
    };
    renderItems();

    overlay.querySelector('#rx-add-drug').addEventListener('click', () => {
      const sel = overlay.querySelector('#rx-drug-select');
      const opt = sel.selectedOptions[0];
      if (!opt || !opt.value) return;
      items.push({ drugId: Number(opt.value), drugName: opt.dataset.name, dose: RX_PRESETS.dose[0], frequency: RX_PRESETS.frequency[0], duration: RX_PRESETS.duration[0], route: RX_PRESETS.route[0], instructions: RX_PRESETS.instructions[0] });
      sel.value = ''; renderItems();
    });
    overlay.querySelector('#rx-template-select').addEventListener('change', (e) => {
      const t = templates.find(t => t.id === Number(e.target.value));
      if (!t) return;
      items = t.items.map(it => ({ ...it, drugId: null }));
      renderItems();
    });

    overlay.querySelector('#save-rx-btn').addEventListener('click', async () => {
      const form = overlay.querySelector('#rx-form');
      if (!form.reportValidity()) return;
      if (items.length === 0) { U.toast('أضف دواء واحد على الأقل', 'error'); return; }
      const data = Object.fromEntries(new FormData(form).entries());
      const prescriptionNumber = await nextRxNumber();
      const rxId = await DB.add('prescriptions', {
        prescriptionNumber, patientId: Number(data.patientId), visitId: visitId||null, doctorName: data.doctorName,
        date: data.date, diagnosis: data.diagnosis||'', notes: overlay.querySelector('#rx-notes').value, createdAt: new Date().toISOString(), editedAt: null,
      });
      for (const it of items) await DB.add('prescriptionItems', { prescriptionId: rxId, ...it });
      U.toast(`تم إصدار الروشتة رقم ${prescriptionNumber}`); overlay.remove();
      if (onSaved) onSaved();
      Views.viewPrescription(rxId);
    });
  });
};

Views.viewPrescription = async function(rxId) {
  const rx = await DB.get('prescriptions', rxId);
  const patient = await DB.get('patients', rx.patientId);
  const items = await DB.byIndex('prescriptionItems', 'prescriptionId', rxId);
  const info = APP_STATE.clinicInfo;
  const tplRow = await DB.get('settings', 'rxTemplate');
  const hasTemplate = !!(tplRow && tplRow.value && Object.keys(tplRow.value.positions || {}).length);

  const overlay = U.openModal(`روشتة ${U.esc(rx.prescriptionNumber)}`, `
    <div class="rx-preview">
      ${hasTemplate ? `<div id="rx-template-preview"><div class="muted-sm">جاري تجهيز المعاينة على القالب...</div></div>` : `
      <div class="print-header"><img src="assets/icon-navy-128.png" class="print-logo" alt=""><h1>${U.esc(info.name)}</h1><div>${U.esc(rx.doctorName)}</div></div>
      <table class="print-table">
        <tr><td>المريض</td><td>${U.esc(patient.fullName)}</td><td>رقم الملف</td><td>${U.esc(patient.fileNumber)}</td></tr>
        <tr><td>التاريخ</td><td>${U.fmtDate(rx.date)}</td><td>رقم الروشتة</td><td>${U.esc(rx.prescriptionNumber)}</td></tr>
        ${rx.diagnosis ? `<tr><td>التشخيص</td><td colspan="3">${U.esc(rx.diagnosis)}</td></tr>` : ''}
      </table>
      <table class="print-table">
        <thead><tr><th>الدواء</th><th>الجرعة</th><th>عدد المرات</th><th>المدة</th><th>التعليمات</th></tr></thead>
        <tbody>${items.map(it => `<tr><td>${U.esc(it.drugName)}</td><td>${U.esc(it.dose)}</td><td>${U.esc(it.frequency)}</td><td>${U.esc(it.duration)}</td><td>${U.esc(it.instructions)}</td></tr>`).join('')}</tbody>
      </table>
      ${rx.notes ? `<p>${U.esc(rx.notes)}</p>` : ''}
      `}
    </div>`, `
    <button class="btn btn-secondary" data-close>إغلاق</button>
    <button class="btn" id="rx-wa">إرسال عبر واتساب</button>
    <button class="btn" id="rx-print">طباعة</button>
    <button class="btn btn-primary" id="rx-download">تحميل PDF</button>
  `, {wide:true});

  let templateImageDataUrl = null;
  if (hasTemplate) {
    templateImageDataUrl = await renderPrescriptionOnTemplate(rx, patient, items, tplRow.value);
    const previewEl = overlay.querySelector('#rx-template-preview');
    if (previewEl) previewEl.innerHTML = `<img src="${templateImageDataUrl}" style="max-width:100%;border:1px solid var(--border);border-radius:6px">`;
  }

  overlay.querySelector('#rx-print').addEventListener('click', () => {
    if (templateImageDataUrl) {
      U.printSection(`<img src="${templateImageDataUrl}" style="width:100%">`, `روشتة ${rx.prescriptionNumber}`);
    } else {
      U.printSection(overlay.querySelector('.rx-preview').innerHTML + `<div class="print-footer">${U.esc(info.name)} — ${U.esc(info.phone||'')}</div>`, `روشتة ${rx.prescriptionNumber}`);
    }
  });
  overlay.querySelector('#rx-download').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const originalText = btn.textContent;
    btn.disabled = true; btn.textContent = 'جاري تجهيز الملف...';
    try {
      const imageDataUrl = templateImageDataUrl || await buildBlankPrescriptionCanvasDataUrl(rx, patient, items, info);
      await downloadImageAsPdf(imageDataUrl, `روشتة_${rx.prescriptionNumber}.pdf`);
      U.toast('تم تحميل ملف PDF بنجاح');
    } catch (err) {
      console.error(err);
      U.toast('تعذّر إنشاء ملف PDF', 'error');
    } finally {
      btn.disabled = false; btn.textContent = originalText;
    }
  });
  overlay.querySelector('#rx-wa').addEventListener('click', () => {
    const text = `${U.esc(rx.doctorName)}\nروشتة المريض ${patient.fullName}\nالتاريخ: ${U.fmtDate(rx.date)}\n\nتم إرفاق الروشتة الإلكترونية.\n\nمع تمنياتنا بالشفاء.`;
    window.open(U.waLink(patient.phone, text), '_blank');
  });
};

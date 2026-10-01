/* =========================================================
   rxtemplate.js — قالب الروشتة: رفع صورة/PDF الروشتة الأصلية
   وتحديد أماكن الحقول عليها، ثم الكتابة التلقائية فوقها لاحقًا
   ========================================================= */

const RX_TEMPLATE_FIELDS = [
  { key: 'patientName', label: 'اسم المريض' },
  { key: 'fileNo', label: 'رقم الملف' },
  { key: 'date', label: 'التاريخ' },
  { key: 'age', label: 'السن' },
  { key: 'diagnosis', label: 'التشخيص' },
  { key: 'medsStart', label: 'بداية قائمة الأدوية (كل دواء في سطر تحت التاني)' },
  { key: 'notes', label: 'ملاحظات إضافية' },
];

/* يحسب سن المريض بالسنوات من تاريخ الميلاد (لو متسجل) نسبة لتاريخ الروشتة */
function computePatientAge(patient, rxDateISO) {
  if (!patient || !patient.dob) return '';
  const dob = new Date(patient.dob);
  const ref = rxDateISO ? new Date(rxDateISO) : new Date();
  if (isNaN(dob)) return '';
  let age = ref.getFullYear() - dob.getFullYear();
  const m = ref.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < dob.getDate())) age--;
  return age >= 0 ? String(age) : '';
}

if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'libs/pdf.worker.min.js';
}

function loadImageEl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function pdfFileToImageData(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width; canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
}

async function imageFileToImageData(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const img = await loadImageEl(dataUrl);
  return { dataUrl, width: img.naturalWidth, height: img.naturalHeight };
}

/* ---------- شاشة الإعدادات: بطاقة قالب الروشتة ---------- */
async function renderRxTemplateCard(container) {
  const tpl = await DB.get('settings', 'rxTemplate');
  container.innerHTML = `
    <h3>قالب الروشتة (اختياري)</h3>
    <p class="muted">ارفع صورة أو PDF لروشتتك الأصلية، وحدد أماكن البيانات عليها مرة واحدة — وبعدها كل روشتة تُكتب تلقائيًا في نفس الأماكن على نفس التصميم.</p>
    ${tpl ? `
      <img src="${tpl.value.imageDataUrl}" style="max-width:220px;border:1px solid var(--border);border-radius:8px;display:block;margin-bottom:10px">
      <div class="stack-btns" style="flex-direction:row">
        <button class="btn" id="rx-tpl-edit">تعديل مواضع الحقول</button>
        <button class="btn btn-danger" id="rx-tpl-delete">حذف القالب</button>
      </div>
    ` : `
      <input type="file" id="rx-tpl-upload" accept=".pdf,.jpg,.jpeg,.png">
    `}
  `;
  if (tpl) {
    container.querySelector('#rx-tpl-edit').addEventListener('click', () => openRxTemplateEditor(tpl.value, container));
    container.querySelector('#rx-tpl-delete').addEventListener('click', async () => {
      if (await U.confirm('هل تريد حذف قالب الروشتة؟ ستعود الروشتات للتصميم الافتراضي.')) {
        const cur = await DB.get('settings', 'rxTemplate');
        if (cur) await DB.delete('settings', 'rxTemplate');
        renderRxTemplateCard(container);
      }
    });
  } else {
    container.querySelector('#rx-tpl-upload').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      U.toast('جاري تجهيز القالب...');
      try {
        const data = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
          ? await pdfFileToImageData(file)
          : await imageFileToImageData(file);
        openRxTemplateEditor({ imageDataUrl: data.dataUrl, naturalWidth: data.width, naturalHeight: data.height, positions: {}, fontSize: Math.round(data.width / 45), lineHeight: Math.round(data.width / 35) }, container);
      } catch (err) {
        console.error(err);
        U.toast('تعذّر قراءة الملف — تأكد أنه صورة أو PDF صحيح', 'error');
      }
    });
  }
}

function openRxTemplateEditor(tplValue, settingsContainer) {
  const positions = { ...tplValue.positions };
  let activeField = RX_TEMPLATE_FIELDS[0].key;
  const SAMPLE_TEXT = {
    patientName: 'اسم المريض',
    fileNo: 'P-00001',
    date: U.fmtDate(U.todayISO()),
    age: '25',
    diagnosis: 'مثال: تسوس بسيط',
    medsStart: 'Amoxicillin 500',
    notes: 'ملاحظات إضافية',
  };
  const overlay = U.openModal('تحديد أماكن الحقول على الروشتة', `
    <p class="muted-sm">دوس على اسم الحقل، بعدين دوس على مكانه فوق الصورة. تقدر بعد كده تسحب أي حقل بالماوس لضبط مكانه بالظبط، أو تكتب الإحداثيات يدويًا تحت.</p>
    <div id="rx-tpl-field-buttons" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">
      ${RX_TEMPLATE_FIELDS.map((f,i) => `<button type="button" class="btn btn-sm ${i===0?'btn-primary':''}" data-field="${f.key}">${f.label} ${positions[f.key]?'✓':''}</button>`).join('')}
    </div>
    <div style="position:relative;display:inline-block;max-width:100%">
      <canvas id="rx-tpl-canvas" style="max-width:100%;border:1px solid var(--border);cursor:crosshair"></canvas>
    </div>
    <div class="form-grid" style="margin-top:12px">
      <label>إحداثي X للحقل النشط الحالي (<span id="rx-tpl-active-label">${RX_TEMPLATE_FIELDS[0].label}</span>)
        <input type="number" id="rx-tpl-pos-x" class="input" placeholder="غير محدد بعد">
      </label>
      <label>إحداثي Y للحقل النشط الحالي
        <input type="number" id="rx-tpl-pos-y" class="input" placeholder="غير محدد بعد">
      </label>
      <label>حجم الخط<input type="number" id="rx-tpl-fontsize" class="input" value="${tplValue.fontSize}"></label>
      <label>المسافة بين أسطر الأدوية<input type="number" id="rx-tpl-lineheight" class="input" value="${tplValue.lineHeight}"></label>
    </div>
    <p class="muted-sm">تلميح: النص المعروض فوق الصورة معاينة حقيقية بنفس حجم الخط المحدد، عشان تشوف بالظبط شكل ومكان كل حقل قبل الحفظ.</p>
  `, `
    <button class="btn btn-secondary" data-close>إلغاء</button>
    <button class="btn btn-primary" id="rx-tpl-save">حفظ القالب</button>
  `, { wide: true });

  const canvas = overlay.querySelector('#rx-tpl-canvas');
  const ctx = canvas.getContext('2d');
  const xInput = overlay.querySelector('#rx-tpl-pos-x');
  const yInput = overlay.querySelector('#rx-tpl-pos-y');
  const activeLabelEl = overlay.querySelector('#rx-tpl-active-label');
  let displayScale = 1;
  let loadedImg = null;
  let draggingField = null;

  loadImageEl(tplValue.imageDataUrl).then(img => {
    loadedImg = img;
    const maxW = 760;
    displayScale = Math.min(1, maxW / img.naturalWidth);
    canvas.width = img.naturalWidth * displayScale;
    canvas.height = img.naturalHeight * displayScale;
    redraw();
    syncInputs();
  });

  function currentFontSize() { return Number(overlay.querySelector('#rx-tpl-fontsize').value) || tplValue.fontSize; }

  function redraw() {
    if (!loadedImg) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(loadedImg, 0, 0, canvas.width, canvas.height);
    RX_TEMPLATE_FIELDS.forEach(f => {
      const p = positions[f.key];
      if (!p) return;
      const x = p.x * displayScale, y = p.y * displayScale;
      const isActive = f.key === activeField;
      const dispFont = Math.max(9, currentFontSize() * displayScale);
      ctx.direction = f.key === 'medsStart' ? 'ltr' : 'rtl';
      ctx.textAlign = 'right';
      ctx.font = `${isActive ? 'bold ' : ''}${dispFont}px Tahoma, Arial, sans-serif`;
      ctx.fillStyle = isActive ? '#c9962a' : 'rgba(61,111,240,0.85)';
      ctx.fillText(SAMPLE_TEXT[f.key], x, y);
      // نقطة صغيرة عند نقطة الارتكاز (بداية النص من جهة اليمين)
      ctx.beginPath(); ctx.arc(x, y, isActive ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = isActive ? '#c9962a' : '#3d6ff0';
      ctx.fill();
    });
  }

  function syncInputs() {
    const p = positions[activeField];
    xInput.value = p ? p.x : '';
    yInput.value = p ? p.y : '';
    activeLabelEl.textContent = RX_TEMPLATE_FIELDS.find(f => f.key === activeField).label;
  }

  function setActive(key) {
    activeField = key;
    overlay.querySelectorAll('[data-field]').forEach(b => b.classList.toggle('btn-primary', b.dataset.field === key));
    syncInputs();
    redraw();
  }

  overlay.querySelectorAll('[data-field]').forEach(btn => btn.addEventListener('click', () => setActive(btn.dataset.field)));

  function hitTestActiveMarker(dispX, dispY) {
    // بيحدد بس هل الدوسة قريبة من نقطة ارتكاز "الحقل النشط حاليًا" نفسه (عشان نسحبه) —
    // ومش بيتفاعل مع أي حقل تاني، عشان محاولة وضع حقل جديد جنب حقل قديم متلاصق (زي التاريخ جنب السن)
    // متتلخبطش وتتحول لسحب غلط لحقل تاني بالغلط.
    const p = positions[activeField];
    if (!p) return false;
    const x = p.x * displayScale, y = p.y * displayScale;
    return Math.hypot(dispX - x, dispY - y) < 16;
  }

  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const dispX = e.clientX - rect.left, dispY = e.clientY - rect.top;
    if (hitTestActiveMarker(dispX, dispY)) draggingField = activeField;
  });
  canvas.addEventListener('mousemove', (e) => {
    if (!draggingField) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / displayScale;
    const y = (e.clientY - rect.top) / displayScale;
    positions[draggingField] = { x: Math.round(x), y: Math.round(y) };
    syncInputs();
    redraw();
  });
  window.addEventListener('mouseup', () => {
    if (draggingField) {
      const btn = overlay.querySelector(`[data-field="${draggingField}"]`);
      if (btn) btn.textContent = `${RX_TEMPLATE_FIELDS.find(f => f.key === draggingField).label} ✓`;
    }
    draggingField = null;
  });
  canvas.addEventListener('click', (e) => {
    if (draggingField) return; // كان سحب، مش دوسة تحديد جديدة
    const rect = canvas.getBoundingClientRect();
    const dispX = e.clientX - rect.left, dispY = e.clientY - rect.top;
    if (hitTestActiveMarker(dispX, dispY)) return; // دوسة على نقطة ارتكاز الحقل النشط نفسه — السحب هو اللي بيحركها
    // أي دوسة تانية (حتى لو قريبة من حقل تاني مختلف) بتحط الحقل النشط في مكانها الجديد دايمًا
    const x = dispX / displayScale, y = dispY / displayScale;
    positions[activeField] = { x: Math.round(x), y: Math.round(y) };
    const btn = overlay.querySelector(`[data-field="${activeField}"]`);
    btn.textContent = `${RX_TEMPLATE_FIELDS.find(f => f.key === activeField).label} ✓`;
    syncInputs();
    redraw();
  });

  const applyManualCoords = () => {
    const xv = xInput.value, yv = yInput.value;
    if (xv === '' || yv === '') return;
    positions[activeField] = { x: Math.round(Number(xv)), y: Math.round(Number(yv)) };
    const btn = overlay.querySelector(`[data-field="${activeField}"]`);
    btn.textContent = `${RX_TEMPLATE_FIELDS.find(f => f.key === activeField).label} ✓`;
    redraw();
  };
  xInput.addEventListener('input', applyManualCoords);
  yInput.addEventListener('input', applyManualCoords);
  overlay.querySelector('#rx-tpl-fontsize').addEventListener('input', redraw);

  overlay.querySelector('#rx-tpl-save').addEventListener('click', async () => {
    const fontSize = Number(overlay.querySelector('#rx-tpl-fontsize').value) || tplValue.fontSize;
    const lineHeight = Number(overlay.querySelector('#rx-tpl-lineheight').value) || tplValue.lineHeight;
    const value = { ...tplValue, positions, fontSize, lineHeight };
    await DB.put('settings', { key: 'rxTemplate', value });
    U.toast('تم حفظ قالب الروشتة');
    overlay.remove();
    if (settingsContainer) renderRxTemplateCard(settingsContainer);
  });
}

/* يرسم نص فوق القالب مع خلفية بيضاء خفيفة خلفه، عشان يفضل واضح حتى لو تداخل مع أي خط أو كلمة مطبوعة على الروشتة الأصلية */
function fillTextWithBacking(ctx, text, x, y, fontPx) {
  if (!text) return;
  const w = ctx.measureText(text).width;
  const padX = Math.max(4, Math.round(fontPx * 0.18));
  const padY = Math.max(3, Math.round(fontPx * 0.16));
  const rectH = fontPx + padY * 2;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.fillRect(x - w - padX, y - fontPx * 0.82 - padY, w + padX * 2, rectH);
  ctx.restore();
}

/* ---------- توليد صورة الروشتة النهائية فوق القالب ---------- */
async function renderPrescriptionOnTemplate(rx, patient, items, tpl) {
  const img = await loadImageEl(tpl.imageDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = tpl.naturalWidth; canvas.height = tpl.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.font = `${tpl.fontSize}px Tahoma, Arial, sans-serif`;

  const draw = (key, text) => {
    const p = tpl.positions[key];
    if (!p || !text) return;
    fillTextWithBacking(ctx, text, p.x, p.y, tpl.fontSize);
    ctx.fillStyle = '#0a0a0a';
    ctx.fillText(text, p.x, p.y);
  };
  draw('patientName', patient.fullName);
  draw('fileNo', patient.fileNumber);
  draw('date', U.fmtDate(rx.date));
  draw('age', computePatientAge(patient, rx.date));
  draw('diagnosis', rx.diagnosis);
  draw('notes', rx.notes);

  const medsPos = tpl.positions.medsStart;
  if (medsPos) {
    const blockHeight = Math.round((tpl.lineHeight || Math.round(tpl.fontSize * 1.4)) * 1.7);
    const subGap = Math.round(blockHeight * 0.42);
    const doseFontSize = Math.max(11, Math.round(tpl.fontSize * 0.82));
    items.forEach((it, i) => {
      const baseY = medsPos.y + i * blockHeight;
      // اسم الدواء بالإنجليزي في سطر مستقل
      ctx.direction = 'ltr';
      ctx.font = `${tpl.fontSize}px Arial, Tahoma, sans-serif`;
      fillTextWithBacking(ctx, it.drugName, medsPos.x, baseY, tpl.fontSize);
      ctx.fillStyle = '#0a0a0a';
      ctx.fillText(it.drugName, medsPos.x, baseY);
      // الجرعة وتفاصيلها بالعربي في السطر اللي تحته
      const doseLine = `${it.dose} — ${it.frequency} — ${it.duration}${it.instructions ? ' — ' + it.instructions : ''}`;
      ctx.direction = 'rtl';
      ctx.font = `${doseFontSize}px Tahoma, Arial, sans-serif`;
      fillTextWithBacking(ctx, doseLine, medsPos.x, baseY + subGap, doseFontSize);
      ctx.fillStyle = '#3a3a3a';
      ctx.fillText(doseLine, medsPos.x, baseY + subGap);
    });
  }
  return canvas.toDataURL('image/png');
}

/* ---------- توليد صورة روشتة بالتصميم الافتراضي (بدون قالب مخصص) ---------- */
async function buildBlankPrescriptionCanvasDataUrl(rx, patient, items, info) {
  const W = 1000, H = 1360;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  ctx.direction = 'rtl'; ctx.textAlign = 'center';

  let logoImg = null;
  try { logoImg = await loadImageEl('assets/icon-navy-128.png'); } catch (e) { /* اللوجو اختياري */ }
  let y = 60;
  if (logoImg) {
    const logoH = 70, logoW = logoH * (logoImg.naturalWidth / logoImg.naturalHeight);
    ctx.drawImage(logoImg, W / 2 - logoW / 2, y, logoW, logoH);
    y += logoH + 20;
  }
  ctx.fillStyle = '#0f2647';
  ctx.font = 'bold 30px Tahoma, Arial, sans-serif';
  ctx.fillText(info.name, W / 2, y); y += 34;
  ctx.font = '18px Tahoma, Arial, sans-serif';
  ctx.fillStyle = '#444';
  ctx.fillText(rx.doctorName || '', W / 2, y); y += 30;
  ctx.strokeStyle = '#0f2647'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(60, y); ctx.lineTo(W - 60, y); ctx.stroke(); y += 46;

  ctx.textAlign = 'right'; ctx.fillStyle = '#111';
  ctx.font = '20px Tahoma, Arial, sans-serif';
  const infoLine = (label, value) => { if (!value) return; ctx.fillText(`${label}:  ${value}`, W - 60, y); y += 34; };
  infoLine('المريض', patient.fullName);
  infoLine('رقم الملف', patient.fileNumber);
  infoLine('التاريخ', U.fmtDate(rx.date));
  infoLine('السن', computePatientAge(patient, rx.date));
  infoLine('رقم الروشتة', rx.prescriptionNumber);
  infoLine('التشخيص', rx.diagnosis);

  y += 10;
  ctx.strokeStyle = '#ccc'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(60, y); ctx.lineTo(W - 60, y); ctx.stroke(); y += 44;

  ctx.font = 'bold 24px Tahoma, Arial, sans-serif'; ctx.fillStyle = '#0f2647';
  ctx.fillText('Rx', W - 60, y); y += 42;

  ctx.textAlign = 'right';
  items.forEach((it) => {
    // اسم الدواء بالإنجليزي في سطر مستقل
    ctx.direction = 'ltr';
    ctx.font = 'bold 20px Arial, Tahoma, sans-serif';
    ctx.fillStyle = '#111';
    ctx.fillText(it.drugName, W - 60, y);
    y += 27;
    // الجرعة وتفاصيلها بالعربي في السطر اللي تحته
    const doseLine = `${it.dose} — ${it.frequency} — ${it.duration}${it.instructions ? ' — ' + it.instructions : ''}`;
    ctx.direction = 'rtl';
    ctx.font = '16px Tahoma, Arial, sans-serif';
    ctx.fillStyle = '#555';
    ctx.fillText(doseLine, W - 60, y);
    y += 38;
  });

  if (rx.notes) {
    y += 20;
    ctx.font = '18px Tahoma, Arial, sans-serif'; ctx.fillStyle = '#333';
    ctx.fillText(rx.notes, W - 60, y);
  }

  ctx.textAlign = 'center'; ctx.fillStyle = '#888'; ctx.font = '15px Tahoma, Arial, sans-serif';
  ctx.fillText(`${info.name} — ${info.phone || ''}`, W / 2, H - 40);

  return canvas.toDataURL('image/png');
}

/* ---------- تحويل صورة الروشتة الناتجة إلى ملف PDF حقيقي قابل للتنزيل مباشرة ---------- */
function dataUrlToUint8Array(dataUrl) {
  const base64 = dataUrl.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function downloadImageAsPdf(imageDataUrl, filename) {
  const { PDFDocument } = PDFLib;
  const pdfDoc = await PDFDocument.create();
  const pngBytes = dataUrlToUint8Array(imageDataUrl);
  const png = await pdfDoc.embedPng(pngBytes);
  const page = pdfDoc.addPage([png.width, png.height]);
  page.drawImage(png, { x: 0, y: 0, width: png.width, height: png.height });
  const pdfBytes = await pdfDoc.save();
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

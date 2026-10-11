/* =========================================================
   db.js — طبقة قاعدة البيانات المحلية (IndexedDB)
   البرنامج يعمل بالكامل من غير إنترنت. أي بيانات يتم إدخالها تُخزَّن
   محليًا فورًا، وتتزامن تلقائيًا مع قاعدة بيانات سحابية (Supabase) لما
   يبقى في اتصال إنترنت، من غير ما يتوقف البرنامج أو ينتظر الشبكة أبدًا.
   ========================================================= */

const DB_NAME = 'dental_clinic_db';
const DB_VERSION = 1;
let dbInstance = null;

/* الجداول اللي بتتزامن مع السحابة (كل حاجة ماعدا الإعدادات المحلية البحتة) */
const SYNCED_STORES = [
  'patients','appointments','visits','visitServices','services','serviceCategories',
  'payments','expenses','expenseCategories','visitTypes','paymentMethods',
  'appointmentStatuses','patientSources','drugs','prescriptions','prescriptionItems',
  'prescriptionTemplates','treatmentPlans','doctors',
];

const STORES = [
  { name: 'patients', keyPath: 'id', autoIncrement: true, indexes: [['fileNumber','fileNumber',{unique:true}],['fullName','fullName'],['phone','phone'],['syncId','syncId']] },
  { name: 'appointments', keyPath: 'id', autoIncrement: true, indexes: [['patientId','patientId'],['date','date'],['syncId','syncId']] },
  { name: 'visits', keyPath: 'id', autoIncrement: true, indexes: [['patientId','patientId'],['date','date'],['syncId','syncId']] },
  { name: 'visitServices', keyPath: 'id', autoIncrement: true, indexes: [['visitId','visitId'],['syncId','syncId']] },
  { name: 'services', keyPath: 'id', autoIncrement: true, indexes: [['categoryId','categoryId'],['syncId','syncId']] },
  { name: 'serviceCategories', keyPath: 'id', autoIncrement: true, indexes: [['syncId','syncId']] },
  { name: 'payments', keyPath: 'id', autoIncrement: true, indexes: [['patientId','patientId'],['visitId','visitId'],['date','date'],['syncId','syncId']] },
  { name: 'expenses', keyPath: 'id', autoIncrement: true, indexes: [['categoryId','categoryId'],['date','date'],['syncId','syncId']] },
  { name: 'expenseCategories', keyPath: 'id', autoIncrement: true, indexes: [['syncId','syncId']] },
  { name: 'visitTypes', keyPath: 'id', autoIncrement: true, indexes: [['syncId','syncId']] },
  { name: 'paymentMethods', keyPath: 'id', autoIncrement: true, indexes: [['syncId','syncId']] },
  { name: 'appointmentStatuses', keyPath: 'id', autoIncrement: true, indexes: [['syncId','syncId']] },
  { name: 'patientSources', keyPath: 'id', autoIncrement: true, indexes: [['syncId','syncId']] },
  { name: 'drugs', keyPath: 'id', autoIncrement: true, indexes: [['tradeName','tradeName'],['syncId','syncId']] },
  { name: 'prescriptions', keyPath: 'id', autoIncrement: true, indexes: [['patientId','patientId'],['visitId','visitId'],['syncId','syncId']] },
  { name: 'prescriptionItems', keyPath: 'id', autoIncrement: true, indexes: [['prescriptionId','prescriptionId'],['syncId','syncId']] },
  { name: 'prescriptionTemplates', keyPath: 'id', autoIncrement: true, indexes: [['syncId','syncId']] },
  { name: 'treatmentPlans', keyPath: 'id', autoIncrement: true, indexes: [['patientId','patientId'],['syncId','syncId']] },
  { name: 'doctors', keyPath: 'id', autoIncrement: true, indexes: [['syncId','syncId']] },
  { name: 'settings', keyPath: 'key', autoIncrement: false, indexes: [] },
  { name: 'tombstones', keyPath: 'id', autoIncrement: true, indexes: [['store','store']] },
];

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      STORES.forEach(s => {
        if (!db.objectStoreNames.contains(s.name)) {
          const store = db.createObjectStore(s.name, { keyPath: s.keyPath, autoIncrement: s.autoIncrement });
          s.indexes.forEach(([idxName, keyPath, opts]) => store.createIndex(idxName, keyPath, opts || {}));
        }
      });
    };
    req.onsuccess = (e) => { dbInstance = e.target.result; resolve(dbInstance); };
    req.onerror = (e) => reject(e.target.error);
  });
}

function tx(storeNames, mode = 'readonly') {
  return dbInstance.transaction(storeNames, mode);
}

const DB = {
  async init() {
    await openDB();
    await ensureDefaults();
  },

  add(store, obj, opts = {}) {
    return new Promise((resolve, reject) => {
      if (SYNCED_STORES.includes(store) && !opts.skipMeta) {
        obj = { ...obj, syncId: obj.syncId || uuid(), updatedAt: new Date().toISOString(), _dirty: true };
      }
      const t = tx(store, 'readwrite').objectStore(store);
      const r = t.add(obj);
      r.onsuccess = () => { if (!opts.skipNotify && SYNCED_STORES.includes(store) && typeof onLocalChange === 'function') onLocalChange(); resolve(r.result); };
      r.onerror = () => reject(r.error);
    });
  },
  put(store, obj, opts = {}) {
    return new Promise((resolve, reject) => {
      if (SYNCED_STORES.includes(store) && !opts.skipMeta) {
        obj = { ...obj, syncId: obj.syncId || uuid(), updatedAt: new Date().toISOString(), _dirty: true };
      }
      const t = tx(store, 'readwrite').objectStore(store);
      const r = t.put(obj);
      r.onsuccess = () => { if (!opts.skipNotify && SYNCED_STORES.includes(store) && typeof onLocalChange === 'function') onLocalChange(); resolve(r.result); };
      r.onerror = () => reject(r.error);
    });
  },
  get(store, key) {
    return new Promise((resolve, reject) => {
      const r = tx(store).objectStore(store).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  },
  async delete(store, key, opts = {}) {
    if (SYNCED_STORES.includes(store) && !opts.skipTombstone) {
      const existing = await DB.get(store, key);
      if (existing && existing.syncId) {
        await DB.add('tombstones', { store, syncId: existing.syncId, deletedAt: new Date().toISOString() });
      }
    }
    return new Promise((resolve, reject) => {
      const r = tx(store, 'readwrite').objectStore(store).delete(key);
      r.onsuccess = () => { if (!opts.skipNotify && SYNCED_STORES.includes(store) && typeof onLocalChange === 'function') onLocalChange(); resolve(); };
      r.onerror = () => reject(r.error);
    });
  },
  all(store) {
    return new Promise((resolve, reject) => {
      const r = tx(store).objectStore(store).getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  },
  byIndex(store, indexName, value) {
    return new Promise((resolve, reject) => {
      const idx = tx(store).objectStore(store).index(indexName);
      const r = idx.getAll(value);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  },
  clear(store) {
    return new Promise((resolve, reject) => {
      const r = tx(store, 'readwrite').objectStore(store).clear();
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
  },
  async clearAll() {
    for (const s of STORES) await DB.clear(s.name);
  },
};

async function nextSequence(name) {
  let counters = await DB.get('settings', 'counters');
  if (!counters) counters = { key: 'counters', value: {} };
  const cur = (counters.value[name] || 0) + 1;
  counters.value[name] = cur;
  await DB.put('settings', counters);
  return cur;
}
function formatSeq(prefix, n) { return `${prefix}-${String(n).padStart(5, '0')}`; }
async function nextFileNumber() { return formatSeq('P', await nextSequence('patient')); }
async function nextRxNumber() { return formatSeq('RX', await nextSequence('rx')); }

async function ensureDefaults() {
  const clinicInfo = await DB.get('settings', 'clinicInfo');
  if (!clinicInfo) {
    await DB.put('settings', { key: 'clinicInfo', value: {
      name: 'عيادة أسنان د/ حسام عبدالحكيم عوض الشاهين',
      doctorName: 'د/ حسام عبدالحكيم عوض الشاهين',
      phone: '', address: '', logo: '', currency: 'ج.م', dateFormat: 'dd/mm/yyyy'
    }});
  }
  const counters = await DB.get('settings', 'counters');
  if (!counters) await DB.put('settings', { key: 'counters', value: { patient: 0, rx: 0 } });
  const syncConfig = await DB.get('settings', 'syncConfig');
  if (!syncConfig) await DB.put('settings', { key: 'syncConfig', value: { url: '', anonKey: '', enabled: false, lastPullAt: null } });

  const seedIfEmpty = async (store, items) => {
    const cur = await DB.all(store);
    if (cur.length === 0) for (const it of items) await DB.add(store, it);
  };

  await seedIfEmpty('serviceCategories', [
    { name: 'الكشف' }, { name: 'الوقائي' }, { name: 'الترميمي' },
    { name: 'علاج العصب' }, { name: 'الجراحة' }, { name: 'التركيبات' },
    { name: 'التقويم' }, { name: 'التجميل' },
  ]);
  const cats = await DB.all('serviceCategories');
  const catId = (name) => (cats.find(c => c.name === name) || {}).id;

  // ملاحظة: الخدمة اسم/تصنيف فقط بدون أي سعر ثابت أو افتراضي.
  // السعر يُكتب يدويًا وبحرية كاملة لكل زيارة على حدة (يُحفظ داخل سجل الزيارة نفسه).
  await seedIfEmpty('services', [
    { name: 'كشف جديد', categoryId: catId('الكشف'), active: true, notes: '' },
    { name: 'أشعة', categoryId: catId('الكشف'), active: true, notes: '' },
    { name: 'متابعة', categoryId: catId('الكشف'), active: true, notes: '' },
    { name: 'تنظيف', categoryId: catId('الوقائي'), active: true, notes: '' },
    { name: 'حشو كومبوزيت', categoryId: catId('الترميمي'), active: true, notes: '' },
    { name: 'حشو زجاجي', categoryId: catId('الترميمي'), active: true, notes: '' },
    { name: 'خلع', categoryId: catId('الجراحة'), active: true, notes: '' },
    { name: 'علاج عصب', categoryId: catId('علاج العصب'), active: true, notes: '' },
    { name: 'تركيب Crown', categoryId: catId('التركيبات'), active: true, notes: '' },
    { name: 'Bridge', categoryId: catId('التركيبات'), active: true, notes: '' },
    { name: 'Denture', categoryId: catId('التركيبات'), active: true, notes: '' },
    { name: 'تبييض', categoryId: catId('التجميل'), active: true, notes: '' },
    { name: 'تقويم', categoryId: catId('التقويم'), active: true, notes: '' },
    { name: 'أخرى', categoryId: catId('الكشف'), active: true, notes: '' },
  ]);

  await seedIfEmpty('visitTypes', ['كشف جديد','متابعة','حشو','تنظيف','خلع','علاج عصب','تركيبات','تقويم','تبييض','استشارة','أخرى'].map(name => ({ name })));
  await seedIfEmpty('paymentMethods', ['كاش','فيزا','ماستركارد','ميزة','تحويل بنكي','إنستاباي','أخرى'].map(name => ({ name })));
  await seedIfEmpty('appointmentStatuses', [
    { name: 'مجدول', color: '#8a8fa3' },
    { name: 'تم التأكيد', color: '#3d6ff0' },
    { name: 'وصل', color: '#c9962a' },
    { name: 'تم الكشف', color: '#2f8f5b' },
    { name: 'ملغي', color: '#b5453c' },
    { name: 'لم يحضر', color: '#7a4fb5' },
  ]);
  await seedIfEmpty('patientSources', ['Facebook','Instagram','Google','توصية','صديق','مريض حالي','أخرى'].map(name => ({ name })));
  await seedIfEmpty('expenseCategories', ['مستلزمات طبية','مواد أسنان','أدوات','تعقيم','إيجار','كهرباء','مياه','إنترنت','رواتب','صيانة','تسويق','مواصلات','برامج واشتراكات','أخرى'].map(name => ({ name })));
  await seedIfEmpty('drugs', [
    { tradeName: 'Amoxicillin 500', activeIngredient: 'Amoxicillin', form: 'كبسول', strength: '500mg', manufacturer: '', notes: '' },
    { tradeName: 'Augmentin', activeIngredient: 'Amoxicillin + Clavulanic Acid', form: 'قرص', strength: '1g', manufacturer: '', notes: '' },
    { tradeName: 'Brufen', activeIngredient: 'Ibuprofen', form: 'قرص', strength: '400mg', manufacturer: '', notes: '' },
    { tradeName: 'Panadol', activeIngredient: 'Paracetamol', form: 'قرص', strength: '500mg', manufacturer: '', notes: '' },
    { tradeName: 'Hexitol Mouthwash', activeIngredient: 'Chlorhexidine', form: 'غسول فم', strength: '0.12%', manufacturer: '', notes: '' },
    { tradeName: 'Cataflam', activeIngredient: 'Diclofenac Potassium', form: 'قرص', strength: '50mg', manufacturer: '', notes: '' },
  ]);
  await seedIfEmpty('prescriptionTemplates', [
    { name: 'بعد الخلع', items: [
      { drugName: 'Augmentin', dose: '1 قرص', frequency: 'مرتين يوميًا', duration: '5 أيام', route: 'عن طريق الفم', instructions: 'بعد الأكل' },
      { drugName: 'Cataflam', dose: '1 قرص', frequency: 'عند اللزوم', duration: '3 أيام', route: 'عن طريق الفم', instructions: 'بعد الأكل' },
      { drugName: 'Hexitol Mouthwash', dose: '10 مل', frequency: 'مرتين يوميًا', duration: '5 أيام', route: 'غسول فم', instructions: 'بعد الأكل' },
    ]},
    { name: 'بعد الحشو', items: [
      { drugName: 'Panadol', dose: '1 قرص', frequency: 'عند اللزوم', duration: '3 أيام', route: 'عن طريق الفم', instructions: 'عند الألم' },
    ]},
    { name: 'علاج عصب', items: [
      { drugName: 'Augmentin', dose: '1 قرص', frequency: 'مرتين يوميًا', duration: '7 أيام', route: 'عن طريق الفم', instructions: 'بعد الأكل' },
      { drugName: 'Cataflam', dose: '1 قرص', frequency: '3 مرات يوميًا', duration: '3 أيام', route: 'عن طريق الفم', instructions: 'بعد الأكل' },
    ]},
  ]);
  const doctors = await DB.all('doctors');
  if (doctors.length === 0) await DB.add('doctors', { name: 'د/ حسام عبدالحكيم عوض الشاهين', active: true });
}

/* ---------- Demo Data (optional, deletable) ---------- */
async function loadDemoData() {
  const names = ['أحمد محمود','منى سعيد','كريم عادل','ياسمين فؤاد','محمد إبراهيم','سارة وائل','عمر خالد','هبة ناصر','طارق سمير','ريم عاطف'];
  const services = await DB.all('services');
  const visitTypes = await DB.all('visitTypes');
  const methods = await DB.all('paymentMethods');
  const statuses = await DB.all('appointmentStatuses');
  const sources = await DB.all('patientSources');
  const patientIds = [];
  for (const name of names) {
    const fileNumber = await nextFileNumber();
    const id = await DB.add('patients', {
      fileNumber, fullName: name, phone: '01' + Math.floor(100000000 + Math.random()*899999999),
      altPhone: '', dob: '', gender: Math.random() > 0.5 ? 'ذكر' : 'أنثى', address: '',
      source: sources[Math.floor(Math.random()*sources.length)].name, notes: '', createdAt: new Date().toISOString(), isDeleted: false,
    });
    patientIds.push(id);
  }
  for (let i = 0; i < 20; i++) {
    const pid = patientIds[Math.floor(Math.random()*patientIds.length)];
    const d = new Date(); d.setDate(d.getDate() + Math.floor(Math.random()*20) - 10);
    await DB.add('appointments', {
      patientId: pid, date: d.toISOString().slice(0,10), time: `${9+Math.floor(Math.random()*8)}:00`,
      duration: 30, visitType: visitTypes[Math.floor(Math.random()*visitTypes.length)].name,
      expectedService: '', status: statuses[Math.floor(Math.random()*statuses.length)].name, notes: '', createdAt: new Date().toISOString(),
    });
  }
  for (let i = 0; i < 15; i++) {
    const pid = patientIds[Math.floor(Math.random()*patientIds.length)];
    const d = new Date(); d.setDate(d.getDate() - Math.floor(Math.random()*60));
    const svc = services[Math.floor(Math.random()*services.length)];
    const total = 200 + Math.floor(Math.random()*4800); // سعر يدوي تجريبي عشوائي لكل حالة (لا يوجد سعر افتراضي للخدمة)
    const paid = Math.random() > 0.4 ? total : Math.floor(total * 0.5);
    const visitId = await DB.add('visits', {
      patientId: pid, appointmentId: null, date: d.toISOString().slice(0,10), visitType: visitTypes[Math.floor(Math.random()*visitTypes.length)].name,
      diagnosis: '', doctorNotes: '', discountType: 'fixed', discountValue: 0,
      subtotal: total, total, paid, remaining: total - paid, createdAt: d.toISOString(), isDeleted: false,
    });
    await DB.add('visitServices', { visitId, serviceId: svc.id, serviceName: svc.name, tooth: '', price: total, qty: 1 });
    if (paid > 0) await DB.add('payments', { patientId: pid, visitId, date: d.toISOString().slice(0,10), amount: paid, method: methods[Math.floor(Math.random()*methods.length)].name, notes: '', createdAt: d.toISOString() });
  }
  const expCats = await DB.all('expenseCategories');
  for (let i = 0; i < 12; i++) {
    const d = new Date(); d.setDate(d.getDate() - Math.floor(Math.random()*60));
    await DB.add('expenses', { date: d.toISOString().slice(0,10), categoryId: expCats[Math.floor(Math.random()*expCats.length)].id, description: 'مصروف تجريبي', amount: Math.floor(100+Math.random()*2000), method: methods[Math.floor(Math.random()*methods.length)].name, notes: '' });
  }
}

async function deleteDemoData() {
  // Demo data is identified by absence of a distinguishing "real" flag; simplest safe approach:
  // clear everything except settings/lists, since demo is meant to be tried on a fresh install.
  const stores = ['patients','appointments','visits','visitServices','payments','expenses','prescriptions','prescriptionItems','treatmentPlans'];
  for (const s of stores) await DB.clear(s);
  const counters = await DB.get('settings', 'counters');
  counters.value.patient = 0; counters.value.rx = 0;
  await DB.put('settings', counters);
}

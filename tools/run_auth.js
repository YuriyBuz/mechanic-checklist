/**
 * Прогін автентифікації в Node зі стабами Apps Script.
 * Кадрова таблиця — справжні рядки з «_REF_Employees».
 */
const fs = require('fs'), vm = require('vm');
const { store, Sheet, SS } = require('./gas_stub.js');
const SRC = __dirname + '/../apps-script/';

const HR_HEAD = ['emp_id','ПІБ повне','ПІБ короткий','прізвище','pos_id','посада','підрозділ',
  'статус','дата прийому','дата звільнення','телефон','дата народження','екстрений: хто',
  'екстрений: телефон','email','таб_1С','PIN','ролі додатково','ролі відібрані'];
const e = (id, name, short, pos, job, st, mail, pin, extra, final) => {
  const r = Array(19).fill('');
  r[0]=id; r[1]=name; r[2]=short; r[4]=pos; r[5]=job; r[7]=st; r[14]=mail; r[16]=pin;
  r[17]=extra||''; r[18]=final||''; return r;
};
const HR_EMP = [HR_HEAD,
  e('EMP-0061','Анастасія Диндар','Анастасія Д.','','','active','dyndarnastia@gmail.com','8899','admin'),
  e('EMP-0001','Бондаренко Валерій Валентинович','Бондаренко В. В.','POS-010','Оператор-налагоджувальник','active','','1111'),
  e('EMP-0005','Галагін Євгеній Ярославович','Галагін Є. Я.','POS-003','Головний інженер','active','','6699'),
  e('EMP-0006','Гончарук Ольга Михайлівна','Гончарук О. М.','POS-004','Майстер зміни','active','','1111'),
  e('EMP-0007','Гора Андрій Олександрович','Гора А. О.','POS-005','Механік зміни','active','','1111'),
  e('EMP-0018','Максімюк Анатолій Вікторович','Максімюк А. В.','POS-006','Налагоджувальник','active','','1111'),
  e('EMP-0041','Сабадаш Геннадій Петрович','Сабадаш Г. П.','POS-005','Механік зміни','active','','3773'),
  e('EMP-0032','Шута Олександра Сергіівна','Шута О. С.','POS-004','Майстер зміни','active','','1111'),
  e('EMP-0062','Юрій Бузницький','Юрій Б.','','','active','Buznitskiy7@gmail.com','9988','admin'),
  e('EMP-0049','Свінцов Михайло Генадійович','Свінцов М. Г.','POS-005','Механік зміни','fired','','7777')];
const HR_POS = [['pos_id','назва посади','підрозділ','ролі типові'],
  ['POS-003','Головний інженер','Інженерна','zip.admin mech.admin'],
  ['POS-004','Майстер зміни','Виробництво','shift.master'],
  ['POS-005','Механік зміни','Інженерна','mech.use,zip.use'],
  ['POS-006','Налагоджувальник','Інженерна',''],
  ['POS-010','Оператор-налагоджувальник','Виробництво','']];

const ITEMS_HEAD = ['item_id','role','group_id','group_title','seq','text','type','fields','unit',
  'labels','visible_on','photo_required','norm_min_1','norm_max_1','warn_min_1','warn_max_1',
  'norm_min_2','norm_max_2','warn_min_2','warn_max_2','norm_min_3','norm_max_3','warn_min_3','warn_max_3',
  'active_from','active_to','text_aliases','notes'];
const item = (id, role, txt, type) => { const r = Array(28).fill(''); r[0]=id; r[1]=role;
  r[3]='Група'; r[4]=1; r[5]=txt; r[6]=type; r[7]=1; r[10]='both'; return r; };

const book = new SS('15Pmhi9IvQZAyVbGpPbzTgwN-ETPpRmYSXiDjLkLEnhU', [
  new Sheet('01_Пункти', [ITEMS_HEAD, item('mech.1-1','Механік','Температура компресорів','number'),
                          item('mast.1-1','Майстер','Стан цеху','binary')]),
  new Sheet('02_Варіанти', [['item_id','seq','value','status','active'], ['mast.1-1',1,'Так','ok','так']]),
  new Sheet('03_Працівники', [['user_id','full_name','role','active','aliases'],
    ['U-001','Галагін Євгеній Ярославович','Механік',true,'Галагін Евгеній'],
    ['U-002','Сабадаш Геннадій Петрович','Механік',true,''],
    ['U-003','Гора Андрій Олександрович','Механік',true,'Гора Андрій'],
    ['U-004','Свінцов Михайло','Механік',false,''],
    ['U-005','Гончарук Ольга','Майстер',true,''],
    ['U-006','Шута Олександра','Майстер',true,''],
    ['U-000','(особу не встановлено)','Механік',false,'Заміна']]),
  new Sheet('11_Звіти', [['report_id','ts_server','business_date','stage','role','user_id',
    'user_name_snapshot','config_version','items_total','cnt_ok','cnt_warn','cnt_alert','cnt_empty',
    'photos_saved','photos_failed','source','raw_row','app_version']]),
  new Sheet('12_Відповіді', [['answer_id','report_id','business_date','stage','role','user_id','item_id',
    'item_text_snapshot','seq','value_text','value_num_1','value_num_2','value_num_3','status',
    'status_original','comment','photo_url']]),
  new Sheet('13_Фото', [['photo_id','report_id','item_id','url','drive_file_id','status','error']]),
  new Sheet('14_Журнал_подій', [['ts','type','event','report_id','user_id','details','app_version']]),
  new Sheet('21_Розклад', [['business_date','stage','role','expected','received','status']]),
  new Sheet('22_Дашборд', [['показник','значення','коментар']])]);
store.books.active = book;
store.books['1UhdO9ALcSXk8fgWhUnMiluO4Aao6R4EP6iN4Ie__rY8'] =
  new SS('hr', [new Sheet('_REF_Positions', HR_POS, 1), new Sheet('_REF_Employees', HR_EMP, 755156661)]);

const ctx = vm.createContext(global);
['Common', 'Auth', 'Report', 'Code'].forEach(f =>
  vm.runInContext(fs.readFileSync(SRC + f + '.gs', 'utf8'), ctx, { filename: f + '.gs' }));

let fails = 0;
const t = (n, c) => { console.log((c ? '  ✅ ' : '  ❌ ') + n); if (!c) fails++; };

console.log('\n── authSelfTest() ──');
const st = authSelfTest();
console.log(st.split('\n').map(l => '  ' + l).join('\n'));
if (st.indexOf('❌') > -1) fails++;

console.log('\n── auditPins() ──');
const audit = auditPins();
console.log(audit.split('\n').map(l => '  ' + l).join('\n'));

console.log('\n── addMissingEmployees() ──');
const before = readTable('03_Працівники').rows.filter(r => r[0]).length;
console.log(addMissingEmployees().split('\n').map(l => '  ' + l).join('\n'));
const after = readTable('03_Працівники').rows.filter(r => r[0]).length;
t('додано рівно двох (Диндар і Бузницький)', after - before === 2);
const staff = readTable('03_Працівники').rows;
const dyn = staff.filter(r => String(r[1]).indexOf('Диндар') > -1)[0];
t('  Диндар зʼявилася', !!dyn);
t('  роль «Керівник» (обидва чек-листи)', dyn && dyn[2] === 'Керівник');
t('  ід продовжує нумерацію', dyn && /^U-0\d\d$/.test(dyn[0]) && dyn[0] !== 'U-000');
t('  активна', dyn && dyn[3] === true);
t('звільненого не додано',
  !staff.some(r => String(r[1]).indexOf('Свінцов Михайло Генадійович') > -1));
t('чужих ролей не додано', !staff.some(r => String(r[1]).indexOf('Бондаренко') > -1));
const repeat = addMissingEmployees();
t('повторний запуск нічого не робить', repeat.indexOf('вже є в') > -1);
t('  і рядків не побільшало',
  readTable('03_Працівники').rows.filter(r => r[0]).length === after);
t('тепер вхід дає справжній user_id, а не U-000',
  loginWithPin_('9988', 'devX').user_id !== 'U-000');

console.log('\n── вхід ──');
t('невірний PIN не пускає', loginWithPin_('0007', 'dev1').code === 'BAD_PIN');
t('порожній PIN не пускає', loginWithPin_('', 'dev1').code === 'BAD_PIN');

const dup = loginWithPin_('1111', 'dev2');
t('спільний «1111» відхилено', dup.code === 'PIN_NOT_UNIQUE');
t('  і пояснено чому', /кількома працівниками/.test(dup.error));

const sab = loginWithPin_('3773', 'dev3');
t('Сабадаш заходить', sab.success === true);
t('  → механік, без майстра', sab.permissions.indexOf('submitMech') > -1 && sab.permissions.indexOf('submitMaster') === -1);
t('  → без пошти (mech.use)', sab.permissions.indexOf('reportEmail') === -1);
t('  → user_id з довідника', sab.user_id === 'U-002');
t('  → PIN у відповіді немає', JSON.stringify(sab).indexOf('3773') === -1);

const gal = loginWithPin_('6699', 'dev4');
t('Галагін: mech.admin + пошта', gal.success && gal.permissions.indexOf('reportEmail') > -1
  && gal.permissions.indexOf('submitMaster') === -1);
const adm = loginWithPin_('9988', 'dev5');
t('Бузницький: admin — обидва чек-листи', adm.permissions.length === 3);
t('  і має власний user_id після addMissingEmployees()', /^U-0\d\d$/.test(adm.user_id) && adm.user_id !== 'U-000');
t('до цього auditPins() показував, що його немає в довіднику',
  audit.indexOf('⚠ немає в 03_Працівники') > -1);
t('звільнений не заходить', loginWithPin_('7777', 'dev6').code === 'BAD_PIN');
t('чужа роль (qc.use) доступу не має', permissionsFor_(['qc.use']).length === 0);

console.log('\n── обмеження спроб ──');
for (let i = 0; i < 5; i++) loginWithPin_('0001', 'attacker');
t('після 5 невдач пристрій у паузі', loginWithPin_('3773', 'attacker').code === 'THROTTLED');
t('інший пристрій не постраждав', loginWithPin_('3773', 'dev3').success === true);

console.log('\n── сесія ──');
t('токен діє на своєму пристрої', !!verifySession_(sab.token, 'dev3'));
t('на чужому пристрої НЕ діє', verifySession_(sab.token, 'dev-чужий') === null);
t('підроблений підпис відхилено', verifySession_(sab.token.split('.')[0] + '.XX', 'dev3') === null);
t('права читаються з кадрової, не з токена', verifySession_(sab.token, 'dev3').roles.join() === 'mech.use,zip.use');

// звільнення діє негайно — не чекаючи, поки скінчиться сесія
const hr = store.books['1UhdO9ALcSXk8fgWhUnMiluO4Aao6R4EP6iN4Ie__rY8'].getSheetByName('_REF_Employees');
hr.getRange(8, 8).setValue('fired');                  // рядок Сабадаша, колонка H
t('після звільнення сесія вмирає одразу', verifySession_(sab.token, 'dev3') === null);
hr.getRange(8, 8).setValue('active');
t('  і оживає, коли статус повернули', !!verifySession_(sab.token, 'dev3'));

console.log('\n── права на здачу звіту ──');
const mkPayload = (role, token, dev) => ({
  report_id: 'T' + Math.random(), business_date: '2026-08-24', stage: 'Початок зміни', role: role,
  user_name: 'хто завгодно', user_id: 'U-999', token: token, deviceId: dev,
  items: [{ item_id: role === 'Майстер' ? 'mast.1-1' : 'mech.1-1', value: '55', values: ['55'], comment: '' }]
});
t('механік не здає чек-лист майстра',
  submitReport_(mkPayload('Майстер', sab.token, 'dev3')).error === 'FORBIDDEN');
t('механік здає свій', submitReport_(mkPayload('Механік', sab.token, 'dev3')).ok === true);
t('адміністратор здає обидва',
  submitReport_(mkPayload('Механік', adm.token, 'dev5')).ok === true &&
  submitReport_(mkPayload('Майстер', adm.token, 'dev5')).ok === true);
const anon = submitReport_(mkPayload('Механік', '', ''));
t('без токена приймається, поки AUTH_REQUIRED не «так»', anon.ok === true);

store.props['AUTH_REQUIRED'] = 'так';
t('з AUTH_REQUIRED=так — відмова', submitReport_(mkPayload('Механік', '', '')).error === 'AUTH');
t('  а з токеном — приймається', submitReport_(mkPayload('Механік', sab.token, 'dev3')).ok === true);
t('  токен із чужого пристрою не пише',
  submitReport_(mkPayload('Механік', sab.token, 'підмінений')).error === 'AUTH');
t('  прострочений токен не пише',
  submitReport_(mkPayload('Механік', issueToken_({ id: 'EMP-0041' }, 'dev3', Date.now() - 1000), 'dev3')).error === 'AUTH');
store.props['AUTH_REQUIRED'] = 'ні';

console.log('\n── автора підмінити не можна ──');
const rep = readTable('11_Звіти');
const mine = rep.rows.filter(r => r[5] === 'U-002');
t('звіт підписано Сабадашем, а не «хто завгодно»',
  mine.length > 0 && mine.every(r => r[6] === 'Сабадаш Геннадій Петрович'));

console.log('\n── одержувачі листа ──');
store.props['MAIL_TO'] = 'engineer@example.com';
t('mech.use → пошта автора не додається',
  recipientsFor_(verifySession_(sab.token, 'dev3')).join() === 'engineer@example.com');
t('admin → додається власна пошта',
  recipientsFor_(verifySession_(adm.token, 'dev5')).join() === 'engineer@example.com,Buznitskiy7@gmail.com');
store.props['MAIL_TO'] = 'engineer@example.com,buznitskiy7@gmail.com';
t('дубль пошти не додається', recipientsFor_(verifySession_(adm.token, 'dev5')).length === 2);

console.log('\n── відповідь клієнтові ──');
const lr = loginResponse_(loginWithPin_('9988', 'dev5'));
t('login → ok + права', lr.ok && lr.user.can.mech && lr.user.can.master && lr.user.can.email);
t('  без PIN і без списку працівників',
  JSON.stringify(lr).indexOf('9988') === -1 && JSON.stringify(lr).indexOf('Сабадаш') === -1);
const lr2 = loginResponse_(loginWithPin_('1111', 'dev9'));
t('дубль → зрозуміла відмова', !lr2.ok && lr2.error === 'PIN_NOT_UNIQUE' && !!lr2.message);
t('whoami без сесії → AUTH', sessionResponse_(null).error === 'AUTH');

console.log('\n' + (fails ? '❌ ПОМИЛОК: ' + fails : '✅ Усі перевірки пройдено'));
process.exit(fails ? 1 : 0);

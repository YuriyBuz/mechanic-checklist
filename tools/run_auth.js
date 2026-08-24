const fs = require('fs'), vm = require('vm');
const { store, Sheet, SS } = require('./gas_stub.js');
const SRC = __dirname + '/../apps-script/';

// ── кадрова таблиця (справжні рядки, скорочено до потрібних колонок) ──
const HR_HEAD = ['emp_id','ПІБ повне','ПІБ короткий','прізвище','pos_id','посада','підрозділ',
  'статус','дата прийому','дата звільнення','телефон','дата народження','екстрений: хто',
  'екстрений: телефон','email','таб_1С','PIN','ролі додатково','ролі відібрані','джерело','оновлено','логін порталу','пароль'];
const e = (id,name,pos,job,st,mail,pin,extra) => {
  const r = Array(23).fill('');
  r[0]=id; r[1]=name; r[4]=pos; r[5]=job; r[7]=st; r[14]=mail; r[16]=pin; r[17]=extra||''; return r;
};
const HR_EMP = [HR_HEAD,
  e('EMP-0061','Анастасія Диндар','','','active','dyndarnastia@gmail.com','8899','admin'),
  e('EMP-0001','Бондаренко Валерій Валентинович','POS-010','Оператор-налагоджувальник','active','','1111'),
  e('EMP-0005','Галагін Євгеній Ярославович','POS-003','Головний інженер','active','','6699'),
  e('EMP-0006','Гончарук Ольга Михайлівна','POS-004','Майстер зміни','active','','1111'),
  e('EMP-0007','Гора Андрій Олександрович','POS-005','Механік зміни','active','','1111'),
  e('EMP-0018','Максімюк Анатолій Вікторович','POS-006','Налагоджувальник','active','','1111'),
  e('EMP-0041','Сабадаш Геннадій Петрович','POS-005','Механік зміни','active','','3773'),
  e('EMP-0032','Шута Олександра Сергіівна','POS-004','Майстер зміни','active','','1111'),
  e('EMP-0062','Юрій Бузницький','','','active','Buznitskiy7@gmail.com','9988','admin'),
  e('EMP-0049','Свінцов Михайло Генадійович','POS-005','Механік зміни','fired','','')];
const HR_POS = [['pos_id','назва посади','підрозділ','ролі типові'],
  ['POS-003','Головний інженер','Інженерна','zip.admin mech.admin'],
  ['POS-004','Майстер зміни','Виробництво','shift.master'],
  ['POS-005','Механік зміни','Інженерна','mech.use,zip.use'],
  ['POS-006','Налагоджувальник','Інженерна',''],
  ['POS-010','Оператор-налагоджувальник','Виробництво','']];

// ── робоча таблиця ──
const ITEMS_HEAD = ['item_id','role','group_id','group_title','seq','text','type','fields','unit',
  'labels','visible_on','photo_required','norm_min_1','norm_max_1','warn_min_1','warn_max_1',
  'norm_min_2','norm_max_2','warn_min_2','warn_max_2','norm_min_3','norm_max_3','warn_min_3','warn_max_3',
  'active_from','active_to','text_aliases','notes'];
const item = (id,role,txt,type) => { const r=Array(28).fill(''); r[0]=id; r[1]=role; r[3]='Група';
  r[4]=1; r[5]=txt; r[6]=type; r[7]=1; r[10]='both'; return r; };
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
  new Sheet('04_Доступ', [[]]),
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
  new SS('hr', [new Sheet('Посади', HR_POS, 1), new Sheet('Працівники', HR_EMP, 755156661)]);

// ── завантажуємо .gs у спільну область видимості, як це робить Apps Script ──
const ctx = vm.createContext(global);
['Common','Auth','Report','Code'].forEach(f =>
  vm.runInContext(fs.readFileSync(SRC + f + '.gs', 'utf8'), ctx, { filename: f + '.gs' }));

// схема 04_Доступ (беремо заголовок з Auth.gs, без запуску всього setupSchema)
book.getSheetByName('04_Доступ').getRange(1, 1, 1, ACCESS_COLS.length).setValues([ACCESS_COLS]);

let fails = 0;
const t = (n, c) => { console.log((c ? '  ✅ ' : '  ❌ ') + n); if (!c) fails++; };

console.log('\n── authSelfTest() ──');
const st = authSelfTest();
console.log(st.split('\n').map(l => '  ' + l).join('\n'));
if (st.indexOf('❌') > -1) fails++;

console.log('\n── syncAccessFromHr() ──');
console.log(syncAccessFromHr().split('\n').map(l => '  ' + l).join('\n'));

// дістаємо видані PIN із журналу, щоб продовжити сценарій
const issued = {};
store.log.join('\n').split('\n').forEach(l => {
  const m = /^\s+(\d{4})\s{3}(.+?)\s{3}\(/.exec(l);
  if (m) issued[m[2].trim()] = m[1];
});

console.log('\n── вхід ──');
t('невірний PIN не пускає', authLogin_('0007', 'dev1').ok === false);
t('порожній PIN не пускає', authLogin_('', 'dev1').ok === false);

const gora = authLogin_(issued['Гора Андрій Олександрович'], 'dev2');
t('Гора заходить виданим PIN', gora.ok === true);
t('  → механік так, майстер ні', gora.user.can.mech === true && gora.user.can.master === false);
t('  → пошти немає (mech.use)', gora.user.can.email === false);
t('  → просить змінити PIN', gora.must_change === true);
t('  → user_id з довідника', gora.user.user_id === 'U-003');

const sab = authLogin_('3773', 'dev3');
t('Сабадаш заходить кадровим PIN', sab.ok === true && sab.must_change === false);
const gal = authLogin_('6699', 'dev4');
t('Галагін: mech.admin', gal.ok && gal.user.can.mech && !gal.user.can.master);
const adm = authLogin_('9988', 'dev5');
t('Бузницький: admin бачить обидва', adm.ok && adm.user.can.mech && adm.user.can.master && adm.user.can.email);
const mas = authLogin_(issued['Шута Олександра Сергіівна'], 'dev6');
t('Шута: тільки майстер', mas.ok && mas.user.can.master && !mas.user.can.mech);
t('Свінцов (звільнений) не має PIN', authLogin_('1111', 'dev7').ok === false);

console.log('\n── обмеження спроб ──');
for (let i = 0; i < 5; i++) authLogin_('0001', 'attacker');
t('після 5 невдач пристрій у паузі', authLogin_('3773', 'attacker').error === 'throttled');
t('інший пристрій не постраждав', authLogin_('3773', 'dev3').ok === true);

console.log('\n── зміна PIN ──');
const oldPin = issued['Гора Андрій Олександрович'];
t('старий PIN не збігається → відмова',
  authChangePin_(gora.token, '0000', '4821').error === 'bad_old_pin');
t('слабкий новий PIN → відмова', authChangePin_(gora.token, oldPin, '1111').error === 'weak_pin');
t('короткий новий PIN → відмова', authChangePin_(gora.token, oldPin, '12').error === 'bad_new_pin');
t('чужий PIN зайнятий → відмова', authChangePin_(gora.token, oldPin, '3773').error === 'pin_taken');
const ch = authChangePin_(gora.token, oldPin, '4821');
t('зміна проходить', ch.ok === true && !!ch.token);
t('старий токен більше не діє', authWhoami_(gora.token).ok === false);
t('новий токен діє', authWhoami_(ch.token).ok === true);
t('старий PIN більше не пускає', authLogin_(oldPin, 'dev8').ok === false);
const again = authLogin_('4821', 'dev8');
t('новий PIN пускає', again.ok === true);
t('вимога зміни знята', again.must_change === false);

console.log('\n── права на здачу звіту ──');
const mkPayload = (role, token) => ({
  report_id: 'T' + Math.random(), business_date: '2026-08-24', stage: 'Початок зміни', role: role,
  user_name: 'хто завгодно', token: token,
  items: [{ item_id: role === 'Майстер' ? 'mast.1-1' : 'mech.1-1', value: '55', values: ['55'], comment: '' }]
});
t('механік не здає чек-лист майстра',
  submitReport_(mkPayload('Майстер', again.token)).error === 'forbidden');
const masOk = authChangePin_(mas.token, issued['Шута Олександра Сергіівна'], '5093');
t('майстер змінив тимчасовий PIN', masOk.ok === true);
t('майстер не здає чек-лист механіка',
  submitReport_(mkPayload('Механік', masOk.token)).error === 'forbidden');
t('майстер здає свій чек-лист',
  submitReport_(mkPayload('Майстер', masOk.token)).ok === true);
t('адміністратор здає обидва',
  submitReport_(mkPayload('Механік', adm.token)).ok === true &&
  submitReport_(mkPayload('Майстер', adm.token)).ok === true);
const must = authLogin_(issued['Гончарук Ольга Михайлівна'], 'dev9');
t('з тимчасовим PIN звіт не приймається',
  submitReport_(mkPayload('Майстер', must.token)).error === 'pin_change_required');

const anon = submitReport_(mkPayload('Механік', ''));
t('без токена приймається, поки AUTH_REQUIRED не «так»', anon.ok === true);
store.props['AUTH_REQUIRED'] = 'так';
t('з AUTH_REQUIRED=так — відмова', submitReport_(mkPayload('Механік', '')).error === 'auth');
t('  а з токеном — приймається', submitReport_(mkPayload('Механік', again.token)).ok === true);
store.props['AUTH_REQUIRED'] = 'ні';

console.log('\n── автора підмінити не можна ──');
const rep = readTable('11_Звіти');
const mine = rep.rows.filter(r => r[5] === 'U-003');
t('звіт підписано Горою, а не «хто завгодно»',
  mine.length > 0 && mine.every(r => r[6] === 'Гора Андрій Олександрович'));

console.log('\n── одержувачі листа ──');
t('mech.use → тільки MAIL_TO', JSON.stringify(recipientsFor_(authUserByToken_(again.token))) === '[]');
store.props['MAIL_TO'] = 'engineer@example.com';
t('mech.use → пошта не додається',
  recipientsFor_(authUserByToken_(again.token)).join() === 'engineer@example.com');
t('admin → додається власна пошта',
  recipientsFor_(authUserByToken_(adm.token)).join() === 'engineer@example.com,Buznitskiy7@gmail.com');
store.props['MAIL_TO'] = 'engineer@example.com,buznitskiy7@gmail.com';
t('дубль пошти не додається',
  recipientsFor_(authUserByToken_(adm.token)).length === 2);

console.log('\n── повторна синхронізація нічого не ламає ──');
const before = readTable('04_Доступ').rows.map(r => r.join('|'));
syncAccessFromHr();
const after = readTable('04_Доступ').rows.map(r => r.join('|'));
t('кількість рядків не змінилась', before.length === after.length);
t('зміна PIN пережила синхронізацію', authLogin_('4821', 'dev10').ok === true);
t('видані PIN не перевидано', authLogin_('5093', 'dev11').ok === true);
t('однакових PIN немає', authStatus().indexOf('✅ Однакових PIN немає') > -1);

console.log('\n' + (fails ? '❌ ПОМИЛОК: ' + fails : '✅ Усі перевірки пройдено'));
process.exit(fails ? 1 : 0);

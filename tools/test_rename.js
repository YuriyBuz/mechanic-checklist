const fs = require('fs'), vm = require('vm');
const { store, Sheet, SS } = require('./gas_stub.js');
const SRC = __dirname + '/../apps-script/';
const IT = ['item_id','role','group_id','group_title','seq','text','type','fields','unit','labels',
  'visible_on','photo_required','norm_min_1','norm_max_1','warn_min_1','warn_max_1','norm_min_2',
  'norm_max_2','warn_min_2','warn_max_2','norm_min_3','norm_max_3','warn_min_3','warn_max_3',
  'active_from','active_to','text_aliases','notes'];
const row = (id, gid) => { const r = Array(28).fill(''); r[0]=id; r[1]='Майстер'; r[2]=gid;
  r[3]='Група'; r[4]=1; r[5]='текст'; r[6]='binary'; r[10]='start'; return r; };
const book = new SS('x', [
  new Sheet('01_Пункти', [IT, row('master.m1-1','m1'), row('master.m5-3','m5'), row('master.m9-1','m9'),
                          (() => { const r = row('mech.1-1','1'); r[1]='Механік'; return r; })()]),
  new Sheet('02_Варіанти', [['item_id','seq','value','status','active'],
    ['master.m1-1',1,'Виконано','ok','так'], ['master.m9-1',1,'Виконано','ok','так'], ['mech.1-1',1,'—','ok','так']]),
  new Sheet('12_Відповіді', [['answer_id','report_id','business_date','stage','role','user_id','item_id',
    'item_text_snapshot','seq','value_text','value_num_1','value_num_2','value_num_3','status',
    'status_original','comment','photo_url'],
    ['a1','r1','2026-08-01','Початок зміни','Майстер','U-005','master.m1-1','т',1,'Виконано','','','','ok','ok','',''],
    ['a2','r1','2026-08-01','Кінець зміни','Майстер','U-005','master.m5-3','т',2,'Виконано','','','','ok','ok','',''],
    ['a3','r2','2026-08-01','Початок зміни','Механік','U-003','mech.1-1','т',1,'55','55','','','ok','ok','','']]),
  new Sheet('13_Фото', [['photo_id','report_id','item_id','url','drive_file_id','status','error'],
    ['p1','r1','master.m9-1','u','f','saved','']]),
  new Sheet('14_Журнал_подій', [['ts','type','event','report_id','user_id','details','app_version']])]);
store.books.active = book;
const ctx = vm.createContext(global);
['Common','Migrate'].forEach(f => vm.runInContext(fs.readFileSync(SRC + f + '.gs','utf8'), ctx, {filename:f}));

let fails = 0;
const t = (n,c) => { console.log((c?'  ✅ ':'  ❌ ')+n); if(!c) fails++; };
console.log(renameMasterItems().split('\n').map(l=>'  '+l).join('\n'));
const ids = () => readTable('01_Пункти').rows.map(r=>r[0]).filter(String);
t('m1-1 → s1-1', ids().indexOf('master.s1-1') > -1);
t('m5-3 → e1-3', ids().indexOf('master.e1-3') > -1);
t('m9-1 → e5-1', ids().indexOf('master.e5-1') > -1);
t('пункт механіка не зачеплено', ids().indexOf('mech.1-1') > -1);
t('старих ід не лишилось', !ids().some(i=>/^master\.m/.test(i)));
const g = readTable('01_Пункти');
t('group_id теж оновлено',
  g.rows.filter(r=>r[0]==='master.s1-1')[0][2]==='start-1' &&
  g.rows.filter(r=>r[0]==='master.e5-1')[0][2]==='end-5');
const ans = readTable('12_Відповіді').rows.map(r=>r[6]).filter(String);
t('відповіді перепривʼязані', ans.indexOf('master.s1-1')>-1 && ans.indexOf('master.e1-3')>-1);
t('відповідь механіка ціла', ans.indexOf('mech.1-1')>-1);
t('варіанти перепривʼязані', readTable('02_Варіанти').rows.map(r=>r[0]).indexOf('master.s1-1')>-1);
t('фото перепривʼязано', readTable('13_Фото').rows[0][2]==='master.e5-1');
const again = renameMasterItems();
t('повторний запуск нічого не робить', again.indexOf('Нічого перейменовувати')===0);
console.log('   ' + again);
console.log('\n' + (fails ? '❌ ПОМИЛОК: '+fails : '✅ Усі перевірки пройдено'));
process.exit(fails?1:0);

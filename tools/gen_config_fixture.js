/* Збирає tools/config_fixture.json — те, що справжній сервер віддає клієнту
   на getConfig після seedV4(). Одне джерело правди: Seed.gs + SeedV4.gs +
   buildClientConfig_ із Code.gs, прогнані через стаб Apps Script.
   Mock-сервер (mock_server.js) віддає цей файл браузерним тестам.

       node tools/gen_config_fixture.js
*/
const fs = require('fs'), vm = require('vm');
const { store, Sheet, SS } = require('./gas_stub.js');
const SRC = __dirname + '/../apps-script/';

const ITEMS_HEAD = ['item_id','role','group_id','group_title','seq','text','type','fields','unit',
  'labels','visible_on','photo_required','norm_min_1','norm_max_1','warn_min_1','warn_max_1',
  'norm_min_2','norm_max_2','warn_min_2','warn_max_2','norm_min_3','norm_max_3','warn_min_3','warn_max_3',
  'active_from','active_to','text_aliases','notes'];
const book = new SS('fixture', [
  new Sheet('01_Пункти', [ITEMS_HEAD]),
  new Sheet('02_Варіанти', [['item_id','seq','value','status','active']]),
  new Sheet('03_Працівники', [['user_id','full_name','role','active','aliases'],
    ['U-003','Гора Андрій Олександрович','Механік',true,'']]),
  new Sheet('11_Звіти', [['report_id','ts_server','business_date','stage','role','user_id',
    'user_name_snapshot','config_version','items_total','cnt_ok','cnt_warn','cnt_alert','cnt_empty',
    'photos_saved','photos_failed','source','raw_row','app_version']]),
  new Sheet('12_Відповіді', [['answer_id','report_id','business_date','stage','role','user_id','item_id',
    'item_text_snapshot','seq','value_text','value_num_1','value_num_2','value_num_3','status',
    'status_original','comment','photo_url']]),
  new Sheet('14_Журнал_подій', [['ts','type','event','report_id','user_id','details','app_version']])]);
store.books.active = book;

const ctx = vm.createContext(global);
['Common', 'Auth', 'Report', 'Code', 'Schema', 'Seed', 'SeedV4', 'Migrate'].forEach(f =>
  vm.runInContext(fs.readFileSync(SRC + f + '.gs', 'utf8'), ctx, { filename: f + '.gs' }));

seedDictionaries();          // v3 як база (щоб пункти, що лишаються, мали свої варіанти)
seedV4(businessDate());      // v4 — від сьогодні
const cfg = buildClientConfig_('Механік', null);
delete cfg.employees;
fs.writeFileSync(__dirname + '/config_fixture.json', JSON.stringify(cfg, null, 1));
console.log('config_fixture.json: ' + cfg.items.length + ' пунктів, версія ' + cfg.config_version);

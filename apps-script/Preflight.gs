/**
 * Preflight.gs — перевірка перед запуском. Нічого не змінює, тільки читає.
 *
 * Запустіть preflight() і надішліть вміст «Журналу виконання».
 * Він відповість на головні питання: та це таблиця? чи всі файли на місці?
 * чи не переміг старий doPost? що вже створено?
 */

/** Найпростіша перевірка: чи взагалі виконується код у цьому проєкті. */
function ping() {
  var msg = 'ping ok · ' + new Date();
  Logger.log(msg);
  return msg;
}

/** Другий крок: чи є доступ до таблиці (тут з'явиться запит авторизації). */
function pingSpreadsheet() {
  var ss_ = SpreadsheetApp.getActive();
  var msg = ss_ ? ('таблиця: ' + ss_.getName() + ' · ' + ss_.getId())
                : 'getActive() повернув null — скрипт не прив\'язаний до таблиці';
  Logger.log(msg);
  return msg;
}

function preflight() {
  var out = [];
  function say(ok, text) { out.push((ok === null ? '·  ' : (ok ? '✅ ' : '❌ ')) + text); }

  // --- 1. до якої таблиці прив'язаний скрипт ---
  var ss_;
  try {
    ss_ = SpreadsheetApp.getActive();
  } catch (e) {
    ss_ = null;
  }
  if (!ss_) {
    say(false, 'Скрипт НЕ прив\'язаний до таблиці. Відкрийте Apps Script із самої таблиці ' +
               'check-list-mechanic (Розширення → Apps Script), а не як окремий проєкт.');
    Logger.log(out.join('\n'));
    return out.join('\n');
  }
  var EXPECTED_ID = '15Pmhi9IvQZAyVbGpPbzTgwN-ETPpRmYSXiDjLkLEnhU';
  say(ss_.getId() === EXPECTED_ID,
      'Таблиця: «' + ss_.getName() + '» (' + ss_.getId() + ')' +
      (ss_.getId() === EXPECTED_ID ? '' : '  ← ОЧІКУВАЛАСЬ check-list-mechanic!'));

  // --- 2. чи завантажилися файли ---
  say(typeof SH !== 'undefined', 'Common.gs ' + (typeof SH !== 'undefined' ? 'на місці' : 'ВІДСУТНІЙ'));
  say(typeof SEED_ITEMS !== 'undefined',
      'Seed.gs: ' + (typeof SEED_ITEMS === 'undefined' ? 'ВІДСУТНІЙ' :
        SEED_ITEMS.length + ' пунктів, ' + SEED_OPTIONS.length + ' варіантів, ' +
        SEED_EMPLOYEES.length + ' працівників'));
  say(typeof schemaDefs_ === 'function',
      'Schema.gs: ' + (typeof schemaDefs_ === 'function'
        ? 'виправлена версія (schemaDefs_)'
        : (typeof SCHEMA !== 'undefined' ? 'СТАРА версія — замініть файл!' : 'ВІДСУТНІЙ')));
  say(typeof migrateLegacy === 'function', 'Migrate.gs ' + (typeof migrateLegacy === 'function' ? 'на місці' : 'ВІДСУТНІЙ'));
  say(typeof sendReportEmail_ === 'function', 'Report.gs ' + (typeof sendReportEmail_ === 'function' ? 'на місці' : 'ВІДСУТНІЙ'));
  say(typeof loginWithPin_ === 'function', 'Auth.gs ' + (typeof loginWithPin_ === 'function' ? 'на місці' : 'ВІДСУТНІЙ'));

  // --- 3. КОНФЛІКТ ІМЕН: чий doPost переміг ---
  if (typeof doPost !== 'function') {
    say(false, 'doPost не знайдено взагалі');
  } else {
    var src = doPost.toString();
    var isNew = src.indexOf('submitReport_') > -1;
    say(isNew, 'Активний doPost: ' + (isNew ? 'НОВИЙ (Code.gs)' :
        'СТАРИЙ (old.gs) — новий перекритий! Дивіться пояснення нижче'));
  }
  if (typeof doGet === 'function') {
    say(doGet.toString().indexOf('getConfig') > -1,
        'Активний doGet: ' + (doGet.toString().indexOf('getConfig') > -1 ? 'новий' : 'старий/чужий'));
  }

  // --- 4. властивості скрипта ---
  var props = PropertiesService.getScriptProperties();
  ['PHOTO_FOLDER_ID', 'MAIL_TO'].forEach(function (k) {
    var v = props.getProperty(k);
    say(!!v, 'Script Property ' + k + ': ' + (v ? 'задано' : 'НЕ ЗАДАНО'));
  });
  var authReq = String(props.getProperty('AUTH_REQUIRED') || '').trim().toLowerCase();
  out.push('·  AUTH_REQUIRED: ' + (['так', 'yes', 'true', '1'].indexOf(authReq) > -1
    ? 'так — звіт без входу за PIN відхиляється'
    : 'ні — старий застосунок без входу ще приймається (перехідний період)'));
  say(!!props.getProperty('AUTH_SECRET'),
      'AUTH_SECRET: ' + (props.getProperty('AUTH_SECRET')
        ? 'створено' : 'ще не створено, з\'явиться при першому вході'));
  try {
    var emp = readEmployees_().filter(function (x) { return x.eligible; });
    say(emp.length > 0, 'Кадрова таблиця: доступ до чек-листа мають ' + emp.length +
        ' працівників (подробиці — auditPins())');
    var idx = employeeIndex_();
    var orphans = emp.filter(function (x) { return !matchUserId_(idx, x.name); });
    if (orphans.length) {
      say(false, 'Немає в 03_Працівники: ' + orphans.map(function (x) { return x.name; }).join(', ') +
                 ' — їхні звіти ляжуть на U-000. Запустіть addMissingEmployees()');
    }
  } catch (e) {
    say(false, 'Кадрова таблиця НЕдоступна: ' + e);
  }

  // --- 5. що вже є в таблиці ---
  var names = ss_.getSheets().map(function (s) { return s.getName(); });
  out.push('·  Аркуші (' + names.length + '): ' + names.join(', '));

  var legacy = ss_.getSheetByName('Лист1');
  if (!legacy) {
    say(false, 'Аркуша «Лист1» немає — міграції не буде що переносити. ' +
               'Перевірте, як насправді називається аркуш зі старими звітами.');
  } else {
    var vals = legacy.getDataRange().getValues();
    var n = 0;
    vals.forEach(function (r) { if (String(r[6] || '').indexOf('Чек-лист') > -1) n++; });
    say(n > 0, 'Лист1: ' + vals.length + ' рядків, з них звітів ' + n + ' (архів, тільки читання)');
  }

  // Чи переведені пункти майстра на ід живого фронтенду
  var itemsSheet = ss_.getSheetByName('01_Пункти');
  if (itemsSheet && itemsSheet.getLastRow() > 1) {
    var ids = itemsSheet.getRange(2, 1, itemsSheet.getLastRow() - 1, 1).getValues()
      .map(function (r) { return String(r[0]); });
    var oldIds = ids.filter(function (i) { return /^master\.m\d-/.test(i); }).length;
    var newIds = ids.filter(function (i) { return /^master\.[se]\d-/.test(i); }).length;
    if (oldIds) {
      say(false, 'Пункти майстра ще на старих ід (master.m*): ' + oldIds +
                 ' — запустіть renameMasterItems()');
    } else if (newIds) {
      say(true, 'Пункти майстра на ід фронтенду (master.s*/e*): ' + newIds);
    } else {
      say(false, 'Пунктів майстра в 01_Пункти немає — потрібен seedDictionaries()');
    }
  }

  ['01_Пункти', '02_Варіанти', '03_Працівники',
   '11_Звіти', '12_Відповіді', '13_Фото'].forEach(function (nm) {
    var s = ss_.getSheetByName(nm);
    if (!s) { out.push('·  ' + nm + ': ще не створено'); return; }
    var rows = Math.max(s.getLastRow() - 1, 0);
    var cols = s.getLastColumn();
    out.push('·  ' + nm + ': ' + rows + ' рядків даних, ' + cols + ' колонок' +
             (cols === 0 ? '  ← порожній, потрібен повторний setupSchema()' : ''));
  });

  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}


/**
 * Перевірка доступу до папки фото. Створює тимчасовий файл і одразу видаляє.
 *
 * Скрипт виконується від імені власника деплойменту, а не власника таблиці.
 * Якщо це різні акаунти — саме тут виявиться, що прав на папку немає.
 * Схоже, це і є причина 130 втрачених фото у старій системі:
 * помилка була «У доступі відмовлено: DriveApp».
 */
function checkPhotoFolder() {
  var out = [];
  out.push('Скрипт виконується від імені: ' + Session.getEffectiveUser().getEmail());
  out.push('Активний користувач:          ' + Session.getActiveUser().getEmail());

  var id = PropertiesService.getScriptProperties().getProperty('PHOTO_FOLDER_ID');
  if (!id) {
    out.push('❌ PHOTO_FOLDER_ID не заданий');
    Logger.log(out.join('\n'));
    return out.join('\n');
  }
  out.push('PHOTO_FOLDER_ID: ' + id);

  var folder;
  try {
    folder = DriveApp.getFolderById(id);
    out.push('✅ Папку знайдено: «' + folder.getName() + '»');
  } catch (e) {
    out.push('❌ Папка НЕдоступна: ' + e);
    out.push('   → усі фото зберігатимуться з помилкою, як і раніше.');
    Logger.log(out.join('\n'));
    return out.join('\n');
  }

  try {
    var blob = Utilities.newBlob('test', 'text/plain', 'checklist_access_test.txt');
    var f = folder.createFile(blob);
    out.push('✅ Запис у папку працює (файл ' + f.getId() + ')');
    f.setTrashed(true);
    out.push('✅ Тестовий файл видалено');
    out.push('');
    out.push('Фото зберігатимуться коректно.');
  } catch (e) {
    out.push('❌ ЗАПИС У ПАПКУ НЕ ПРАЦЮЄ: ' + e);
    out.push('');
    out.push('Що зробити: відкрийте папку на Drive і дайте акаунту');
    out.push('' + Session.getEffectiveUser().getEmail() + ' право «Редактор».');
    out.push('Або створіть нову папку цим акаунтом і впишіть її ID у PHOTO_FOLDER_ID.');
  }

  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}

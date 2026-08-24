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
    say(n > 0, 'Лист1: ' + vals.length + ' рядків, з них звітів ' + n + ' (очікується 352)');
  }

  ['01_Пункти', '02_Варіанти', '03_Працівники', '11_Звіти', '12_Відповіді', '13_Фото'].forEach(function (nm) {
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

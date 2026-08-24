/**
 * Diagnose.gs — що саме дала міграція. Нічого не змінює, тільки читає.
 *
 * auditMigration()  — які рядки Лист1 не перенеслися і чому,
 *                     скільки відповідей із кожним статусом,
 *                     які тексти пунктів і значення не знайшлися в довідниках.
 *
 * Запустіть після migrateLegacy() і надішліть журнал.
 */

function auditMigration() {
  var out = [];
  var ss_ = SpreadsheetApp.getActive();

  // --- 1. які звіти з Лист1 не потрапили в 11_Звіти ---
  var legacy = ss_.getSheetByName(SH.LEGACY).getDataRange().getValues();
  var srcRows = [];
  legacy.forEach(function (r, i) {
    if (String(r[6] || '').indexOf('Чек-лист') > -1) srcRows.push(i + 1);
  });

  var rep = readTable(SH.REPORTS);
  var gotRow = {}, ids = {}, dupId = 0;
  rep.rows.forEach(function (r) {
    if (!r[0]) return;
    if (ids[r[0]]) dupId++;
    ids[r[0]] = true;
    gotRow[r[rep.col.raw_row]] = true;
  });

  var missing = srcRows.filter(function (n) { return !gotRow[n]; });
  out.push('Звітів у Лист1: ' + srcRows.length + ' · у 11_Звіти: ' + rep.rows.filter(function (r) { return r[0]; }).length);
  out.push(missing.length
    ? '❌ НЕ перенесено рядків: ' + missing.length + ' → рядки Лист1: ' + missing.slice(0, 30).join(', ')
    : '✅ Перенесено всі рядки');
  if (dupId) out.push('⚠️ Повторів report_id у 11_Звіти: ' + dupId);

  // для кожного непере­несеного — чому
  missing.slice(0, 10).forEach(function (n) {
    var row = legacy[n - 1];
    out.push('   рядок ' + n + ': дата="' + row[1] + '" хто="' + row[3] +
             '" стадія="' + row[4] + '" підсумок="' + row[5] + '"');
  });

  // --- 2. статуси відповідей ---
  var ans = readTable(SH.ANSWERS);
  var byStatus = {}, byOrig = {};
  var noItem = {}, unknownPair = {};
  ans.rows.forEach(function (r) {
    if (!r[0]) return;
    var st = r[ans.col.status] || '(порожньо)';
    byStatus[st] = (byStatus[st] || 0) + 1;
    var so = r[ans.col.status_original] || '(порожньо)';
    byOrig[so] = (byOrig[so] || 0) + 1;

    if (!r[ans.col.item_id]) {
      var t = String(r[ans.col.item_text_snapshot]).substring(0, 70);
      noItem[t] = (noItem[t] || 0) + 1;
    } else if (st === 'unknown') {
      var k = r[ans.col.item_id] + '  ←  «' + String(r[ans.col.value_text]).substring(0, 40) + '»';
      unknownPair[k] = (unknownPair[k] || 0) + 1;
    }
  });

  out.push('');
  out.push('Відповідей: ' + ans.rows.filter(function (r) { return r[0]; }).length);
  out.push('Статуси (нові):     ' + JSON.stringify(byStatus));
  out.push('Статуси (оригінал): ' + JSON.stringify(byOrig));

  out.push('');
  out.push(top_(noItem, 'Тексти пунктів БЕЗ item_id (немає в 01_Пункти)', 15));
  out.push('');
  out.push(top_(unknownPair, 'Значення, яких немає в 02_Варіанти (статус unknown)', 20));

  // --- 3. фото ---
  var pho = readTable(SH.PHOTOS);
  var ps = {};
  pho.rows.forEach(function (r) { if (r[0]) ps[r[5]] = (ps[r[5]] || 0) + 1; });
  out.push('');
  out.push('Фото: ' + JSON.stringify(ps));

  // --- 4. діапазон дат ---
  var dates = rep.rows.map(function (r) {
    var v = r[rep.col.business_date];
    return v instanceof Date ? businessDate(v) : String(v || '');
  }).filter(String).sort();
  if (dates.length) out.push('Період звітів: ' + dates[0] + ' → ' + dates[dates.length - 1]);

  // скільки комірок Sheets перетворив на дату замість тексту
  var asDate = 0;
  rep.rows.forEach(function (r) { if (r[rep.col.business_date] instanceof Date) asDate++; });
  if (asDate) out.push('⚠️ business_date збережено як ДАТУ у ' + asDate +
                       ' рядках — порівняння рядків не працюватимуть. Потрібен normalizeDataTypes().');

  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}

function top_(obj, title, n) {
  var keys = Object.keys(obj);
  if (!keys.length) return '✅ ' + title + ': немає';
  keys.sort(function (a, b) { return obj[b] - obj[a]; });
  var lines = ['⚠️ ' + title + ' — ' + keys.length + ' різних, ' +
               keys.reduce(function (s, k) { return s + obj[k]; }, 0) + ' відповідей:'];
  keys.slice(0, n).forEach(function (k) { lines.push('   ' + obj[k] + '  ' + k); });
  return lines.join('\n');
}


/**
 * Показує, чому конкретні рядки Лист1 не перенеслися.
 * Прогонить парсер у try/catch і друкує справжню помилку.
 */
function explainSkipped(rowNumbers) {
  var legacy = SpreadsheetApp.getActive().getSheetByName(SH.LEGACY).getDataRange().getValues();
  var dict = loadDictionaries_();
  var out = [];

  if (!rowNumbers) {
    var rep = readTable(SH.REPORTS);
    var got = {};
    rep.rows.forEach(function (r) { if (r[0]) got[r[rep.col.raw_row]] = true; });
    rowNumbers = [];
    legacy.forEach(function (r, i) {
      if (String(r[6] || '').indexOf('Чек-лист') > -1 && !got[i + 1]) rowNumbers.push(i + 1);
    });
  }

  out.push('Перевіряю рядки: ' + rowNumbers.join(', '));
  rowNumbers.forEach(function (n) {
    var row = legacy[n - 1];
    out.push('');
    out.push('— рядок ' + n);
    for (var c = 0; c < 6; c++) {
      out.push('   колонка ' + (c + 1) + ': [' + (row[c] instanceof Date ? 'Date' : typeof row[c]) +
               '] ' + String(row[c]).substring(0, 60));
    }
    out.push('   довжина тексту звіту: ' + String(row[6] || '').length +
             ', рядків: ' + String(row[6] || '').split('\n').length);
    try {
      var p = parseLegacyRow_(row, n, dict);
      out.push('   ✅ парсер відпрацював: report_id=' + p.report[0] +
               ', відповідей=' + p.answers.length + ', фото=' + p.photos.length);
      out.push('   → тобто рядок пропущено як ДУБЛЬ report_id, а не через помилку');
    } catch (e) {
      out.push('   ❌ ПОМИЛКА ПАРСЕРА: ' + e + (e.stack ? '\n      ' + e.stack : ''));
    }
  });

  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}


/**
 * Суха перевірка нового doPost на payload СТАРОГО клієнта.
 * Нічого не пише в таблицю — тільки показує, що потрапило б у 11/12/13.
 *
 * Саме цей формат зараз шле застосунок механіків.
 */
function dryRunLegacyPost() {
  var dict = loadDictionaries_();
  var payload = {
    date: Utilities.formatDate(new Date(), TZ, 'dd.MM.yyyy') + ', 08:15:00',
    time: '08:15:00',
    mechanic: 'Гора Андрій Олександрович',
    shiftStage: 'Початок зміни',
    summary: 'Виконано 38 з 38',
    items: [
      { text: 'Температура компресорів', completed: true, value: '№1: 55 / №2: 92', comment: '', isBad: false },
      { text: 'Проконтролювати відсутність помилок на пультах керування компресорів.',
        completed: true, value: 'Відсутні', comment: '', isBad: false },
      { text: 'UF знезараження H2O: UF лампа світить?', completed: true, value: 'Ні', comment: 'лампа перегоріла', isBad: true },
      { text: 'Зіставити поточну температуру всередині з установленим режимом.',
        completed: true, value: '-3,-2,-2', comment: '', isBad: false },
      { text: 'Зробити фото інформаційного табло генератора.', completed: true, value: 'Нема', comment: '', isBad: false }
    ]
  };

  var p = normalizeLegacyPayload_(payload, dict);
  var out = [];
  out.push('report_id      : ' + p.report_id);
  out.push('business_date  : ' + p.business_date + '   stage: ' + p.stage + '   role: ' + p.role);
  out.push('user           : ' + p.user_name + ' → ' + (dict.byName[p.user_name] || 'U-000'));
  out.push('config_version : ' + p.config_version);
  out.push('');
  out.push('Пункти:');

  var cnt = { ok: 0, warn: 0, alert: 0, empty: 0, unknown: 0 };
  p.items.forEach(function (it) {
    var item = dict.byId[it.item_id];
    var st;
    if (!item) st = 'unknown';
    else if (item.type === 'binary') st = dict.optStatus[it.item_id + '|' + it.value] || 'unknown';
    else if (item.type === 'number') st = it.values.length
      ? worstStatus(it.values.map(function (v, f) { return numberStatus_(item, f + 1, v); }))
      : 'empty';
    else st = it.value ? 'ok' : 'empty';
    cnt[st] = (cnt[st] || 0) + 1;
    out.push('  ' + (st === 'alert' ? '❗' : st === 'warn' ? '⚠️' : st === 'ok' ? '✅' : '·') +
             ' ' + st.toUpperCase() + '  ' + (it.item_id || 'БЕЗ item_id') +
             '  ←  «' + it.value + '»' + (it.values.length ? '  числа: ' + it.values.join(', ') : ''));
  });

  out.push('');
  out.push('Підсумок: ' + JSON.stringify(cnt));
  out.push('');
  out.push('Очікуємо: температура 92 °C → alert (норма 15-85), UF лампа «Ні» → alert,');
  out.push('температура контейнера -3/-2/-2 → ok, «Нема» → «Помилок немає» → ok.');
  out.push('');
  out.push('НІЧОГО НЕ ЗАПИСАНО — це суха перевірка.');

  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}

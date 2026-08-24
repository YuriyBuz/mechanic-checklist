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
  var dates = rep.rows.map(function (r) { return String(r[rep.col.business_date]); })
                      .filter(String).sort();
  if (dates.length) out.push('Період звітів: ' + dates[0] + ' → ' + dates[dates.length - 1]);

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

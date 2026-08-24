/**
 * Schema.gs — створює еталонну структуру таблиці й заповнює довідники.
 *
 * setupSchema()       — створює 9 аркушів із заголовками. Ідемпотентно:
 *                       наявні аркуші й дані не чіпає, лише дописує чого бракує.
 * seedDictionaries()  — заповнює 01_Пункти, 02_Варіанти, 03_Працівники з Seed.gs.
 *                       Оновлює рядки за ключем, нічого не видаляє.
 *
 * «Лист1» не згадується ніде, крім Migrate.gs, і там тільки на читання.
 */

/**
 * Схема будується ФУНКЦІЄЮ, а не top-level масивом.
 * Apps Script виконує файли в порядку списку, і Seed.gs вантажиться після
 * Schema.gs — на момент обчислення top-level масиву SEED_ITEM_COLS ще undefined.
 * Ліниве обчислення прибирає залежність від порядку файлів.
 */
function schemaDefs_() {
  return [
    {
      name: SH.ITEMS,
      header: SEED_ITEM_COLS,
      widths: { text: 420, group_title: 220, notes: 320 },
      text: ['item_id', 'text_aliases', 'active_from', 'active_to'],
      note: 'Довідник пунктів. Порожні norm_min/norm_max = сигнал по числу не спрацьовує.'
    },
    {
      name: SH.OPTIONS,
      header: ['item_id', 'seq', 'value', 'status', 'active'],
      widths: { value: 260 },
      text: ['item_id', 'value'],
      validation: { status: ['ok', 'warn', 'alert'], active: ['так', 'ні'] },
      note: 'Норма для кнопкових пунктів. Саме тут «Не потр.» перестає бути аварією.\n' +
            'active=ні — історичне написання: у застосунку не показується, але міграція його впізнає.'
    },
    {
      name: SH.EMPLOYEES,
      header: ['user_id', 'full_name', 'role', 'active', 'aliases'],
      widths: { full_name: 280, aliases: 280 },
      text: ['user_id', 'aliases'],
      validation: { role: ['Механік', 'Майстер', 'Керівник'] },
      note: 'aliases — історичні написання ПІБ через «;». Саме вони зшивають старі звіти.'
    },
    {
      name: SH.ACCESS,
      header: ACCESS_COLS,
      widths: { full_name: 280, email: 240, position: 200, roles: 200, pin_hash: 120, note: 300 },
      text: ['emp_id', 'user_id', 'email', 'roles', 'pin_hash', 'pin_updated', 'hr_synced'],
      validation: { can_mech: ['так', 'ні'], can_master: ['так', 'ні'], can_email: ['так', 'ні'],
                    active: ['так', 'ні'], must_change: ['так', 'ні'],
                    pin_source: ['кадрова', 'користувач', 'адмін', 'згенеровано'] },
      note: 'Доступ до застосунку. Заповнює syncAccessFromHr() із кадрової таблиці.\n' +
            'pin_hash — НЕ PIN, а його незворотний хеш. Самого PIN немає ніде.\n' +
            'active=ні закриває вхід, не чіпаючи кадрову.'
    },
    {
      name: SH.REPORTS,
      header: ['report_id', 'ts_server', 'business_date', 'stage', 'role', 'user_id',
               'user_name_snapshot', 'config_version', 'items_total',
               'cnt_ok', 'cnt_warn', 'cnt_alert', 'cnt_empty',
               'photos_saved', 'photos_failed', 'source', 'raw_row', 'app_version'],
      widths: { report_id: 260, user_name_snapshot: 220 },
      text: ['report_id', 'ts_server', 'business_date', 'config_version', 'app_version'],
      validation: { stage: ['Початок зміни', 'Кінець зміни'], role: ['Механік', 'Майстер'],
                    source: ['app', 'migrated'] },
      freezeCols: 1
    },
    {
      name: SH.ANSWERS,
      header: ['answer_id', 'report_id', 'business_date', 'stage', 'role', 'user_id',
               'item_id', 'item_text_snapshot', 'seq',
               'value_text', 'value_num_1', 'value_num_2', 'value_num_3',
               'status', 'status_original', 'comment', 'photo_url'],
      widths: { answer_id: 260, report_id: 240, item_text_snapshot: 420, comment: 360 },
      text: ['answer_id', 'report_id', 'business_date', 'value_text', 'comment'],
      validation: { status: ['ok', 'warn', 'alert', 'empty', 'unknown'],
                    status_original: ['ok', 'alert', 'empty'] },
      note: 'Головна таблиця. status — за поточними правилами, status_original — як оцінила стара система.'
    },
    {
      name: SH.PHOTOS,
      header: ['photo_id', 'report_id', 'item_id', 'url', 'drive_file_id', 'status', 'error'],
      widths: { url: 380, error: 380 },
      text: ['photo_id', 'report_id', 'url', 'drive_file_id'],
      validation: { status: ['saved', 'failed'] }
    },
    {
      name: SH.EVENTS,
      header: ['ts', 'type', 'event', 'report_id', 'user_id', 'details', 'app_version'],
      widths: { details: 460 },
      text: ['ts', 'report_id', 'details']
    },
    {
      name: SH.SCHEDULE,
      header: ['business_date', 'stage', 'role', 'expected', 'received', 'status'],
      text: ['business_date'],
      validation: { status: ['ok', 'пропущено', 'дубль'] },
      note: 'Заповнює checkSchedule() щодня. Тут стають видимими пропущені зміни.'
    },
    {
      name: SH.DASH,
      header: ['показник', 'значення', 'коментар'],
      widths: { показник: 380, коментар: 420 }
    }
  ];
}

function setupSchema() {
  var created = [], updated = [];
  schemaDefs_().forEach(function (def) {
    var s = ss().getSheetByName(def.name);
    if (!s) {
      s = ss().insertSheet(def.name);
      created.push(def.name);
    }
    applySheetDef_(s, def) && updated.push(def.name);
  });
  buildDashboard_();
  var msg = 'Створено: ' + (created.join(', ') || '—') + '. Оновлено заголовки: ' + (updated.join(', ') || '—');
  logEvent('Схема', 'setupSchema', msg);
  return msg;
}

function applySheetDef_(s, def) {
  if (!def.header || !def.header.length) {
    throw new Error('Немає заголовків для аркуша «' + def.name + '». ' +
      'Найімовірніше, у проєкті бракує файлу Seed.gs або він порожній.');
  }
  var changed = false;
  var existing = s.getLastColumn() ? s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0] : [];
  var same = existing.length === def.header.length && existing.every(function (v, i) {
    return String(v) === String(def.header[i]);
  });
  if (!same) {
    s.getRange(1, 1, 1, def.header.length).setValues([def.header]);
    changed = true;
  }
  s.getRange(1, 1, 1, def.header.length)
    .setFontWeight('bold')
    .setBackground('#f1f5f9')
    .setVerticalAlignment('middle');
  s.setFrozenRows(1);
  if (def.freezeCols) s.setFrozenColumns(def.freezeCols);

  var idx = {};
  def.header.forEach(function (h, i) { idx[h] = i + 1; });

  Object.keys(def.widths || {}).forEach(function (h) {
    if (idx[h]) s.setColumnWidth(idx[h], def.widths[h]);
  });

  // Текстовий формат КРИТИЧНИЙ: без нього Sheets мовчки перетворює
  // «2026-04-03» на дату, «3.4» на 3 квітня, і всі порівняння рядків ламаються.
  (def.text || []).forEach(function (h) {
    if (idx[h]) s.getRange(2, idx[h], Math.max(s.getMaxRows() - 1, 1), 1).setNumberFormat('@');
  });

  Object.keys(def.validation || {}).forEach(function (h) {
    if (!idx[h]) return;
    var rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(def.validation[h], true)
      .setAllowInvalid(true)   // не блокуємо ручні правки, лише підказуємо
      .build();
    s.getRange(2, idx[h], Math.max(s.getMaxRows() - 1, 1), 1).setDataValidation(rule);
  });

  if (def.note) s.getRange(1, 1).setNote(def.note);
  return changed;
}

/**
 * Заповнює довідники з Seed.gs. Ключ 01_Пункти — item_id, 02_Варіанти — item_id+value,
 * 03_Працівники — user_id. Наявні рядки оновлюються, зайві НЕ видаляються:
 * якщо ви додали свій пункт руками, він залишиться.
 */
function seedDictionaries() {
  var res = [];
  res.push(upsert_(SH.ITEMS, SEED_ITEMS, function (r) { return r[0]; }));
  res.push(upsert_(SH.OPTIONS, SEED_OPTIONS, function (r) { return r[0] + ' ' + r[2]; }));
  res.push(upsert_(SH.EMPLOYEES, SEED_EMPLOYEES, function (r) { return r[0]; }));
  var msg = 'Пункти: ' + res[0] + ' · Варіанти: ' + res[1] + ' · Працівники: ' + res[2];
  logEvent('Схема', 'seedDictionaries', msg);
  return msg;
}

function upsert_(sheetName, seedRows, keyFn) {
  var t = readTable(sheetName);
  var pos = {};
  t.rows.forEach(function (r, i) { pos[keyFn(r)] = i; });

  var add = [], upd = 0;
  var width = t.header.length;
  seedRows.forEach(function (r) {
    var row = r.slice(0, width);
    while (row.length < width) row.push('');
    var k = keyFn(row);
    if (pos[k] === undefined) {
      add.push(row);
    } else {
      var cur = t.rows[pos[k]];
      var diff = row.some(function (v, i) { return String(v) !== String(cur[i]); });
      if (diff) {
        t.sheet.getRange(pos[k] + 2, 1, 1, width).setValues([row]);
        upd++;
      }
    }
  });
  appendRows(sheetName, add);
  return 'додано ' + add.length + ', оновлено ' + upd;
}

/**
 * Формули задаються в стандартній нотації з комою — Apps Script записує їх так
 * незалежно від мовних налаштувань таблиці, а Sheets показує вже за локаллю.
 */
function buildDashboard_() {
  var s = sheetByName(SH.DASH);
  var A = "'" + SH.ANSWERS + "'";
  var R = "'" + SH.REPORTS + "'";
  var P = "'" + SH.PHOTOS + "'";
  var C = "'" + SH.SCHEDULE + "'";
  var last30 = '">="&TEXT(TODAY()-30,"yyyy-mm-dd")';

  var rows = [
    ['Звітів усього', '=COUNTA(' + R + '!A2:A)', ''],
    ['Відповідей усього', '=COUNTA(' + A + '!A2:A)', ''],
    ['', '', ''],
    ['Відхилень (alert) за 30 днів',
     '=COUNTIFS(' + A + '!N2:N,"alert",' + A + '!C2:C,' + last30 + ')',
     'Те, чого стара система не рахувала жодного разу'],
    ['Попереджень (warn) за 30 днів',
     '=COUNTIFS(' + A + '!N2:N,"warn",' + A + '!C2:C,' + last30 + ')', ''],
    ['Незаповнених пунктів за 30 днів',
     '=COUNTIFS(' + A + '!N2:N,"empty",' + A + '!C2:C,' + last30 + ')', ''],
    ['', '', ''],
    ['Фото збережено', '=COUNTIF(' + P + '!F2:F,"saved")', ''],
    ['Фото втрачено', '=COUNTIF(' + P + '!F2:F,"failed")', 'Помилка доступу до Drive'],
    ['Частка втрачених фото',
     '=IFERROR(COUNTIF(' + P + '!F2:F,"failed")/COUNTA(' + P + '!A2:A),"")', ''],
    ['', '', ''],
    ['Пропущених змін', '=COUNTIF(' + C + '!F2:F,"пропущено")', 'Заповнює checkSchedule()'],
    ['Здано двічі', '=COUNTIF(' + C + '!F2:F,"дубль")', ''],
    ['', '', ''],
    ['ТОП відхилень за весь час', '', 'Пункт · скільки разів'],
    ['', '=IFERROR(QUERY({' + A + '!H2:H,' + A + '!N2:N},' +
       '"select Col1, count(Col1) where Col2 = \'alert\' group by Col1 ' +
       'order by count(Col1) desc limit 10 label count(Col1) \'\'",0),"немає даних")', '']
  ];
  s.getRange(2, 1, rows.length, 3).setValues(rows);
  s.getRange(2, 1, rows.length, 1).setFontWeight('bold');
}

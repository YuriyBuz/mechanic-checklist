/**
 * Auth.gs — вхід за PIN. Зроблено так само, як у проєкті ЗІП
 * (Spare-parts-mechanic-service), щоб обидва застосунки поводилися однаково.
 *
 * ДЖЕРЕЛО ІСТИНИ — кадрова таблиця, аркуш «_REF_Employees», колонка Q «PIN».
 * Ніякої копії доступів у робочій таблиці немає: ролі й PIN перечитуються
 * з кадрової при кожному вході й перед кожним записом звіту. Тому звільнення
 * або зміна ролі діють негайно, а не після закінчення сесії.
 *
 * PIN НЕ ЗМІНЮЄТЬСЯ З ДОДАТКУ. Забув, скомпрометований, збігся з чужим —
 * правиться в колонці Q кадрової таблиці, більше ніде.
 *
 * ОБОВ'ЯЗКОВА УМОВА — PIN унікальний. Логін це сам PIN, без вибору прізвища;
 * якщо той самий код стоїть у двох працівників, вхід відхиляється для обох.
 * Інакше звіт пішов би від імені випадкової людини. Стан перевіряє auditPins().
 *
 * PIN ніде не логується і ніколи не повертається клієнтові.
 */

var EMPLOYEES_SPREADSHEET_ID = '1UhdO9ALcSXk8fgWhUnMiluO4Aao6R4EP6iN4Ie__rY8';
var EMPLOYEES_SHEET_NAME = '_REF_Employees';
var POSITIONS_SHEET_NAME = '_REF_Positions';

// Індекси колонок (0-based) у «_REF_Employees»
var EMP = { id: 0, fullName: 1, shortName: 2, posId: 4, status: 7, email: 14,
            pin: 16, extraRoles: 17, finalRoles: 18 };
var EMP_WIDTH = 19;                    // A..S
var POS = { id: 0, roles: 3 };         // A..D

var SESSION_TTL_MINUTES = 12 * 60;     // одна зміна
var MAX_PIN_ATTEMPTS = 5;
var ATTEMPT_WINDOW_SECONDS = 300;

/**
 * Роль → дозволені дії. Те саме джерело правди для сервера (перевіряє перед
 * записом) і для клієнта (вирішує, який чек-лист показати).
 *
 *   submitMech   — здавати чек-лист механіка
 *   submitMaster — здавати чек-лист майстра
 *   reportMech   — отримувати НА ПОШТУ всі звіти механіків
 *   reportMaster — отримувати НА ПОШТУ всі звіти майстрів
 *
 * Адреса береться з колонки O кадрової. Окремого списку одержувачів немає:
 * кому надсилати — випливає з ролі, як і все інше.
 */
var ROLE_PERMISSIONS = {
  'mech.use':     ['submitMech'],
  'mech.admin':   ['submitMech', 'reportMech'],
  'shift.master': ['submitMaster', 'reportMaster'],
  'admin':        ['submitMech', 'submitMaster', 'reportMech', 'reportMaster']
};


/* ─────────────────────────── вхід ─────────────────────────── */

function loginWithPin_(pin, deviceId) {
  var cache = CacheService.getScriptCache();
  var attemptsKey = 'pin_attempts_' + (deviceId || 'unknown');
  var attempts = Number(cache.get(attemptsKey) || 0);
  if (attempts >= MAX_PIN_ATTEMPTS) {
    logEvent('Доступ', 'login.throttled', 'спроб поспіль: ' + attempts);
    return fail_('THROTTLED', 'Забагато спроб. Спробуйте за 5 хвилин.');
  }

  var value = String(pin === null || pin === undefined ? '' : pin).trim();
  if (!value) return fail_('BAD_PIN', 'Введіть PIN');

  var staff;
  try {
    staff = readEmployees_();
  } catch (err) {
    // Це не «невірний PIN» і не «немає мережі» — це зламаний доступ до довідника.
    // Механік має бачити, що робити, а не гадати; технічні подробиці — в журнал.
    logEvent('Доступ', 'login.hrUnavailable', String(err), {});
    return fail_('HR_UNAVAILABLE',
      'Довідник працівників недоступний, тому вхід зараз неможливий. ' +
      'Це не ваш PIN — зверніться до адміністратора.');
  }
  var matches = staff.filter(function (e) {
    return e.eligible && e.pin === value;
  });

  if (!matches.length) {
    cache.put(attemptsKey, String(attempts + 1), ATTEMPT_WINDOW_SECONDS);
    Utilities.sleep(400);                       // сповільнює перебір
    // сам PIN не пишемо — лише довжину і номер спроби
    logEvent('Доступ', 'login.badPin',
             'довжина PIN: ' + value.length + ', спроба ' + (attempts + 1));
    return fail_('BAD_PIN', 'Невірний PIN');
  }
  if (matches.length > 1) {
    logEvent('Доступ', 'login.pinNotUnique', 'збіг у ' + matches.length + ' працівників');
    // не вгадуємо, хто саме — інакше звіт пішов би не від тієї людини
    return fail_('PIN_NOT_UNIQUE',
      'Цей PIN закріплений за кількома працівниками. Зверніться до адміністратора, ' +
      'щоб вам призначили власний PIN у кадровій таблиці.');
  }

  cache.remove(attemptsKey);
  var employee = matches[0];
  var expiresAt = Date.now() + SESSION_TTL_MINUTES * 60 * 1000;
  logEvent('Доступ', 'login.ok', employee.name + ' · ' + employee.roles.join(', '),
           { user_id: employee.user_id });

  return {
    success: true,
    name: employee.name,
    shortName: employee.shortName,
    user_id: employee.user_id,
    email: employee.email,
    roles: employee.roles,
    permissions: employee.permissions,
    token: issueToken_(employee, deviceId, expiresAt),
    expiresAt: expiresAt
  };
}


/* ─────────────────────── токен сесії ─────────────────────── */

/** Токен не містить ні PIN, ні ролей: ролі щоразу перечитуються з довідника. */
function issueToken_(employee, deviceId, expiresAt) {
  var body = Utilities.base64EncodeWebSafe(JSON.stringify({
    id: employee.id, e: expiresAt, d: deviceId || ''
  }));
  return body + '.' + signToken_(body);
}

function signToken_(body) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(body, getAuthSecret_()));
}

function getAuthSecret_() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('AUTH_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('AUTH_SECRET', secret);
    logEvent('Доступ', 'auth.secret.created', 'створено AUTH_SECRET');
  }
  return secret;
}

/**
 * Перевіряє підпис і строк, а права читає ЗАНОВО з кадрової таблиці.
 * Токен, виданий одному пристрою, на іншому не працює.
 */
function verifySession_(token, deviceId) {
  if (!token || String(token).indexOf('.') === -1) return null;

  var parts = String(token).split('.');
  if (signToken_(parts[0]) !== parts[1]) return null;

  var payload;
  try {
    payload = JSON.parse(
      Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
  } catch (e) {
    return null;
  }
  if (!payload.e || payload.e < Date.now()) return null;
  // відсутність ідентифікатора пристрою = розбіжність: інакше прив'язку
  // можна було б обійти, просто не надіславши параметр
  if (payload.d && payload.d !== deviceId) return null;

  var employee;
  try {
    employee = findEmployee_(payload.id);
  } catch (err) {
    // Довідник недоступний. Викидати помилку назовні не можна: вона вилітала
    // з doPost, Google віддавав HTML замість JSON, і застосунок казав
    // «немає мережі». Краще чесне «сесії немає» плюс запис у журнал.
    logEvent('Доступ', 'session.hrUnavailable', String(err), {});
    return null;
  }
  if (!employee || !employee.eligible) return null;
  return employee;
}

function fail_(code, message) {
  return { success: false, code: code, error: message };
}


/* ──────────────── читання кадрової таблиці ──────────────── */

/**
 * getDisplayValues, а не getValues: інакше Sheets віддасть PIN «0505» як
 * число 505, і вхід перестане працювати саме в тих, у кого код із нуля.
 */
function readEmployees_() {
  var ss_;
  try {
    ss_ = SpreadsheetApp.openById(EMPLOYEES_SPREADSHEET_ID);
  } catch (e) {
    throw new Error('Немає доступу до кадрової таблиці від імені ' +
                    Session.getEffectiveUser().getEmail() + ': ' + e);
  }
  var sheet = ss_.getSheetByName(EMPLOYEES_SHEET_NAME);
  if (!sheet) throw new Error('Аркуш «' + EMPLOYEES_SHEET_NAME + '» не знайдено');

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var positionRoles = readPositionRoles_(ss_);
  var byName = null;                    // довідник 03_Працівники, для user_id

  return sheet.getRange(2, 1, lastRow - 1, EMP_WIDTH).getDisplayValues()
    .filter(function (row) { return String(row[EMP.id]).trim() !== ''; })
    .map(function (row) {
      var roles = resolveRoles_(row, positionRoles);
      var permissions = permissionsFor_(roles);
      var name = String(row[EMP.fullName]).trim();
      if (permissions.length && byName === null) byName = employeeIndex_();
      return {
        id: String(row[EMP.id]).trim(),
        name: name,
        shortName: String(row[EMP.shortName] || row[EMP.fullName]).trim(),
        user_id: permissions.length ? (matchUserId_(byName, name) || 'U-000') : '',
        status: String(row[EMP.status]).trim().toLowerCase(),
        email: String(row[EMP.email]).trim(),
        pin: String(row[EMP.pin]).trim(),
        roles: roles,
        permissions: permissions,
        eligible: String(row[EMP.status]).trim().toLowerCase() === 'active' && permissions.length > 0
      };
    });
}

function findEmployee_(id) {
  var wanted = String(id).trim();
  var found = readEmployees_().filter(function (e) { return e.id === wanted; });
  return found.length ? found[0] : null;
}

function readPositionRoles_(ss_) {
  var sheet = ss_.getSheetByName(POSITIONS_SHEET_NAME);
  var map = {};
  if (!sheet || sheet.getLastRow() < 2) return map;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getDisplayValues().forEach(function (row) {
    var id = String(row[POS.id]).trim();
    if (id) map[id] = splitRoles_(row[POS.roles]);
  });
  return map;
}

/** «ролі відібрані» (S) мають пріоритет; інакше — ролі посади плюс «ролі додатково» (R). */
function resolveRoles_(row, positionRoles) {
  var explicit = splitRoles_(row[EMP.finalRoles]);
  if (explicit.length) return explicit;
  return splitRoles_(positionRoles[String(row[EMP.posId]).trim()])
    .concat(splitRoles_(row[EMP.extraRoles]));
}

/** У кадровій ролі розділені то пробілом, то комою — приймаємо обидва варіанти. */
function splitRoles_(value) {
  if (Object.prototype.toString.call(value) === '[object Array]') return value.slice();
  return String(value || '').split(/[\s,;]+/).filter(function (r) { return r !== ''; });
}

function permissionsFor_(roles) {
  var allowed = {};
  roles.forEach(function (role) {
    (ROLE_PERMISSIONS[role] || []).forEach(function (p) { allowed[p] = true; });
  });
  return Object.keys(allowed);
}

function can_(employee, action) {
  return !!employee && employee.permissions.indexOf(action) > -1;
}


/* ─────────── зв'язок кадрової з 03_Працівники ─────────── */

/** ПІБ → user_id, включно з історичними написаннями з колонки aliases. */
function employeeIndex_() {
  var t = readTable(SH.EMPLOYEES);
  var byName = {};
  t.rows.forEach(function (r) {
    if (!r[0]) return;
    [r[1]].concat(String(r[4] || '').split(';')).forEach(function (n) {
      n = String(n).trim();
      if (n) byName[normName_(n)] = r[0];
    });
  });
  return byName;
}

function normName_(s) {
  return String(s || '').toLowerCase().replace(/[’'`ʼ]/g, "'").replace(/\s+/g, ' ').trim();
}

/**
 * Кадрова пише ПІБ повністю («Гончарук Ольга Михайлівна»), довідник звітів —
 * коротше («Гончарук Ольга»). Тому після точного збігу пробуємо прізвище з ім'ям.
 */
function matchUserId_(byName, fullName) {
  if (!byName) return '';
  var n = normName_(fullName);
  if (!n) return '';
  if (byName[n]) return byName[n];

  var two = n.split(' ').slice(0, 2).join(' ');
  var keys = Object.keys(byName);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].split(' ').slice(0, 2).join(' ') === two) return byName[keys[i]];
  }
  return '';
}


/* ─────────────── службові перевірки ─────────────── */

/**
 * Кому доступний чек-лист і чи не дублюються PIN. Повні PIN не виводяться.
 * Запускати з редактора Apps Script після будь-якої зміни в кадровій.
 */
function auditPins() {
  var all = readEmployees_();
  var eligible = all.filter(function (e) { return e.eligible; });
  var lines = ['Доступ до чек-листа мають ' + eligible.length + ' працівників:'];

  eligible.forEach(function (e) {
    lines.push('   ' + e.name + '  [' + e.roles.join(', ') + ']  ' +
      (can_(e, 'submitMech') ? 'механік ' : '') +
      (can_(e, 'submitMaster') ? 'майстер ' : '') +
      ((can_(e, 'reportMech') || can_(e, 'reportMaster'))
        ? ('пошта→' + (e.email || 'НЕ ЗАДАНО')) : '') +
      '  → ' + (e.user_id === 'U-000' ? '⚠ немає в ' + SH.EMPLOYEES : e.user_id));
  });

  var byPin = {};
  eligible.forEach(function (e) {
    var key = e.pin || '(порожній)';
    (byPin[key] = byPin[key] || []).push(e.name);
  });

  lines.push('');
  var problems = 0;
  Object.keys(byPin).sort().forEach(function (pin) {
    var names = byPin[pin];
    var masked = pin === '(порожній)' ? pin : pin.charAt(0) + '***';
    if (names.length > 1) {
      problems++;
      lines.push('❌ ' + masked + ' → ' + names.join(' | ') +
                 '   ← ДУБЛІКАТ: не увійде ЖОДЕН із них');
    } else if (pin === '(порожній)') {
      problems++;
      lines.push('❌ ' + names[0] + ' — PIN у колонці Q порожній, вхід неможливий');
    }
  });
  if (!problems) lines.push('✅ Усі PIN унікальні — вхід працює для всіх');
  else lines.push('', 'Виправляється тільки в кадровій таблиці, колонка Q.');

  var noMail = eligible.filter(function (e) {
    return (can_(e, 'reportMech') || can_(e, 'reportMaster')) && e.email.indexOf('@') === -1;
  });
  if (noMail.length) {
    lines.push('');
    lines.push('⚠️ Роль дає звіт на пошту, але email (колонка O) порожній:');
    noMail.forEach(function (e) { lines.push('   ' + e.name + ' [' + e.roles.join(', ') + ']'); });
  }

  var msg = lines.join('\n');
  Logger.log(msg);
  return msg;
}

/**
 * Заводить у 03_Працівники тих, хто має доступ до чек-листа, але кого там ще
 * немає. Без цього їхні звіти лягають на U-000 «особу не встановлено»:
 * у 12_Відповідях їх не відрізнити ні від кого, і розклад їх не бачить.
 *
 * Кадрову не чіпає — тільки довідник звітів. Повторний запуск нічого не робить.
 */
function addMissingEmployees() {
  return withLock(function () {
    var idx = employeeIndex_();
    var t = readTable(SH.EMPLOYEES);
    var maxN = 0;
    t.rows.forEach(function (r) {
      var m = /^U-(\d+)$/.exec(String(r[0]).trim());
      if (m) maxN = Math.max(maxN, Number(m[1]));
    });

    var add = [], out = [];
    readEmployees_().forEach(function (e) {
      if (!e.eligible) return;
      if (matchUserId_(idx, e.name)) return;

      maxN++;
      var uid = 'U-' + ('00' + maxN).slice(-3);
      // роль тут — це те, у якому чек-листі людина зʼявляється історично;
      // справжні права однаково дає кадрова
      var role = (can_(e, 'submitMech') && can_(e, 'submitMaster')) ? 'Керівник'
               : (can_(e, 'submitMech') ? 'Механік' : 'Майстер');
      add.push([uid, e.name, role, true, '']);
      idx[normName_(e.name)] = uid;          // щоб не додати двічі за один прогін
      out.push('   ' + uid + '  ' + e.name + '  [' + e.roles.join(', ') + ']  → ' + role);
    });

    if (!add.length) {
      var msg0 = 'Усі, хто має доступ до чек-листа, вже є в ' + SH.EMPLOYEES + '.';
      Logger.log(msg0);
      return msg0;
    }

    appendRows(SH.EMPLOYEES, add);
    var msg = 'Додано в ' + SH.EMPLOYEES + ': ' + add.length + '\n' + out.join('\n');
    logEvent('Схема', 'addMissingEmployees', 'додано ' + add.length);
    Logger.log(msg);
    return msg;
  }, 20000);
}

/**
 * Самоперевірка: підпис токена, прострочення, підробка, прив'язка до пристрою,
 * розбір ролей. Кадрову таблицю читає тільки для звірки ПІБ.
 */
function authSelfTest() {
  var out = [], bad = 0;
  function check(name, cond) { out.push((cond ? '✅ ' : '❌ ') + name); if (!cond) bad++; }

  var emp = { id: 'EMP-0007', name: 'тест' };
  var exp = Date.now() + 60000;
  var tok = issueToken_(emp, 'DEV-1', exp);

  check('токен розбирається', !!verifySessionShape_(tok));
  check('підроблений підпис відхилено', verifySessionShape_(tok.split('.')[0] + '.XXXX') === null);
  check('сміття відхилено', verifySessionShape_('абвгд') === null && verifySessionShape_('') === null);

  var expired = issueToken_(emp, 'DEV-1', Date.now() - 1000);
  var p = verifySessionShape_(expired);
  check('прострочений токен видно', p && p.e < Date.now());

  var other = verifySessionShape_(tok);
  check('токен прив\'язаний до пристрою', other && other.d === 'DEV-1');

  var c1 = permissionsFor_(splitRoles_('zip.admin mech.admin'));
  check('mech.admin → здає механіка і отримує звіти механіків',
        c1.indexOf('submitMech') > -1 && c1.indexOf('reportMech') > -1 &&
        c1.indexOf('submitMaster') === -1 && c1.indexOf('reportMaster') === -1);
  var c2 = permissionsFor_(splitRoles_('mech.use,zip.use'));
  check('mech.use → тільки здає, звітів не отримує',
        c2.length === 1 && c2.indexOf('submitMech') > -1);
  var c3 = permissionsFor_(splitRoles_('shift.master'));
  check('shift.master → здає майстра і отримує звіти майстрів',
        c3.indexOf('submitMaster') > -1 && c3.indexOf('reportMaster') > -1 &&
        c3.indexOf('submitMech') === -1 && c3.indexOf('reportMech') === -1);
  var c4 = permissionsFor_(splitRoles_('admin'));
  check('admin → обидва чек-листи і обидві розсилки', c4.length === 4);
  var c5 = permissionsFor_(splitRoles_('qc.use supply.use'));
  check('чужі ролі доступу не дають', c5.length === 0);

  check('«ролі відібрані» мають пріоритет',
        resolveRoles_(rowWith_({ posId: 'POS-005', extraRoles: 'admin', finalRoles: 'mech.use' }),
                      { 'POS-005': ['mech.use', 'zip.use'] }).join() === 'mech.use');

  var idx = employeeIndex_();
  ['Гончарук Ольга Михайлівна', 'Шута Олександра Сергіівна', 'Гора Андрій Олександрович',
   'Галагін Євгеній Ярославович', 'Сабадаш Геннадій Петрович'].forEach(function (n) {
    check('ПІБ «' + n + '» знайдено в ' + SH.EMPLOYEES, !!matchUserId_(idx, n));
  });

  out.push('');
  out.push(bad ? ('❌ ПОМИЛОК: ' + bad) : '✅ Усі перевірки пройдено — нічого не записано');
  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}

/** Розбирає токен без звернення до кадрової — потрібно тільки самоперевірці. */
function verifySessionShape_(token) {
  if (!token || String(token).indexOf('.') === -1) return null;
  var parts = String(token).split('.');
  if (signToken_(parts[0]) !== parts[1]) return null;
  try {
    return JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
  } catch (e) {
    return null;
  }
}

function rowWith_(fields) {
  var row = [];
  for (var i = 0; i < EMP_WIDTH; i++) row.push('');
  Object.keys(fields).forEach(function (k) { row[EMP[k]] = fields[k]; });
  return row;
}

/** Скинути глобальний лічильник спроб, якщо когось замкнуло. */
function unlockAttempts() {
  var c = CacheService.getScriptCache();
  readEmployees_();      // просто перевіряємо доступ до кадрової
  c.remove('pin_attempts_unknown');
  return 'Лічильник для невідомого пристрою скинуто. Блокування конкретного ' +
         'пристрою мине саме за 5 хвилин.';
}

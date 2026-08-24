/**
 * Auth.gs — вхід за PIN, ролі, права.
 *
 * ЗВІДКИ БЕРЕТЬСЯ PIN
 *   Джерело істини — кадрова таблиця (колонка «PIN», вона ж Q).
 *   syncAccessFromHr() переносить із неї у 04_Доступ ТІЛЬКИ тих, чиї ролі
 *   стосуються чек-листа, і зберігає не сам PIN, а його хеш.
 *
 * ЯК ВЛАШТОВАНИЙ ВХІД
 *   Логін — це сам PIN, без вибору прізвища. Тому PIN мусить бути унікальним
 *   у межах застосунку: у кадровій «1111» стоїть у 25 людей, і якби ми взяли
 *   його як є, троє з них (Гора, Гончарук, Шута) відкривали б один одному
 *   чужі звіти. Синхронізація такі збіги розв'язує: перший за emp_id лишає
 *   свій PIN, решті видається новий, і його показано в журналі виконання —
 *   один раз, більше ніде він не зберігається.
 *
 * ЩО ДАЄ РОЛЬ
 *   mech.use      — чек-лист механіка
 *   mech.admin    — чек-лист механіка + звіт на власну пошту
 *   shift.master  — чек-лист майстра  + звіт на власну пошту
 *   admin         — обидва чек-листи  + звіт на власну пошту
 *   решта ролей (zip.*, qc.*, …) до цього застосунку не пускають.
 *
 * ЩО ЗБЕРІГАЄТЬСЯ
 *   pin_hash = SHA-256(секрет | PIN). Сам PIN не зберігається ніде — ні в
 *   таблиці, ні в журналі подій, ні у відповіді сервера.
 *   Секрет живе у властивостях скрипта (PIN_PEPPER). Якщо його видалити,
 *   ЖОДЕН PIN більше не підійде — доведеться заново запускати синхронізацію.
 */

var HR_SPREADSHEET_ID = '1UhdO9ALcSXk8fgWhUnMiluO4Aao6R4EP6iN4Ie__rY8';

/** Права, які дає кожна роль. Усе, чого тут немає, прав не дає. */
var ROLE_CAPS = {
  'mech.use':     { mech: true },
  'mech.admin':   { mech: true, email: true },
  'shift.master': { master: true, email: true },
  'admin':        { mech: true, master: true, email: true, admin: true }
};

/** PIN, який не приймається: надто очевидний. */
var WEAK_PINS = {
  '0000': 1, '1111': 1, '2222': 1, '3333': 1, '4444': 1, '5555': 1,
  '6666': 1, '7777': 1, '8888': 1, '9999': 1, '1234': 1, '4321': 1,
  '1212': 1, '0123': 1, '1122': 1
};

var TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;   // 30 діб
var MAX_FAILS_PER_CLIENT = 5;                  // далі — пауза 15 хв
var MAX_FAILS_GLOBAL = 40;                     // на всіх, за 10 хв

var ACCESS_COLS = ['emp_id', 'user_id', 'full_name', 'email', 'position', 'roles',
                   'can_mech', 'can_master', 'can_email', 'active',
                   'pin_hash', 'pin_source', 'must_change', 'pin_updated',
                   'hr_synced', 'note'];


/* ─────────────────────────── криптографія ─────────────────────────── */

function hex_(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) s += ('0' + (bytes[i] & 0xff).toString(16)).slice(-2);
  return s;
}

/** Секрет для хешування PIN. Створюється один раз і НЕ МІНЯЄТЬСЯ. */
function pinPepper_() {
  var props = PropertiesService.getScriptProperties();
  var v = props.getProperty('PIN_PEPPER');
  if (!v) {
    v = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('PIN_PEPPER', v);
    logEvent('Доступ', 'auth.pepper.created', 'створено PIN_PEPPER');
  }
  return v;
}

/** Окремий секрет для підпису токенів: його можна змінити, PIN від цього не зламаються. */
function tokenSecret_() {
  var props = PropertiesService.getScriptProperties();
  var v = props.getProperty('AUTH_SECRET');
  if (!v) {
    v = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('AUTH_SECRET', v);
  }
  return v;
}

function pinHash_(pin) {
  return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    pinPepper_() + '|' + String(pin).trim(), Utilities.Charset.UTF_8));
}

function sign_(body) {
  return hex_(Utilities.computeHmacSha256Signature(body, tokenSecret_()));
}

/**
 * Токен = emp_id | строк | відбиток чинного pin_hash, і підпис.
 * Відбиток потрібен, щоб зміна PIN одразу гасила сесії на інших пристроях.
 */
function makeToken_(empId, pinHash) {
  var body = empId + '|' + (Date.now() + TOKEN_TTL_MS) + '|' + String(pinHash).substring(0, 12);
  return Utilities.base64EncodeWebSafe(body, Utilities.Charset.UTF_8) + '.' + sign_(body);
}

function parseToken_(token) {
  if (!token || String(token).indexOf('.') === -1) return null;
  var parts = String(token).split('.');
  var body;
  try {
    body = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString();
  } catch (e) {
    return null;
  }
  if (sign_(body) !== parts[1]) return null;
  var f = body.split('|');
  if (f.length < 3) return null;
  if (Number(f[1]) < Date.now()) return null;
  return { emp_id: f[0], exp: Number(f[1]), pin_fp: f[2] };
}


/* ─────────────────────────── читання 04_Доступ ─────────────────────── */

function readAccess_() {
  var t = readTable(SH.ACCESS);
  var rows = [];
  t.rows.forEach(function (r, i) {
    if (!r[t.col.emp_id]) return;
    var o = {};
    t.header.forEach(function (h, k) { o[h] = r[k]; });
    o._row = i + 2;
    rows.push(o);
  });
  return { table: t, rows: rows };
}

function yes_(v) {
  return String(v).trim().toLowerCase() === 'так';
}

function accessToUser_(o) {
  return {
    emp_id: o.emp_id,
    user_id: o.user_id || 'U-000',
    full_name: o.full_name,
    email: String(o.email || '').trim(),
    position: o.position,
    roles: String(o.roles || ''),
    can_mech: yes_(o.can_mech),
    can_master: yes_(o.can_master),
    can_email: yes_(o.can_email),
    must_change: yes_(o.must_change),
    active: yes_(o.active)
  };
}

/** Користувач за токеном або null. Використовує Code.gs перед записом звіту. */
function authUserByToken_(token) {
  var t = parseToken_(token);
  if (!t) return null;
  var acc = readAccess_();
  for (var i = 0; i < acc.rows.length; i++) {
    var o = acc.rows[i];
    if (o.emp_id !== t.emp_id) continue;
    if (!yes_(o.active)) return null;
    if (String(o.pin_hash || '').substring(0, 12) !== t.pin_fp) return null;   // PIN змінили
    return accessToUser_(o);
  }
  return null;
}


/* ─────────────────────────── обмеження спроб ───────────────────────── */

function throttleBlocked_(clientId) {
  var c = CacheService.getScriptCache();
  if (Number(c.get('authfail_global') || 0) >= MAX_FAILS_GLOBAL) return 'глобальна пауза';
  if (Number(c.get('authfail_' + (clientId || 'anon')) || 0) >= MAX_FAILS_PER_CLIENT) return 'забагато спроб';
  return '';
}

function throttleFail_(clientId) {
  var c = CacheService.getScriptCache();
  var k = 'authfail_' + (clientId || 'anon');
  c.put(k, String(Number(c.get(k) || 0) + 1), 900);
  c.put('authfail_global', String(Number(c.get('authfail_global') || 0) + 1), 600);
}

function throttleReset_(clientId) {
  CacheService.getScriptCache().remove('authfail_' + (clientId || 'anon'));
}


/* ─────────────────────────── публічні дії ──────────────────────────── */

/**
 * Вхід. Повертає токен і права. Прізвище вводити не треба — PIN унікальний.
 * Помилка навмисно однакова і для неіснуючого PIN, і для заблокованого
 * працівника: інакше по відповіді можна перебирати, які PIN зайняті.
 */
function authLogin_(pin, clientId) {
  var blocked = throttleBlocked_(clientId);
  if (blocked) {
    logEvent('Доступ', 'auth.throttled', blocked, {});
    return { ok: false, error: 'throttled', message: 'Забагато спроб. Спробуйте за 15 хвилин.' };
  }

  var p = String(pin === undefined || pin === null ? '' : pin).trim();
  if (!/^\d{3,8}$/.test(p)) {
    throttleFail_(clientId);
    return { ok: false, error: 'bad_pin', message: 'Невірний PIN' };
  }

  var h = pinHash_(p);
  var acc = readAccess_();
  var found = null;
  acc.rows.forEach(function (o) { if (o.pin_hash && o.pin_hash === h) found = o; });

  if (!found || !yes_(found.active)) {
    throttleFail_(clientId);
    logEvent('Доступ', 'auth.fail', found ? 'неактивний працівник' : 'PIN не знайдено', {});
    return { ok: false, error: 'bad_pin', message: 'Невірний PIN' };
  }

  var u = accessToUser_(found);
  if (!u.can_mech && !u.can_master) {
    logEvent('Доступ', 'auth.denied', u.full_name + ' — ролі не дають доступу', { user_id: u.user_id });
    return { ok: false, error: 'forbidden',
             message: 'Ваша роль не дає доступу до чек-листа. Зверніться до головного інженера.' };
  }

  throttleReset_(clientId);
  logEvent('Доступ', 'auth.ok', u.full_name + ' · ' + u.roles, { user_id: u.user_id });

  return {
    ok: true,
    token: makeToken_(u.emp_id, found.pin_hash),
    must_change: u.must_change,
    user: {
      user_id: u.user_id, name: u.full_name, position: u.position, roles: u.roles,
      can: { mech: u.can_mech, master: u.can_master, email: u.can_email && !!u.email }
    }
  };
}

/** Хто я за цим токеном. Клієнт викликає при старті, щоб не тримати профіль у localStorage. */
function authWhoami_(token) {
  var u = authUserByToken_(token);
  if (!u) return { ok: false, error: 'no_session' };
  return {
    ok: true, must_change: u.must_change,
    user: { user_id: u.user_id, name: u.full_name, position: u.position, roles: u.roles,
            can: { mech: u.can_mech, master: u.can_master, email: u.can_email && !!u.email } }
  };
}

/**
 * Зміна PIN самим працівником. Під блокуванням: перевірка унікальності
 * і запис мають бути однією операцією, інакше двоє одночасно поставлять
 * собі один і той самий PIN і потім заходитимуть один за одного.
 */
function authChangePin_(token, oldPin, newPin) {
  return withLock(function () {
    var t = parseToken_(token);
    if (!t) return { ok: false, error: 'no_session', message: 'Сесія застаріла, увійдіть ще раз' };

    var np = String(newPin === undefined || newPin === null ? '' : newPin).trim();
    if (!/^\d{4,6}$/.test(np)) {
      return { ok: false, error: 'bad_new_pin', message: 'PIN — від 4 до 6 цифр' };
    }
    if (WEAK_PINS[np]) {
      return { ok: false, error: 'weak_pin', message: 'Такий PIN надто простий, оберіть інший' };
    }

    var acc = readAccess_();
    var me = null;
    acc.rows.forEach(function (o) { if (o.emp_id === t.emp_id) me = o; });
    if (!me || !yes_(me.active)) return { ok: false, error: 'no_session', message: 'Немає доступу' };
    if (String(me.pin_hash || '').substring(0, 12) !== t.pin_fp) {
      return { ok: false, error: 'no_session', message: 'Сесія застаріла, увійдіть ще раз' };
    }
    if (pinHash_(String(oldPin || '').trim()) !== me.pin_hash) {
      logEvent('Доступ', 'pin.change.badold', me.full_name, { user_id: me.user_id });
      return { ok: false, error: 'bad_old_pin', message: 'Старий PIN не підходить' };
    }

    var nh = pinHash_(np);
    if (nh === me.pin_hash) return { ok: false, error: 'same_pin', message: 'Новий PIN такий самий, як старий' };

    var taken = false;
    acc.rows.forEach(function (o) { if (o.emp_id !== me.emp_id && o.pin_hash === nh) taken = true; });
    if (taken) {
      // навмисно не кажемо чий: це підказало б чужий PIN
      return { ok: false, error: 'pin_taken', message: 'Такий PIN уже зайнятий, оберіть інший' };
    }

    writeAccessCells_(acc.table, me._row, {
      pin_hash: nh, pin_source: 'користувач', must_change: 'ні', pin_updated: nowIsoUtc()
    });
    logEvent('Доступ', 'pin.changed', me.full_name, { user_id: me.user_id });

    return { ok: true, token: makeToken_(me.emp_id, nh), message: 'PIN змінено' };
  }, 20000);
}

function writeAccessCells_(t, row, patch) {
  Object.keys(patch).forEach(function (h) {
    if (t.col[h] === undefined) return;
    t.sheet.getRange(row, t.col[h] + 1).setValue(patch[h]);
  });
}


/* ─────────────────────────── синхронізація з кадрами ───────────────── */

function normName_(s) {
  return String(s || '').toLowerCase().replace(/[’'`ʼ]/g, "'").replace(/\s+/g, ' ').trim();
}

function parseRoles_(str) {
  return String(str || '').split(/[\s,;]+/).map(function (s) { return s.trim(); }).filter(String);
}

function roleCaps_(roles) {
  var c = { mech: false, master: false, email: false, admin: false };
  roles.forEach(function (r) {
    var d = ROLE_CAPS[r];
    if (!d) return;
    Object.keys(d).forEach(function (k) { c[k] = c[k] || d[k]; });
  });
  return c;
}

/** Аркуш кадрової за заголовком, а не за назвою: назви змінюються, заголовки — ні. */
function hrSheetWith_(ss_, mustHave) {
  var sheets = ss_.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (!sheets[i].getLastColumn()) continue;
    var head = sheets[i].getRange(1, 1, 1, sheets[i].getLastColumn()).getValues()[0]
      .map(function (v) { return String(v).trim(); });
    var ok = mustHave.every(function (h) { return head.indexOf(h) > -1; });
    if (ok) return { sheet: sheets[i], head: head };
  }
  return null;
}

/**
 * Переносить із кадрової таблиці тих, чиї ролі стосуються чек-листа.
 * Наявні дані не затирає: PIN, який працівник змінив сам, лишається його.
 *
 * Запускати вручну після будь-якої зміни в кадровій.
 */
function syncAccessFromHr() {
  var out = [];
  var hr;
  try {
    hr = SpreadsheetApp.openById(HR_SPREADSHEET_ID);
  } catch (e) {
    return '❌ Немає доступу до кадрової таблиці від імені ' +
           Session.getEffectiveUser().getEmail() + '\n   ' + e;
  }

  var posT = hrSheetWith_(hr, ['pos_id', 'ролі типові']);
  var empT = hrSheetWith_(hr, ['emp_id', 'PIN']);
  if (!empT) return '❌ У кадровій таблиці не знайдено аркуша з колонками emp_id і PIN';

  var posRoles = {};
  if (posT) {
    var pv = posT.sheet.getDataRange().getValues();
    var pi = posT.head.indexOf('pos_id'), pr = posT.head.indexOf('ролі типові');
    pv.slice(1).forEach(function (r) { if (r[pi]) posRoles[String(r[pi]).trim()] = r[pr]; });
  }

  var ev = empT.sheet.getDataRange().getValues();
  var H = {};
  empT.head.forEach(function (h, i) { H[h] = i; });
  if (H['PIN'] === undefined) H['PIN'] = 16;      // колонка Q, як домовлялися

  // хто вже є в 04_Доступ
  var acc = readAccess_();
  var prev = {};
  acc.rows.forEach(function (o) { prev[o.emp_id] = o; });

  var dict = loadDictionaries_();
  var newEmployees = [];
  var usedHash = {};          // hash → emp_id, для контролю унікальності
  var candidates = [];

  ev.slice(1).forEach(function (r) {
    var empId = String(r[H['emp_id']] || '').trim();
    if (!empId) return;
    var roles = parseRoles_(posRoles[String(r[H['pos_id']] || '').trim()])
      .concat(parseRoles_(r[H['ролі додатково']]))
      .concat(parseRoles_(r[H['ролі відібрані']]));
    var caps = roleCaps_(roles);
    if (!caps.mech && !caps.master) return;             // до чек-листа не має стосунку

    candidates.push({
      emp_id: empId,
      full_name: String(r[H['ПІБ повне']] || '').trim(),
      email: String(r[H['email']] || '').trim(),
      position: String(r[H['посада']] || '').trim(),
      status: String(r[H['статус']] || '').trim(),
      hr_pin: String(r[H['PIN']] === undefined ? '' : r[H['PIN']]).trim(),
      roles: roles.filter(function (x) { return !!ROLE_CAPS[x]; }).join(' '),
      caps: caps
    });
  });

  out.push('Кандидатів у кадровій: ' + candidates.length);

  // 1-й прохід: чинні хеші — вони мають пріоритет над кадровими
  candidates.forEach(function (c) {
    var p = prev[c.emp_id];
    if (p && p.pin_hash && ['користувач', 'адмін', 'згенеровано'].indexOf(String(p.pin_source).trim()) > -1) {
      c.pin_hash = p.pin_hash;
      c.pin_source = String(p.pin_source).trim();
      c.must_change = String(p.must_change || 'ні').trim();
      c.pin_updated = p.pin_updated || '';
      usedHash[c.pin_hash] = c.emp_id;
    }
  });

  // 2-й прохід: PIN із кадрової — але тільки якщо він придатний як логін
  var issued = [], noPin = [], noEmail = [];
  candidates.forEach(function (c) {
    if (c.pin_hash) return;
    if (c.status !== 'active') return;              // звільненим вхід не заводимо

    var why = '';
    if (!/^\d{4,8}$/.test(c.hr_pin)) {
      why = c.hr_pin ? ('у кадровій «' + c.hr_pin + '» не годиться як PIN') : 'у кадровій PIN порожній';
    } else if (WEAK_PINS[c.hr_pin]) {
      // «1111» стоїть у 25 людей і є стартовим паролем — як логін він
      // означав би, що будь-хто з них заходить чужим іменем
      why = 'у кадровій стартовий «' + c.hr_pin + '» — спільний для багатьох';
    } else if (usedHash[pinHash_(c.hr_pin)]) {
      why = 'у кадровій «' + c.hr_pin + '» уже зайнятий іншим працівником';
    } else {
      usedHash[pinHash_(c.hr_pin)] = c.emp_id;
      c.pin_hash = pinHash_(c.hr_pin);
      c.pin_source = 'кадрова';
      c.must_change = 'ні';
      c.pin_updated = nowIsoUtc();
      return;
    }

    var np = freePin_(usedHash);
    if (!np) { noPin.push(c.full_name); return; }
    usedHash[pinHash_(np)] = c.emp_id;
    c.pin_hash = pinHash_(np);
    c.pin_source = 'згенеровано';
    c.must_change = 'так';
    c.pin_updated = nowIsoUtc();
    issued.push({ name: c.full_name, pin: np, why: why });
  });

  // прив'язка до 03_Працівники
  candidates.forEach(function (c) {
    c.user_id = matchUserId_(dict, c.full_name);
    if (!c.user_id) {
      c.user_id = nextUserId_(dict, newEmployees.length);
      newEmployees.push([c.user_id, c.full_name,
        c.caps.admin ? 'Керівник' : (c.caps.mech ? 'Механік' : 'Майстер'),
        c.status === 'active', '']);
      dict.byName[c.full_name] = c.user_id;
      dict.byIdUser[c.user_id] = c.full_name;
    }
    if (c.caps.email && !c.email) noEmail.push(c.full_name + ' (' + c.roles + ')');
  });

  if (newEmployees.length) appendRows(SH.EMPLOYEES, newEmployees);

  // ті, кого в кадровій уже немає, лишаються рядком, але без доступу
  var keep = {};
  candidates.forEach(function (c) { keep[c.emp_id] = true; });
  var dropped = acc.rows.filter(function (o) { return !keep[o.emp_id]; });

  var rows = candidates.map(function (c) {
    return [c.emp_id, c.user_id, c.full_name, c.email, c.position, c.roles,
            c.caps.mech ? 'так' : 'ні', c.caps.master ? 'так' : 'ні',
            (c.caps.email && c.email) ? 'так' : 'ні',
            c.status === 'active' ? 'так' : 'ні',
            c.pin_hash || '', c.pin_source || '', c.must_change || 'ні',
            c.pin_updated || '', nowIsoUtc(),
            c.status !== 'active' ? 'звільнений — вхід закрито' : ''];
  }).concat(dropped.map(function (o) {
    return ACCESS_COLS.map(function (h) {
      if (h === 'active') return 'ні';
      if (h === 'note') return 'немає в кадровій — вхід закрито';
      return o[h] === undefined ? '' : o[h];
    });
  }));

  var s = sheetByName(SH.ACCESS);
  if (s.getLastRow() > 1) s.getRange(2, 1, s.getLastRow() - 1, ACCESS_COLS.length).clearContent();
  if (rows.length) s.getRange(2, 1, rows.length, ACCESS_COLS.length).setValues(rows);

  // ── звіт ──
  out.push('Записано в ' + SH.ACCESS + ': ' + rows.length +
           ' (активних ' + candidates.filter(function (c) { return c.status === 'active'; }).length + ')');
  candidates.forEach(function (c) {
    out.push('   ' + (c.status === 'active' ? '·' : '×') + ' ' + c.full_name +
             '  [' + c.roles + ']  ' +
             (c.caps.mech ? 'механік ' : '') + (c.caps.master ? 'майстер ' : '') +
             (c.caps.email ? ('пошта→' + (c.email || 'НЕ ЗАДАНО')) : ''));
  });
  if (newEmployees.length) {
    out.push('');
    out.push('Додано в ' + SH.EMPLOYEES + ': ' +
             newEmployees.map(function (r) { return r[1]; }).join(', '));
  }
  if (issued.length) {
    out.push('');
    out.push('⚠️ ВИДАНО НОВІ PIN — перекажіть особисто, тут вони більше не з\'являться:');
    issued.forEach(function (i) { out.push('   ' + i.pin + '   ' + i.name + '   (' + i.why + ')'); });
    out.push('   При першому вході застосунок попросить замінити його на власний.');
  }
  if (noEmail.length) {
    out.push('');
    out.push('⚠️ Роль дає звіт на пошту, але email у кадровій порожній:');
    noEmail.forEach(function (n) { out.push('   ' + n); });
  }
  if (noPin.length) out.push('❌ Не вдалося підібрати вільний PIN: ' + noPin.join(', '));
  if (dropped.length) out.push('· Закрито доступ (немає в кадровій): ' +
    dropped.map(function (o) { return o.full_name; }).join(', '));

  var msg = out.join('\n');
  Logger.log(msg);
  logEvent('Доступ', 'sync.hr', 'рядків ' + rows.length + ', видано PIN ' + issued.length);
  return msg;
}

/** Вільний 4-значний PIN, не слабкий і ще не зайнятий. */
function freePin_(usedHash) {
  for (var i = 0; i < 800; i++) {
    var p = String(Math.floor(Math.random() * 9000) + 1000);
    if (WEAK_PINS[p]) continue;
    if (usedHash[pinHash_(p)]) continue;
    return p;
  }
  return null;
}

/** ПІБ із кадрової → user_id у 03_Працівники. Кадрова пише повністю, довідник — коротко. */
function matchUserId_(dict, fullName) {
  var n = normName_(fullName);
  if (!n) return '';
  var keys = Object.keys(dict.byName);
  for (var i = 0; i < keys.length; i++) if (normName_(keys[i]) === n) return dict.byName[keys[i]];

  var two = n.split(' ').slice(0, 2).join(' ');
  for (i = 0; i < keys.length; i++) {
    if (normName_(keys[i]).split(' ').slice(0, 2).join(' ') === two) return dict.byName[keys[i]];
  }
  return '';
}

function nextUserId_(dict, offset) {
  var max = 0;
  Object.keys(dict.byIdUser).forEach(function (id) {
    var m = /^U-(\d+)$/.exec(String(id));
    if (m) max = Math.max(max, Number(m[1]));
  });
  return 'U-' + ('00' + (max + 1 + (offset || 0))).slice(-3);
}


/* ─────────────────────────── ручні дії адміністратора ──────────────── */

/**
 * Призначити PIN працівникові — коли людина його забула.
 * Запускати з редактора: setPin('EMP-0007', '2468')
 */
function setPin(empId, pin) {
  return withLock(function () {
    var p = String(pin || '').trim();
    if (!/^\d{4,6}$/.test(p)) return 'PIN — від 4 до 6 цифр';
    if (WEAK_PINS[p]) return 'Такий PIN надто простий';

    var acc = readAccess_();
    var me = null, taken = '';
    var h = pinHash_(p);
    acc.rows.forEach(function (o) {
      if (o.emp_id === empId) me = o;
      else if (o.pin_hash === h) taken = o.full_name;
    });
    if (!me) return 'Немає працівника ' + empId + ' у ' + SH.ACCESS;
    if (taken) return 'Цей PIN уже в «' + taken + '» — оберіть інший';

    writeAccessCells_(acc.table, me._row, {
      pin_hash: h, pin_source: 'адмін', must_change: 'так', pin_updated: nowIsoUtc()
    });
    logEvent('Доступ', 'pin.set', me.full_name + ' (адміністратор)', { user_id: me.user_id });
    return 'PIN для «' + me.full_name + '» встановлено. При вході застосунок попросить його замінити.';
  }, 20000);
}

/** Закрити або відкрити вхід, не чіпаючи кадрову: setAccessActive('EMP-0007', false) */
function setAccessActive(empId, on) {
  var acc = readAccess_();
  var me = null;
  acc.rows.forEach(function (o) { if (o.emp_id === empId) me = o; });
  if (!me) return 'Немає працівника ' + empId;
  writeAccessCells_(acc.table, me._row, { active: on ? 'так' : 'ні' });
  logEvent('Доступ', 'access.' + (on ? 'on' : 'off'), me.full_name, { user_id: me.user_id });
  return me.full_name + ': вхід ' + (on ? 'відкрито' : 'закрито');
}

/** Скинути лічильник невдалих спроб, якщо когось замкнуло. */
function unlockAttempts() {
  CacheService.getScriptCache().remove('authfail_global');
  return 'Глобальну паузу знято. Пауза конкретного пристрою мине сама за 15 хвилин.';
}

/**
 * Стан автентифікації. PIN не показує — тільки чи він заданий.
 */
function authStatus() {
  var out = [];
  var props = PropertiesService.getScriptProperties();
  out.push('PIN_PEPPER: ' + (props.getProperty('PIN_PEPPER') ? 'задано' : 'ЩЕ НЕ СТВОРЕНО'));
  out.push('AUTH_SECRET: ' + (props.getProperty('AUTH_SECRET') ? 'задано' : 'ЩЕ НЕ СТВОРЕНО'));
  out.push('AUTH_REQUIRED: ' + (props.getProperty('AUTH_REQUIRED') || 'ні (перехідний період — старий клієнт ще приймається)'));
  out.push('');

  var s = ss().getSheetByName(SH.ACCESS);
  if (!s) { out.push('❌ Немає аркуша ' + SH.ACCESS + ' — запустіть setupSchema()'); }
  else {
    var acc = readAccess_();
    out.push('У ' + SH.ACCESS + ': ' + acc.rows.length + ' записів');
    var hashes = {}, dup = [];
    acc.rows.forEach(function (o) {
      var mark = yes_(o.active) ? '·' : '×';
      out.push('   ' + mark + ' ' + o.full_name + '  [' + o.roles + ']  PIN: ' +
               (o.pin_hash ? String(o.pin_source || '?') : 'НЕ ЗАДАНО') +
               (yes_(o.must_change) ? '  (треба змінити)' : '') +
               (yes_(o.can_email) ? '  пошта→' + o.email : ''));
      if (o.pin_hash) {
        if (hashes[o.pin_hash]) dup.push(hashes[o.pin_hash] + ' = ' + o.full_name);
        hashes[o.pin_hash] = o.full_name;
      }
    });
    out.push('');
    out.push(dup.length ? ('❌ ОДНАКОВІ PIN: ' + dup.join('; ')) : '✅ Однакових PIN немає');
  }

  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}


/**
 * Самоперевірка автентифікації. Нічого не пише в таблицю: перевіряє хеш,
 * підпис токена, реакцію на підробку і на прострочення, розбір ролей.
 * Запускати після будь-якої правки Auth.gs.
 */
function authSelfTest() {
  var out = [], bad = 0;
  function check(name, cond) {
    out.push((cond ? '✅ ' : '❌ ') + name);
    if (!cond) bad++;
  }

  // хеш
  check('хеш детермінований', pinHash_('4821') === pinHash_('4821'));
  check('різні PIN — різні хеші', pinHash_('4821') !== pinHash_('4822'));
  check('пробіли не впливають', pinHash_(' 4821 ') === pinHash_('4821'));
  check('хеш не містить самого PIN', pinHash_('4821').indexOf('4821') === -1);

  // токен
  var h = pinHash_('4821');
  var tok = makeToken_('EMP-0007', h);
  var parsed = parseToken_(tok);
  check('токен розбирається', !!parsed && parsed.emp_id === 'EMP-0007');
  check('відбиток PIN у токені', !!parsed && parsed.pin_fp === h.substring(0, 12));
  check('підроблений підпис відхилено', parseToken_(tok.split('.')[0] + '.deadbeef') === null);
  check('підмінене тіло відхилено',
        parseToken_(Utilities.base64EncodeWebSafe('EMP-0005|' + (Date.now() + 1000) + '|' +
          h.substring(0, 12), Utilities.Charset.UTF_8) + '.' + tok.split('.')[1]) === null);
  check('сміття відхилено', parseToken_('абвгд') === null && parseToken_('') === null);

  var expiredBody = 'EMP-0007|' + (Date.now() - 1000) + '|' + h.substring(0, 12);
  var expired = Utilities.base64EncodeWebSafe(expiredBody, Utilities.Charset.UTF_8) +
                '.' + sign_(expiredBody);
  check('прострочений токен відхилено', parseToken_(expired) === null);

  // ролі
  var c1 = roleCaps_(parseRoles_('zip.admin mech.admin'));
  check('mech.admin → механік + пошта', c1.mech && c1.email && !c1.master);
  var c2 = roleCaps_(parseRoles_('mech.use,zip.use'));
  check('mech.use → механік без пошти', c2.mech && !c2.email && !c2.master);
  var c3 = roleCaps_(parseRoles_('shift.master'));
  check('shift.master → майстер + пошта', c3.master && c3.email && !c3.mech);
  var c4 = roleCaps_(parseRoles_('admin'));
  check('admin → обидва чек-листи + пошта', c4.mech && c4.master && c4.email);
  var c5 = roleCaps_(parseRoles_('qc.use supply.use'));
  check('чужі ролі доступу не дають', !c5.mech && !c5.master);

  // слабкі PIN
  check('«1111» не приймається', !!WEAK_PINS['1111']);
  check('«4821» приймається', !WEAK_PINS['4821']);

  // звірка ПІБ кадрової з довідником
  var dict = loadDictionaries_();
  ['Гончарук Ольга Михайлівна', 'Шута Олександра Сергіівна', 'Гора Андрій Олександрович']
    .forEach(function (n) {
      check('ПІБ «' + n + '» знайдено в ' + SH.EMPLOYEES, !!matchUserId_(dict, n));
    });

  out.push('');
  out.push(bad ? ('❌ ПОМИЛОК: ' + bad) : '✅ Усі перевірки пройдено — нічого не записано');
  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}

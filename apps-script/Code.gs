/**
 * Code.gs — новий бекенд чек-листа.
 *
 * Відмінності від старого doPost:
 *   • пише рядок на кожен пункт, а не текстовий блок в одну комірку;
 *   • статус рахує з довідників 01_Пункти / 02_Варіанти, а не з позиції кнопки;
 *   • report_id перевіряється — повтор із офлайн-черги не створює дубль;
 *   • tryLock перевіряється, аркуш береться за іменем;
 *   • повертає справжній JSON, тож клієнт може перестати слати mode:'no-cors';
 *   • невдале збереження фото ВИДНО у відповіді, а не ховається в текст звіту;
 *   • автор звіту береться з токена входу, а не з того, що написав клієнт.
 *
 * ПЕРЕХІДНИЙ ПЕРІОД. Поки на телефонах лишається старий застосунок, звіт без
 * токена приймається — інакше в день розгортання всі звіти почали б губитися.
 * Коли всі перейдуть на новий клієнт, поставте властивість скрипта
 * AUTH_REQUIRED = так, і без входу писати вже не можна буде.
 *
 * Клієнт має слати POST БЕЗ власного заголовка Content-Type — тоді браузер
 * поставить text/plain, preflight не виникне і відповідь буде читабельною.
 */

// Версія бекенду. Її віддає ?action=ping і вона лягає в кожен звіт —
// саме за нею видно, чи розгортання справді підхопило новий код.
var APP_VERSION = 'checklist-2026-08-25-auth';

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'getConfig';
  try {
    if (action === 'getConfig') {
      var who = e.parameter.token ? verifySession_(e.parameter.token, e.parameter.device) : null;
      return jsonOut({ ok: true, config: buildClientConfig_(e.parameter.role, who) });
    }
    if (action === 'ping') return jsonOut({ ok: true, version: APP_VERSION, ts: nowIsoUtc() });
    return jsonOut({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  var payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut({ ok: false, error: 'bad json' });
  }

  // Вхід і зміна PIN — окремі дії. Вони НЕ під загальним блокуванням:
  // логін лише читає, а changePin бере блокування сам, усередині.
  var action = payload.action || 'submit';
  try {
    if (action === 'login')  return jsonOut(loginResponse_(loginWithPin_(payload.pin, payload.deviceId)));
    if (action === 'whoami') return jsonOut(sessionResponse_(verifySession_(payload.token, payload.deviceId)));
    if (action !== 'submit') return jsonOut({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    logEvent('Техніка', 'action.failed', action + ': ' + err, {});
    return jsonOut({ ok: false, error: 'SERVER', message: String(err) });
  }

  var result = withLock(function () { return submitReport_(payload); });
  if (!result.ok && result.retryable) {
    logEvent('Техніка', 'submit.busy', 'не вдалося взяти блокування', {});
  }
  return jsonOut(result);
}

function submitReport_(p) {
  var dict0 = loadDictionaries_();
  p = normalizeLegacyPayload_(p, dict0);          // ← сумісність зі старим клієнтом

  var auth = authorizeSubmit_(p);
  if (!auth.ok) return auth;
  if (auth.user) {
    // автора визначає токен, а не поле в payload: інакше будь-хто міг би
    // підписати звіт чужим прізвищем
    p.user_id = auth.user.user_id;
    p.user_name = auth.user.name;
  }

  var problems = validatePayload_(p);
  if (problems.length) {
    logEvent('Техніка', 'submit.invalid', problems.join('; '), { report_id: p && p.report_id });
    return { ok: false, error: 'invalid payload', details: problems };
  }

  // --- ідемпотентність ---
  var existing = existingReportIds_();
  if (existing[p.report_id]) {
    logEvent('Техніка', 'submit.duplicate', 'повтор ' + p.report_id, { report_id: p.report_id });
    return { ok: true, duplicate: true, report_id: p.report_id };
  }

  var dict = dict0;
  var user = resolveUser_(dict, p.user_id, p.user_name);
  var now = new Date();
  var bizDate = p.business_date || businessDate(now);

  var answers = [], cnt = { ok: 0, warn: 0, alert: 0, empty: 0, unknown: 0 };
  var alerts = [], emailItems = [];

  (p.items || []).forEach(function (it, i) {
    var item = dict.byId[it.item_id];
    // позиція у values = номер поля: values[0] звіряється з norm_*_1 і так далі.
    // Порожнє поле лишається null НА СВОЄМУ МІСЦІ — інакше значення другого
    // датчика перевірялося б за нормою першого.
    var nums = (it.values || []).slice(0, 3).map(toNumber);
    var filled = nums.filter(function (n) { return n !== null; });
    var status;
    if (!item) {
      status = 'unknown';
    } else if (it.value === '' && !filled.length) {
      status = 'empty';
    } else if (item.type === 'binary') {
      status = dict.optStatus[it.item_id + '|' + String(it.value).trim()] || 'unknown';
    } else if (item.type === 'number') {
      status = filled.length ? worstStatus(nums.map(function (v, f) {
        return v === null ? 'ok' : numberStatus_(item, f + 1, v);
      })) : 'empty';
    } else {
      status = it.value ? 'ok' : 'empty';
    }
    cnt[status] = (cnt[status] || 0) + 1;
    if (status === 'alert' || status === 'warn') {
      alerts.push({ status: status, text: item ? item.text : it.item_id,
                    value: it.value || filled.join(' / '), comment: it.comment || '' });
    }
    emailItems.push({
      group: item ? item.group_title : 'Інше',
      text: item ? item.text : (it.legacy_text || it.item_id),
      value: it.value || filled.join(' / '),
      status: status,
      comment: it.comment || '',
      item_id: it.item_id
    });

    answers.push([
      p.report_id + '#' + (i + 1), p.report_id, bizDate, p.stage, p.role, user.user_id,
      it.item_id, item ? item.text : (it.legacy_text || ''), i + 1,
      it.value || '', num_(nums, 0), num_(nums, 1), num_(nums, 2),
      status, '', it.comment || '', ''
    ]);
  });

  // --- фото ---
  var photos = savePhotos_(p, answers, dict);

  appendRows(SH.REPORTS, [[
    p.report_id, nowIsoUtc(), bizDate, p.stage, p.role, user.user_id, user.name,
    p.config_version || '', (p.items || []).length,
    cnt.ok, cnt.warn, cnt.alert, cnt.empty,
    photos.saved, photos.failed, 'app', '', p.app_version || APP_VERSION
  ]]);
  appendRows(SH.ANSWERS, answers);
  appendRows(SH.PHOTOS, photos.rows);

  try {
    sendReportEmail_(p, user, bizDate, cnt, alerts, photos, emailItems);
  } catch (mailErr) {
    // звіт уже збережено — розсилка не має його скасовувати, але мовчати теж не можна
    logEvent('Техніка', 'mail.failed', String(mailErr), { report_id: p.report_id });
    return { ok: true, report_id: p.report_id, counts: cnt,
             warnings: ['Звіт збережено, але лист не відправлено: ' + mailErr] };
  }

  var warnings = [];
  if (photos.failed) warnings.push('Не збереглося фото: ' + photos.failed);
  if (cnt.unknown) warnings.push('Пунктів без довідника: ' + cnt.unknown);

  logEvent('Звіт', 'submit.ok', 'alert=' + cnt.alert + ' warn=' + cnt.warn,
           { report_id: p.report_id, user_id: user.user_id, app_version: p.app_version });

  return { ok: true, report_id: p.report_id, counts: cnt, warnings: warnings };
}

/**
 * Старий клієнт шле інший payload: без report_id, з items[].text замість item_id,
 * з mechanic/shiftStage замість user_name/stage. Поки застосунок не оновлено,
 * приймаємо обидва формати — інакше після розгортання нового бекенду звіти
 * почали б відхилятися й губитися.
 *
 * Прибрати цю функцію можна тільки після того, як усі механіки перейдуть
 * на оновлений клієнт.
 */
function normalizeLegacyPayload_(p, dict) {
  if (!p || !p.items || !p.items.length) return p;
  if (p.report_id && p.items[0].item_id) return p;        // вже новий формат

  var role = p.role === 'Майстер' ? 'Майстер' : 'Механік';
  var stage = p.stage || p.shiftStage || '';
  var who = p.user_name || p.mechanic || '';
  var bizDate = legacyDate_(p.date) || businessDate();

  var items = p.items.map(function (it) {
    var text = String(it.text || '').trim();
    var value = String(it.value === undefined || it.value === null ? '' : it.value).trim();
    if (value === 'Н/Д') value = '';
    var itemId = dict.byText[role + '|' + text] || '';
    var norm = normalizeValue_(dict.byId[itemId], itemId, value);
    return {
      item_id: itemId,
      value: norm.text,
      values: norm.nums,
      comment: it.comment || '',
      photoData: it.photoData || null,
      legacy_text: text
    };
  });

  logEvent('Техніка', 'payload.legacy', 'старий формат від «' + who + '», пунктів ' + items.length,
           { user_id: dict.byName[who] || 'U-000' });

  return {
    report_id: makeReportId(bizDate, role, stage, nowIsoUtc() + '|' + who + '|' + stage),
    business_date: bizDate,
    stage: stage,
    role: role,
    user_name: who,
    config_version: 'legacy-client',
    app_version: 'legacy',
    items: items
  };
}

/** Відповідь клієнтові про сесію: без PIN, без чужих даних, тільки права. */
function sessionUser_(u) {
  return {
    user_id: u.user_id, name: u.name, short_name: u.shortName, roles: u.roles,
    can: {
      mech: can_(u, 'submitMech'),
      master: can_(u, 'submitMaster'),
      email: (can_(u, 'reportMech') || can_(u, 'reportMaster')) && u.email.indexOf('@') > -1
    }
  };
}

function loginResponse_(r) {
  if (!r.success) return { ok: false, error: r.code, message: r.error };
  return {
    ok: true, token: r.token, expires_at: r.expiresAt,
    user: sessionUser_({ user_id: r.user_id, name: r.name, shortName: r.shortName,
                         roles: r.roles, permissions: r.permissions, email: r.email })
  };
}

function sessionResponse_(u) {
  if (!u) return { ok: false, error: 'AUTH', message: 'Сесію завершено. Увійдіть за PIN.' };
  return { ok: true, user: sessionUser_(u) };
}

/**
 * Хто це і чи має він право здавати саме цей чек-лист.
 *
 * Права перечитуються з кадрової при кожному звіті: звільнення або зміна
 * ролі діють одразу, не чекаючи, поки скінчиться сесія.
 *
 * Поки AUTH_REQUIRED не «так», звіт без токена приймається — це вікно для
 * телефонів, на яких ще стоїть старий застосунок. Такий звіт помічається
 * у журналі як anonymous, щоб було видно, скільки їх лишилося.
 */
function authorizeSubmit_(p) {
  var required = String(PropertiesService.getScriptProperties()
    .getProperty('AUTH_REQUIRED') || '').trim().toLowerCase();
  var strict = ['так', 'yes', 'true', '1'].indexOf(required) > -1;

  var user = null;
  if (p && p.token) {
    try {
      user = verifySession_(p.token, p.deviceId);
    } catch (e) {
      // кадрова недоступна — у суворому режимі це відмова, інакше працюємо як без токена
      logEvent('Доступ', 'session.checkFailed', String(e), { report_id: p && p.report_id });
      if (strict) return { ok: false, error: 'SERVER', message: 'Не вдалося перевірити доступ: ' + e };
    }
  }

  if (!user) {
    if (strict) {
      logEvent('Доступ', 'submit.noauth', 'звіт без входу відхилено', { report_id: p && p.report_id });
      return { ok: false, error: 'AUTH', message: 'Сесію завершено. Увійдіть за PIN.' };
    }
    logEvent('Доступ', 'submit.anonymous', 'звіт зі старого клієнта, без входу',
             { report_id: p && p.report_id });
    return { ok: true, user: null };
  }

  var action = p.role === 'Майстер' ? 'submitMaster' : 'submitMech';
  if (!can_(user, action)) {
    logEvent('Доступ', 'access.denied',
             user.name + ' → ' + action + ', ролі: ' + user.roles.join(', '),
             { user_id: user.user_id });
    return { ok: false, error: 'FORBIDDEN',
             message: 'Ваша роль не дає права здавати чек-лист ' +
                      (action === 'submitMaster' ? 'майстра' : 'механіка') };
  }

  return { ok: true, user: user };
}

/**
 * Перевіряється ПІСЛЯ authorizeSubmit_, і це важливо: автора там уже
 * проставлено з підтвердженої сесії. Новий клієнт імені взагалі не надсилає —
 * вимога «немає автора» лишається тільки для звітів зі старого застосунку,
 * поки AUTH_REQUIRED не «так».
 */
function validatePayload_(p) {
  var out = [];
  if (!p) return ['порожній payload'];
  if (!p.report_id) out.push('немає report_id');
  if (['Початок зміни', 'Кінець зміни'].indexOf(p.stage) === -1) out.push('невідома стадія');
  if (['Механік', 'Майстер'].indexOf(p.role) === -1) out.push('невідома роль');
  if (!p.user_id && !p.user_name) out.push('немає автора');
  if (!p.items || !p.items.length) out.push('немає жодного пункту');
  return out;
}

function resolveUser_(dict, userId, userName) {
  if (userId && dict.byIdUser && dict.byIdUser[userId]) {
    return { user_id: userId, name: dict.byIdUser[userId] };
  }
  var uid = dict.byName[String(userName || '').trim()];
  return { user_id: uid || 'U-000', name: userName || '' };
}

/**
 * Зберігає фото на Drive. Доступ перевіряється ОДИН раз наперед: якщо папка
 * недоступна, ми одразу знаємо про це і повідомляємо, а не пишемо 134 рядки
 * «Помилка фото» всередину звіту, як робив старий скрипт.
 */
function savePhotos_(p, answers, dict) {
  var out = { rows: [], saved: 0, failed: 0, blobs: {}, urls: {} };
  var items = (p.items || []).filter(function (it) { return it.photoData; });
  if (!items.length) return out;

  var folderId = PropertiesService.getScriptProperties().getProperty('PHOTO_FOLDER_ID');
  var folder = null, folderError = '';
  try {
    folder = folderId ? DriveApp.getFolderById(folderId) : null;
    if (!folder) folderError = 'PHOTO_FOLDER_ID не заданий у властивостях скрипта';
  } catch (err) {
    folderError = String(err);
  }

  items.forEach(function (it, k) {
    var pid = p.report_id + '#p' + (k + 1);
    if (!folder) {
      out.rows.push([pid, p.report_id, it.item_id, '', '', 'failed', folderError]);
      out.failed++;
      return;
    }
    try {
      var b64 = it.photoData.indexOf('base64,') > -1 ? it.photoData.split('base64,')[1] : it.photoData;
      var name = [businessDate(), p.stage === 'Кінець зміни' ? 'end' : 'start',
                  it.item_id, p.report_id].join('_') + '.jpg';
      var bytes = Utilities.base64Decode(b64);
      var file = folder.createFile(Utilities.newBlob(bytes, MimeType.JPEG, name));
      var url = file.getUrl();
      out.blobs[it.item_id] = Utilities.newBlob(bytes, MimeType.JPEG, name);
      out.urls[it.item_id] = url;
      out.rows.push([pid, p.report_id, it.item_id, url, file.getId(), 'saved', '']);
      out.saved++;
      for (var a = 0; a < answers.length; a++) {
        if (answers[a][6] === it.item_id) { answers[a][16] = url; break; }
      }
    } catch (err) {
      out.rows.push([pid, p.report_id, it.item_id, '', '', 'failed', String(err)]);
      out.failed++;
      logEvent('Техніка', 'photo.failed', String(err), { report_id: p.report_id });
    }
  });
  return out;
}

/**
 * Конфігурація для клієнта: пункти, варіанти, працівники — з довідників.
 *
 * role — «Механік» або «Майстер». Якщо переданий токен, віддаємо тільки те,
 * на що ця людина має право: майстер не має бачити чек-лист механіка і навпаки.
 */
function buildClientConfig_(role, who) {
  var it = readTable(SH.ITEMS), op = readTable(SH.OPTIONS), em = readTable(SH.EMPLOYEES);
  var today = businessDate();

  var allowed = null;
  if (who) {
    allowed = {};
    if (can_(who, 'submitMech')) allowed['Механік'] = true;
    if (can_(who, 'submitMaster')) allowed['Майстер'] = true;
  }
  var wantRole = ['Механік', 'Майстер'].indexOf(String(role)) > -1 ? String(role) : '';

  var opts = {};
  op.rows.forEach(function (r) {
    if (!r[0] || String(r[4]).trim() === 'ні') return;   // історичні варіанти не показуємо
    (opts[r[0]] = opts[r[0]] || []).push({ value: r[2], status: r[3] });
  });

  var items = it.rows.filter(function (r) {
    var o = {};
    it.header.forEach(function (h, i) { o[h] = r[i]; });
    if (!o.item_id || o.visible_on === 'none') return false;
    if (wantRole && o.role !== wantRole) return false;
    if (allowed && !allowed[o.role]) return false;
    return !o.active_to || String(o.active_to) >= today;
  }).map(function (r) {
    var o = {};
    it.header.forEach(function (h, i) { o[h] = r[i]; });
    o.options = opts[o.item_id] || [];
    o.labels = String(o.labels || '').split(';').filter(String);
    return o;
  });

  var staff = em.rows.filter(function (r) { return r[0] && String(r[3]).trim() !== 'ні'; })
    .map(function (r) { return { user_id: r[0], name: r[1], role: r[2] }; });

  return {
    version: APP_VERSION,
    items: items,
    employees: staff,
    can: who ? { mech: can_(who, 'submitMech'), master: can_(who, 'submitMaster') } : null
  };
}

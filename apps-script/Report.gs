/**
 * Report.gs — розсилка і щоденний контроль.
 *
 * Головна відмінність від старого листа: блок «Відхилень: N» стоїть УГОРІ,
 * до всього іншого. Раніше 303 сигнали за пів року були розкидані по 352
 * листах серед 38 зелених рядків, і на них ніхто не реагував.
 *
 * Одержувачі беруться зі Script Properties, а НЕ з payload клієнта.
 */

function recipients_(key) {
  var v = PropertiesService.getScriptProperties().getProperty(key || 'MAIL_TO');
  return (v || '').split(',').map(function (s) { return s.trim(); }).filter(String);
}

/**
 * Кому йде цей конкретний звіт: постійний список MAIL_TO плюс власна пошта
 * автора, якщо його роль це дає (mech.admin, shift.master, admin).
 *
 * Ролі mech.use пошта не належить — вона тільки здає чек-лист.
 * Якщо якийсь керівник має отримувати ВСІ звіти, а не лише свої, його адресу
 * треба дописати в MAIL_TO: роль на це не впливає.
 */
function recipientsFor_(authUser) {
  var to = recipients_('MAIL_TO');
  if (authUser && authUser.can_email && authUser.email) {
    var own = String(authUser.email).trim();
    var has = to.some(function (a) { return a.toLowerCase() === own.toLowerCase(); });
    if (!has) to.push(own);
  }
  return to;
}

/**
 * Лист. ВЕРСТКА — ТА САМА, ЩО У СТАРОМУ doPost: заголовок, дата, розділ на
 * кожну категорію, таблиця «Пункт | Статус/Дані | Фото», інлайн-фото з
 * посиланням, червона підсвітка відхилень. Нічого в оформленні не змінено.
 *
 * Єдина відмінність від старого: статус береться з довідників, а не з позиції
 * кнопки, тому ❗ тепер стоїть там, де справді відхилення.
 */
function sendReportEmail_(p, user, bizDate, cnt, alerts, photos, items, authUser) {
  var to = recipientsFor_(authUser);
  if (!to.length) {
    logEvent('Техніка', 'mail.skipped', 'MAIL_TO не заданий у властивостях скрипта', {});
    return;
  }

  var role = p.role || 'Механік';
  var who = user.name || p.user_name || '';
  var subject = 'Звіт (' + role + '): ' + p.stage + ' - ' + who;

  // групуємо за категоріями, зберігаючи порядок появи — як робив старий скрипт
  var order = [], grouped = {};
  (items || []).forEach(function (it) {
    var g = it.group || 'Інше';
    if (!grouped[g]) { grouped[g] = []; order.push(g); }
    grouped[g].push(it);
  });

  var inlineImages = {};
  var attachments = [];
  var cidByItem = {};
  var n = 0;
  Object.keys(photos.blobs || {}).forEach(function (itemId) {
    var cid = 'img_' + (n++);
    cidByItem[itemId] = cid;
    inlineImages[cid] = photos.blobs[itemId].copyBlob().setName(cid);
    attachments.push(photos.blobs[itemId]);
  });

  var html = '' +
    '<h2 style="color: #047857; margin-bottom: 5px;">' + esc_(subject) + '</h2>' +
    '<p style="margin-top: 0;"><strong>Дата:</strong> ' + esc_(bizDate) + ' ' + esc_(localTime()) + '</p>' +
    '<hr style="border: 0; border-top: 1px solid #eee; margin-bottom: 20px;">';

  order.forEach(function (g) {
    html += '' +
      '<h3 style="background-color: #f1f5f9; padding: 10px; border-left: 4px solid #10b981; ' +
      'margin-top: 25px; margin-bottom: 10px; color: #1e293b;">' + esc_(g) + '</h3>' +
      '<table style="border-collapse: collapse; width: 100%; border: 1px solid #e2e8f0; ' +
      'font-family: sans-serif; font-size: 14px;">' +
      '<tr style="background-color: #f8fafc; color: #64748b;">' +
      '<th style="border: 1px solid #e2e8f0; padding: 10px; text-align: left; width: 55%;">Пункт</th>' +
      '<th style="border: 1px solid #e2e8f0; padding: 10px; text-align: center; width: 25%;">Статус/Дані</th>' +
      '<th style="border: 1px solid #e2e8f0; padding: 10px; text-align: center; width: 20%;">Фото</th>' +
      '</tr>';

    grouped[g].forEach(function (it) {
      var isBad = it.status === 'alert';
      var isWarn = it.status === 'warn';
      var rowColor = isBad ? '#fef2f2' : (isWarn ? '#fffbeb' : (it.status === 'empty' ? '#f9fafb' : '#ffffff'));
      var textColor = isBad ? '#b91c1c' : (isWarn ? '#b45309' : '#1e293b');
      var boldWeight = (isBad || isWarn) ? 'font-weight: bold;' : '';
      var prefix = isBad ? '❗ ' : (isWarn ? '⚠️ ' : '');

      var cid = cidByItem[it.item_id];
      var photoHtml = cid
        ? '<img src="cid:' + cid + '" style="max-width:100px;border-radius:4px;"><br>' +
          '<a href="' + esc_(photos.urls[it.item_id] || '') + '" style="font-size: 11px; color: #3b82f6;">Посилання</a>'
        : "<span style='color:#cbd5e1;'>-</span>";

      html += '' +
        '<tr style="background-color: ' + rowColor + '; color: ' + textColor + ';">' +
        '<td style="border: 1px solid #e2e8f0; padding: 10px; ' + boldWeight + '">' +
        prefix + esc_(it.text) +
        (it.comment
          ? '<br><em style="color:#64748b; font-size: 0.85em; font-weight: normal; display: block; ' +
            'margin-top: 4px;">💬 Коментар: ' + esc_(it.comment) + '</em>'
          : '') +
        '</td>' +
        '<td style="border: 1px solid #e2e8f0; padding: 10px; text-align: center; ' + boldWeight + '">' +
        esc_(it.value || (it.status === 'empty' ? '-' : 'OK')) +
        '</td>' +
        '<td style="border: 1px solid #e2e8f0; padding: 10px; text-align: center;">' + photoHtml + '</td>' +
        '</tr>';
    });
    html += '</table>';
  });

  if (photos.failed) {
    html += '<p style="color: red; margin-top: 20px;"><strong>Помилка збереження фото на Диск:</strong> ' +
            photos.failed + ' шт.</p>';
  }

  MailApp.sendEmail({
    to: to.join(','),
    subject: subject,
    htmlBody: html,
    inlineImages: inlineImages,
    attachments: attachments
  });
}

function esc_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Щоденна перевірка: чи здано обидві зміни за вчора.
 * Саме цього бракувало — 13 днів без жодного звіту і 18 днів з однією зміною
 * з двох пройшли непоміченими за пів року.
 *
 * Повісити тригер: щодня ~09:00.
 */
function checkSchedule() {
  var d = new Date();
  d.setDate(d.getDate() - 1);
  var day = businessDate(d);

  var rep = readTable(SH.REPORTS);
  var got = {};
  rep.rows.forEach(function (r) {
    if (String(r[rep.col.business_date]) !== day) return;
    var k = r[rep.col.role] + '|' + r[rep.col.stage];
    got[k] = (got[k] || 0) + 1;
  });

  // повторний запуск за той самий день не має дублювати рядки
  var sch = readTable(SH.SCHEDULE);
  var already = {};
  sch.rows.forEach(function (r) { already[r[0] + '|' + r[1] + '|' + r[2]] = true; });

  var expect = [['Механік', 'Початок зміни'], ['Механік', 'Кінець зміни']];
  var rows = [], missing = [], dupes = [];
  expect.forEach(function (e) {
    var n = got[e[0] + '|' + e[1]] || 0;
    var st = n === 0 ? 'пропущено' : (n > 1 ? 'дубль' : 'ok');
    if (!already[day + '|' + e[1] + '|' + e[0]]) rows.push([day, e[1], e[0], 1, n, st]);
    if (st === 'пропущено') missing.push(e[0] + ' · ' + e[1]);
    if (st === 'дубль') dupes.push(e[0] + ' · ' + e[1] + ' (' + n + ')');
  });
  appendRows(SH.SCHEDULE, rows);
  if (!rows.length) return 'за ' + day + ' перевірку вже виконано';

  if (!missing.length && !dupes.length) return 'за ' + day + ' усе на місці';

  var to = recipients_('MAIL_ALERT_TO').length ? recipients_('MAIL_ALERT_TO') : recipients_('MAIL_TO');
  if (to.length) {
    var body = '<div style="font-family:sans-serif">' +
      (missing.length ? '<p><b>Не здано чек-лист за ' + esc_(day) + ':</b><br>' +
        missing.map(esc_).join('<br>') + '</p>' : '') +
      (dupes.length ? '<p><b>Здано більше одного разу:</b><br>' + dupes.map(esc_).join('<br>') + '</p>' : '') +
      '</div>';
    MailApp.sendEmail({ to: to.join(','), subject: 'Чек-лист за ' + day + ': є питання', htmlBody: body });
  }
  var msg = 'пропущено: ' + (missing.join(', ') || '—') + '; дублі: ' + (dupes.join(', ') || '—');
  logEvent('Контроль', 'checkSchedule', msg);
  return msg;
}

/**
 * Тижневий дайджест: що повторюється. Повісити тригер на понеділок.
 * Саме він мав би ще в березні показати, що UF-знезараження не працює 55 разів.
 */
function weeklyDigest() {
  var since = new Date();
  since.setDate(since.getDate() - 7);
  var from = businessDate(since);

  var ans = readTable(SH.ANSWERS);
  var byItem = {};
  ans.rows.forEach(function (r) {
    if (String(r[ans.col.business_date]) < from) return;
    var st = r[ans.col.status];
    if (st !== 'alert' && st !== 'warn') return;
    var k = r[ans.col.item_text_snapshot] || r[ans.col.item_id];
    byItem[k] = byItem[k] || { alert: 0, warn: 0 };
    byItem[k][st]++;
  });

  var list = Object.keys(byItem).map(function (k) {
    return { text: k, a: byItem[k].alert, w: byItem[k].warn };
  }).sort(function (x, y) { return (y.a * 10 + y.w) - (x.a * 10 + x.w); });

  var to = recipients_('MAIL_ALERT_TO').length ? recipients_('MAIL_ALERT_TO') : recipients_('MAIL_TO');
  if (!to.length) return 'MAIL_TO не заданий';

  var html = '<div style="font-family:sans-serif;font-size:14px">' +
             '<h3>Відхилення за тиждень (з ' + esc_(from) + ')</h3>';
  if (!list.length) {
    html += '<p>Відхилень немає.</p>';
  } else {
    html += '<table style="border-collapse:collapse">';
    list.slice(0, 20).forEach(function (x) {
      html += '<tr><td style="border:1px solid #e2e8f0;padding:7px 10px">' + esc_(x.text) + '</td>' +
              '<td style="border:1px solid #e2e8f0;padding:7px 10px;text-align:center;color:#b91c1c"><b>' +
              x.a + '</b></td>' +
              '<td style="border:1px solid #e2e8f0;padding:7px 10px;text-align:center;color:#b45309">' +
              x.w + '</td></tr>';
    });
    html += '</table><p style="color:#64748b;font-size:12px">колонки: відхилень · попереджень</p>';
  }
  html += '</div>';
  MailApp.sendEmail({ to: to.join(','), subject: 'Чек-лист: відхилення за тиждень', htmlBody: html });
  logEvent('Контроль', 'weeklyDigest', 'позицій у дайджесті: ' + list.length);
  return 'відправлено, позицій: ' + list.length;
}

/** Разова установка тригерів. Повторний запуск не дублює. */
function installTriggers() {
  var have = {};
  ScriptApp.getProjectTriggers().forEach(function (t) { have[t.getHandlerFunction()] = true; });
  if (!have.checkSchedule) {
    ScriptApp.newTrigger('checkSchedule').timeBased().atHour(9).everyDays(1).inTimezone(TZ).create();
  }
  if (!have.weeklyDigest) {
    ScriptApp.newTrigger('weeklyDigest').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY)
      .atHour(8).inTimezone(TZ).create();
  }
  return 'тригери на місці';
}

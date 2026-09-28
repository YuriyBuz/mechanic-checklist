/* Клієнт у браузері: вхід, ролі, типи пунктів, склад payload. */
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8731';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwc' +
  'KDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAA' +
  'AAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
let fails = 0;
const t = (n, c) => { console.log((c ? '  ✅ ' : '  ❌ ') + n); if (!c) fails++; };

(async () => {
  await fetch(BASE + '/reset');
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await (await browser.newContext()).newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));

  const shown = () => page.locator('#authOverlay').evaluate(e => !e.classList.contains('hidden'));
  const err = () => page.locator('#authError').textContent();
  const dlgOpen = () => page.locator('#customDialogOverlay').evaluate(e => !e.classList.contains('hidden'));
  const dlgText = () => page.locator('#customDialogMessage').textContent();
  const closeDlg = async () => { if (await dlgOpen()) {
    await page.locator('#customDialogButtons button').last().click(); await page.waitForTimeout(200); } };

  console.log('\n── екран входу ──');
  await page.goto(BASE + '/app'); await page.waitForTimeout(700);
  t('без сесії показано вхід', await shown());
  t('панелі зміни PIN немає', (await page.locator('#authChangePane').count()) === 0);
  t('кнопки «Змінити PIN» немає', (await page.locator('#changePinBtn').count()) === 0);

  await page.fill('#authPin', '0000'); await page.click('#authLoginBtn'); await page.waitForTimeout(400);
  t('невірний PIN → повідомлення', (await err()).includes('Невірний PIN'));
  t('поле очищено', (await page.inputValue('#authPin')) === '');

  console.log('\n── спільний PIN ──');
  await page.fill('#authPin', '1111'); await page.click('#authLoginBtn'); await page.waitForTimeout(400);
  t('дубль не пускає', (await err()).includes('кількома працівниками'));
  t('  і каже, куди йти', (await err()).includes('кадровій таблиці'));

  console.log('\n── роль без права на цей чек-лист ──');
  await page.fill('#authPin', '8294'); await page.click('#authLoginBtn'); await page.waitForTimeout(400);
  t('майстра не пускає', (await err()).includes('не дає доступу'));
  t('оверлей лишається', await shown());

  console.log('\n── успішний вхід ──');
  await page.fill('#authPin', '2468'); await page.click('#authLoginBtn'); await page.waitForTimeout(700);
  t('оверлей закрито', !(await shown()));
  t('нічого не питає про зміну PIN', !(await dlgOpen()));
  const sel = page.locator('#employeeSelect');
  t('прізвище з входу', (await sel.inputValue()) === 'Гора Андрій Олександрович');
  t('список заблоковано', await sel.isDisabled());
  t('є «Вийти»', await page.locator('#logoutBtn').isVisible());
  t('PIN ніде не збережено',
    !(await page.evaluate(() => JSON.stringify(localStorage).includes('2468'))));
  t('офлайн-перевірник збережено',
    await page.evaluate(() => !!localStorage.getItem('checklistOfflineUnlockV1')));
  t('  і це не сам PIN', await page.evaluate(() => {
    const r = JSON.parse(localStorage.getItem('checklistOfflineUnlockV1'));
    return !!r.salt && r.hash.length === 64 && JSON.stringify(r).indexOf('2468') === -1;
  }));

  console.log('\n── чек-лист v4 із сервера ──');
  t('конфіг закешовано', await page.evaluate(() => !!localStorage.getItem('checklistConfigV4')));
  const titles = await page.locator('#startShiftSection h3').allTextContents();
  t('групи в порядку маршруту: 0 → … → 9', /^0\./.test(titles[0]) && /^9\./.test(titles[titles.length - 1]));
  t('  зранку «Підсумок зміни» не показується', !titles.some(x => /^10\./.test(x)));
  t('54 пункти на початку зміни', (await page.locator('#startShiftSection .checklist-item').count()) === 54);
  t('підказка під пунктом 0-1', (await page.locator('#start-0-1 .item-hint').textContent()).includes('2-й і 3-й'));
  t('під 0-2 — «запису немає», доки ніхто не здав кінець зміни',
    (await page.locator('#start-0-2 .handover-box').textContent()).includes('немає'));
  const it34 = page.locator('#start-3-4'), it56 = page.locator('#start-5-6');
  t('3-4 кнопковий з фото', (await it34.getAttribute('data-type')) === 'binary'
    && (await it34.locator('.option-btn').allTextContents()).join('|') === 'Помилок немає|Є помилка');
  t('5-6 має три поля', (await it56.getAttribute('data-type')) === 'triple_input'
    && (await it56.locator('[data-input-1],[data-input-2],[data-input-3]').count()) === 3);
  t('7-12 має п’ять варіантів', (await page.locator('#start-7-12 .option-btn').count()) === 5);
  t('колір кнопки — за статусом: «Вимкнено за таймером» зелене',
    (await page.locator('#start-7-12 .option-btn').nth(1).getAttribute('data-kind')) === 'good');

  console.log('\n── червона відповідь вимагає коментар ──');
  await page.locator('#start-1-2 .option-btn', { hasText: 'Є' }).last().click(); await page.waitForTimeout(300);
  t('вікно коментаря відкрилось само',
    (await page.locator('#commentModal').evaluate(e => getComputedStyle(e).display)) === 'flex');
  await page.click('#cancelCommentBtn'); await page.waitForTimeout(200);
  t('підказка під пунктом: потрібен коментар',
    (await page.locator('#start-1-2 .need-note').textContent()).includes('коментар'));
  await page.locator('#start-1-2 .comment-btn').click(); await page.fill('#commentTextarea', 'E12 на пульті №2');
  await page.click('#saveCommentBtn'); await page.waitForTimeout(200);
  t('  після коментаря підказка зникла',
    await page.locator('#start-1-2 .need-note').evaluate(e => e.classList.contains('hidden')));
  await page.locator('#start-1-2 .option-btn').first().click(); await page.waitForTimeout(200);

  console.log('\n── заповнення ──');
  await page.evaluate(() => {
    document.querySelectorAll('#startShiftSection .checklist-item').forEach(el => {
      if (el.dataset.type === 'binary') el.querySelector('.option-btn').click();
      else el.querySelectorAll('input[type=text]').forEach((i, k) => {
        i.value = String(20 + k); i.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });
  });
  // фото потрібне пункту або першій відповіді (0-1 «Отримав» → фото)
  const needPhoto = await page.evaluate(() =>
    checklistConfig.flatMap(g => g.items).filter(i => (i.visibleOn === 'all' || i.visibleOn === 'start') &&
      (i.photoRequired || String((i.meta[i.options[0]] || {}).requires || '').includes('фото'))).map(i => i.id));
  t('зранку фото вимагають 6 пунктів (0-1 — через відповідь «Отримав»; 7-й, 10-1, — увечері)',
    needPhoto.length === 6 && needPhoto.includes('0-1') && needPhoto.includes('7-14'));
  for (const id of needPhoto) {
    await page.setInputFiles(`#start-${id} .photo-input`, { name: 'p.jpg', mimeType: 'image/jpeg', buffer: JPEG });
    await page.waitForTimeout(250);
  }
  t('усі фото прикріплено',
    (await page.locator('#startShiftSection .photo-btn.has-photo').count()) === needPhoto.length);
  t('індикатор обробки згас', !(await page.locator('#currentStatus').textContent()).includes('Обробка'));
  t('усі пункти заповнено', (await page.locator('#currentStatus').textContent()).includes('Залишилось завдань: 0'));

  console.log('\n── сесія переживає перезавантаження ──');
  await page.reload(); await page.waitForTimeout(900);
  t('вхід не питають удруге', !(await shown()));
  t('відповіді 5-6 відновлено', (await page.locator('#start-5-6 [data-input-3]').inputValue()) === '22');
  t('чек-лист після перезавантаження — з кешу, той самий',
    (await page.locator('#startShiftSection .checklist-item').count()) === 54);

  console.log('\n── відправка ──');
  for (const id of needPhoto) {
    await page.setInputFiles(`#start-${id} .photo-input`, { name: 'p.jpg', mimeType: 'image/jpeg', buffer: JPEG });
    await page.waitForTimeout(250);
  }
  await page.click('#mainSubmitBtn'); await page.waitForTimeout(400);
  t('прев\'ю каже, що все заповнено', (await page.locator('#modalMessage').textContent()).includes('коректно'));
  await page.click('#submitReportBtn'); await page.waitForTimeout(1800);
  t('повідомлення про успіх', (await dlgText()).includes('успішно відправлено'));
  await closeDlg();
  const nStart = await page.locator('#startShiftSection .checklist-item').count();
  t('форму очищено після ok',
    (await page.locator('#currentStatus').textContent()).includes('Залишилось завдань: ' + nStart));

  const got = await (await fetch(BASE + '/received')).json();
  t('сервер отримав рівно один звіт', got.length === 1);
  const p = got[0];
  console.log('   report_id: ' + p.report_id + ' · дата: ' + p.business_date + ' · пунктів: ' + p.items.length);
  t('токен і пристрій надіслані', !!p.token && !!p.deviceId);
  t('роль і стадія', p.role === 'Механік' && p.stage === 'Початок зміни');
  t('автора визначив сервер, а не клієнт', p._author === 'Гора Андрій Олександрович');
  t('клієнт імені автора не надсилає', p.user_name === undefined && p.user_id === undefined);
  t('report_id за київською датою',
    new RegExp('^' + new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv' }).format(new Date()) +
               '_mech_start_[0-9a-f]{6}$').test(p.report_id));
  t('усі пункти з item_id', p.items.every(i => /^mech\./.test(i.item_id)));
  t('тексту пунктів більше не шлемо', p.items.every(i => i.text === undefined));
  t('версія чек-листа у звіті — з сервера', p.config_version === 'mech-v4');
  t('5-6 надіслав три числа за позиціями',
    JSON.stringify(p.items.find(i => i.item_id === 'mech.5-6').values) === '["20","21","22"]');
  t('7-14 надіслав два числа і фото', (() => { const x = p.items.find(i => i.item_id === 'mech.7-14');
    return JSON.stringify(x.values) === '["20","21"]' && !!x.photoData; })());
  t('1-1 надіслав два числа',
    JSON.stringify(p.items.find(i => i.item_id === 'mech.1-1').values) === '["20","21"]');
  const i34 = p.items.find(i => i.item_id === 'mech.3-4');
  t('3-4 надіслав варіант із довідника', i34.value === 'Помилок немає' && i34.values.length === 0);
  t('7-2 (одне число) надіслав values',
    JSON.stringify(p.items.find(i => i.item_id === 'mech.7-2').values) === '["20"]');
  t('5-2 тепер кнопки: варіант із довідника, values порожній', (() => { const x = p.items.find(i => i.item_id === 'mech.5-2');
    return x.value === 'Помилок немає' && x.values.length === 0; })());
  t('0-1 «Отримав» із фото бланка', (() => { const x = p.items.find(i => i.item_id === 'mech.0-1');
    return x.value === 'Отримав' && !!x.photoData; })());
  t('коментар до 1-2 поїхав', p.items.find(i => i.item_id === 'mech.1-2').comment === 'E12 на пульті №2');
  t('фото додані', p.items.filter(i => i.photoData).length === needPhoto.length);

  console.log('\n── кінець зміни: вимога залежить від відповіді, передача зміни ──');
  await page.click('#endShiftBtn'); await page.waitForTimeout(400);
  t('38 пунктів увечері', (await page.locator('#endShiftSection .checklist-item').count()) === 38);
  const titlesEnd = await page.locator('#endShiftSection h3').allTextContents();
  t('увечері є «Підсумок зміни», немає «Завдань»',
    titlesEnd.some(x => /^10\./.test(x)) && !titlesEnd.some(x => /^0\./.test(x)));
  await page.locator('#end-10-5 .option-btn', { hasText: 'Не потрібно' }).click(); await page.waitForTimeout(250);
  t('10-5 «Не потрібно» — без коментаря',
    (await page.locator('#commentModal').evaluate(e => getComputedStyle(e).display)) !== 'flex');
  await page.locator('#end-10-5 .option-btn', { hasText: 'Подано' }).first().click(); await page.waitForTimeout(250);
  t('10-5 «Подано» — просить текст',
    (await page.locator('#commentModal').evaluate(e => getComputedStyle(e).display)) === 'flex');
  await page.fill('#commentTextarea', 'Сальник насоса ХВО, 2 шт'); await page.click('#saveCommentBtn');
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    document.querySelectorAll('#endShiftSection .checklist-item').forEach(el => {
      if (el.dataset.type === 'binary') { if (!el.dataset.value) el.querySelector('.option-btn').click(); }
      else el.querySelectorAll('input[type=text]').forEach((i, k) => {
        i.value = el.id === 'end-10-7' ? 'Насос №2 гуде — подивитись зранку' : String(20 + k);
        i.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });
  });
  const needPhotoEnd = await page.evaluate(() =>
    checklistConfig.flatMap(g => g.items).filter(i => (i.visibleOn === 'all' || i.visibleOn === 'end') &&
      (i.photoRequired || String((i.meta[i.options[0]] || {}).requires || '').includes('фото'))).map(i => i.id));
  for (const id of needPhotoEnd) {
    await page.setInputFiles(`#end-${id} .photo-input`, { name: 'p.jpg', mimeType: 'image/jpeg', buffer: JPEG });
    await page.waitForTimeout(250);
  }
  t('увечері фото вимагають 5 пунктів', needPhotoEnd.length === 5 && needPhotoEnd.includes('10-1'));
  await page.click('#mainSubmitBtn'); await page.waitForTimeout(400);
  t('прев\'ю: усе заповнено', (await page.locator('#modalMessage').textContent()).includes('коректно'));
  await page.click('#submitReportBtn'); await page.waitForTimeout(1800); await closeDlg();
  const gotEnd = (await (await fetch(BASE + '/received')).json()).find(r => r.stage === 'Кінець зміни');
  t('звіт кінця зміни дійшов із текстом передачі',
    gotEnd && gotEnd.items.find(i => i.item_id === 'mech.10-7').value === 'Насос №2 гуде — подивитись зранку');
  t('  і з текстом заявки', gotEnd.items.find(i => i.item_id === 'mech.10-5').comment === 'Сальник насоса ХВО, 2 шт');
  // наступна зміна відкриває застосунок — під 0-2 має бути вчорашня передача
  await page.reload(); await page.waitForTimeout(1500);
  t('наступний вхід бачить передачу під 0-2',
    (await page.locator('#start-0-2 .handover-text').textContent()).includes('Насос №2 гуде'));

  console.log('\n── звільнення діє негайно ──');
  await fetch(BASE + '/fire/EMP-0007');
  await page.reload(); await page.waitForTimeout(1200);
  t('сесію звільненого закрито', await shown());

  console.log('\n── вихід ──');
  await fetch(BASE + '/reset');
  await page.fill('#authPin', '3773'); await page.click('#authLoginBtn'); await page.waitForTimeout(700);
  t('інший механік заходить', (await page.locator('#employeeSelect').inputValue()).includes('Сабадаш'));
  await page.click('#logoutBtn'); await page.waitForTimeout(300);
  await page.locator('#customDialogButtons button').last().click();
  await page.waitForTimeout(1200);
  t('після виходу знову просить PIN', await shown());

  if (errors.length) { console.log('\n⚠️ помилки JS:'); errors.forEach(e => console.log('   ' + e)); fails += errors.length; }
  await browser.close();
  console.log('\n' + (fails ? '❌ ПОМИЛОК: ' + fails : '✅ Усі перевірки пройдено'));
  process.exit(fails ? 1 : 0);
})();

const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8731/app';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwc' +
  'KDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAA' +
  'AAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
let fails = 0;
const t = (n, c) => { console.log((c ? '  ✅ ' : '  ❌ ') + n); if (!c) fails++; };

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await (await browser.newContext()).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  const shown = () => page.locator('#authOverlay').evaluate(e => !e.classList.contains('hidden'));
  const err = () => page.locator('#authError').textContent();
  const dialogText = () => page.locator('#customDialogMessage').textContent();
  const dialogOpen = () => page.locator('#customDialogOverlay').evaluate(e => !e.classList.contains('hidden'));
  const closeDialog = async () => {
    if (await dialogOpen()) { await page.locator('#customDialogButtons button').last().click(); await page.waitForTimeout(200); }
  };

  console.log('\n── екран входу ──');
  await page.goto(URL);
  await page.waitForTimeout(700);
  t('без сесії показано вхід', await shown());

  await page.fill('#authPin', '0000'); await page.click('#authLoginBtn'); await page.waitForTimeout(400);
  t('невірний PIN → повідомлення', (await err()).includes('Невірний PIN'));
  t('поле очищено', (await page.inputValue('#authPin')) === '');
  t('оверлей лишається', await shown());

  console.log('\n── роль без права на цей чек-лист ──');
  await page.fill('#authPin', '8294'); await page.click('#authLoginBtn'); await page.waitForTimeout(400);
  t('майстра не пускає', (await err()).includes('не дає доступу'));
  t('оверлей лишається', await shown());

  console.log('\n── тимчасовий PIN ──');
  await page.fill('#authPin', '7229'); await page.click('#authLoginBtn'); await page.waitForTimeout(500);
  t('одразу просить новий PIN', await page.locator('#authChangePane').isVisible());
  t('скасувати не можна', await page.locator('#authChangeCancel').isHidden());
  t('поточний PIN підставлено', (await page.inputValue('#authOldPin')) === '7229');

  await page.fill('#authNewPin', '4821'); await page.fill('#authNewPin2', '4822');
  await page.click('#authChangeBtn'); await page.waitForTimeout(300);
  t('різні повтори → відмова', (await err()).includes('двічі по-різному'));
  await page.fill('#authNewPin', '111'); await page.fill('#authNewPin2', '111');
  await page.click('#authChangeBtn'); await page.waitForTimeout(300);
  t('надто короткий → відмова', (await err()).includes('від 4 до 6'));
  await page.fill('#authNewPin', '1111'); await page.fill('#authNewPin2', '1111');
  await page.click('#authChangeBtn'); await page.waitForTimeout(500);
  t('слабкий → відмова сервера', (await err()).includes('надто прост'));

  await page.fill('#authNewPin', '4821'); await page.fill('#authNewPin2', '4821');
  await page.click('#authChangeBtn'); await page.waitForTimeout(600);
  t('підтвердження зміни', (await dialogText()).includes('PIN змінено'));
  await closeDialog();
  t('оверлей закрито', !(await shown()));

  console.log('\n── застосунок після входу ──');
  const sel = page.locator('#employeeSelect');
  t('прізвище з входу', (await sel.inputValue()) === 'Гора Андрій Олександрович');
  t('список заблоковано', await sel.isDisabled());
  t('лише один варіант', (await sel.locator('option').count()) === 1);
  t('є «Змінити PIN» і «Вийти»',
    await page.locator('#changePinBtn').isVisible() && await page.locator('#logoutBtn').isVisible());

  console.log('\n── нові типи пунктів ──');
  const it34 = page.locator('#start-3-4'), it51 = page.locator('#start-5-1');
  t('3-4 став кнопковим', (await it34.getAttribute('data-type')) === 'binary');
  t('  варіанти правильні',
    (await it34.locator('.option-btn').allTextContents()).join('|') === 'Помилок немає|Є помилка');
  t('5-1 має три поля', (await it51.getAttribute('data-type')) === 'triple_input'
    && (await it51.locator('[data-input-1],[data-input-2],[data-input-3]').count()) === 3);

  console.log('\n── заповнення ──');
  await page.evaluate(() => {
    document.querySelectorAll('#startShiftSection .checklist-item').forEach(el => {
      if (el.dataset.type === 'binary') el.querySelector('.option-btn').click();
      else el.querySelectorAll('input[type=text]').forEach((i, k) => {
        i.value = String(20 + k); i.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });
  });
  const needPhoto = await page.evaluate(() =>
    checklistConfig.flatMap(g => g.items).filter(i => i.photoRequired &&
      (i.visibleOn === 'all' || i.visibleOn === 'start')).map(i => i.id));
  console.log('   пунктів з обов\'язковим фото: ' + needPhoto.join(', '));
  for (const id of needPhoto) {
    await page.setInputFiles(`#start-${id} .photo-input`, { name: 'p.jpg', mimeType: 'image/jpeg', buffer: JPEG });
    await page.waitForTimeout(250);
  }
  t('усі фото прикріплено',
    (await page.locator('#startShiftSection .photo-btn.has-photo').count()) === needPhoto.length);
  t('індикатор обробки згас', !(await page.locator('#currentStatus').textContent()).includes('Обробка'));
  t('усі пункти заповнено', (await page.locator('#currentStatus').textContent()).includes('Залишилось завдань: 0'));

  console.log('\n── збереження стану між перезавантаженнями ──');
  await page.reload(); await page.waitForTimeout(900);
  t('вхід не питають удруге', !(await shown()));
  t('прізвище збереглося', (await page.locator('#employeeSelect').inputValue()) === 'Гора Андрій Олександрович');
  t('відповіді 5-1 відновлено',
    (await page.locator('#start-5-1 [data-input-3]').inputValue()) === '22');
  t('фото НЕ переживає перезавантаження (відомо, у планах IndexedDB)',
    (await page.locator('#startShiftSection .photo-btn.has-photo').count()) === 0);

  console.log('\n── відправка ──');
  for (const id of needPhoto) {
    await page.setInputFiles(`#start-${id} .photo-input`, { name: 'p.jpg', mimeType: 'image/jpeg', buffer: JPEG });
    await page.waitForTimeout(250);
  }
  await page.click('#mainSubmitBtn'); await page.waitForTimeout(400);
  t('прев\'ю каже, що все заповнено', (await page.locator('#modalMessage').textContent()).includes('коректно'));
  await page.click('#submitReportBtn');
  await page.waitForTimeout(1800);
  t('повідомлення про успіх', (await dialogText()).includes('успішно відправлено'));
  await closeDialog();
  const nStart = await page.locator('#startShiftSection .checklist-item').count();
  t('форму очищено після ok', (await page.locator('#currentStatus').textContent()).includes('Залишилось завдань: ' + nStart));

  const got = await (await fetch('http://127.0.0.1:8731/received')).json();
  t('сервер отримав рівно один звіт', got.length === 1);
  const p = got[0];
  console.log('   report_id: ' + p.report_id + ' · business_date: ' + p.business_date + ' · пунктів: ' + p.items.length);
  const liveToken = await page.evaluate(() => session && session.token);
  t('токен доданий і збігається з поточною сесією', !!p.token && p.token === liveToken);
  t('роль і стадія', p.role === 'Механік' && p.stage === 'Початок зміни');
  t('автор із сесії', p.user_id === 'U-003' && p.user_name === 'Гора Андрій Олександрович');
  t('report_id за київською датою',
    new RegExp('^' + new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv' }).format(new Date()) + '_mech_start_[0-9a-f]{6}$').test(p.report_id));
  t('усі пункти з item_id', p.items.every(i => /^mech\./.test(i.item_id)));
  t('тексту пунктів більше не шлемо', p.items.every(i => i.text === undefined));
  const i51 = p.items.find(i => i.item_id === 'mech.5-1');
  t('5-1 надіслав три числа за позиціями', JSON.stringify(i51.values) === '["20","21","22"]');
  const i11 = p.items.find(i => i.item_id === 'mech.1-1');
  t('1-1 надіслав два числа', JSON.stringify(i11.values) === '["20","21"]');
  const i34 = p.items.find(i => i.item_id === 'mech.3-4');
  t('3-4 надіслав варіант із довідника', i34.value === 'Помилок немає' && i34.values.length === 0);
  const i72 = p.items.find(i => i.item_id === 'mech.7-2');
  t('7-2 (одне число) надіслав values', JSON.stringify(i72.values) === '["20"]');
  const i52 = p.items.find(i => i.item_id === 'mech.5-2');
  t('5-2 (текст) values порожній', i52.values.length === 0);
  t('фото додані', p.items.filter(i => i.photoData).length === needPhoto.length);
  t('фото як base64 jpeg', p.items.filter(i => i.photoData).every(i => i.photoData.startsWith('data:image/jpeg;base64,')));

  console.log('\n── вихід ──');
  await page.click('#logoutBtn'); await page.waitForTimeout(300);
  await page.locator('#customDialogButtons button').last().click();   // [Скасувати, Підтвердити]
  await page.waitForTimeout(1200);
  t('після виходу знову просить PIN', await shown());

  if (errors.length) { console.log('\n⚠️ помилки JS на сторінці:'); errors.forEach(e => console.log('   ' + e)); fails += errors.length; }
  await browser.close();
  console.log('\n' + (fails ? '❌ ПОМИЛОК: ' + fails : '✅ Усі перевірки пройдено'));
  process.exit(fails ? 1 : 0);
})();

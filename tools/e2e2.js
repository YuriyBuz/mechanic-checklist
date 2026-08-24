/* Втрата зв'язку, черга, офлайн-вхід, відмови сервера.
   Головне питання: чи може звіт зникнути безслідно або подвоїтися. */
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
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));

  const shown = () => page.locator('#authOverlay').evaluate(e => !e.classList.contains('hidden'));
  const dlgOpen = () => page.locator('#customDialogOverlay').evaluate(e => !e.classList.contains('hidden'));
  const dlgText = () => page.locator('#customDialogMessage').textContent();
  const closeDlg = async () => { if (await dlgOpen()) {
    await page.locator('#customDialogButtons button').last().click(); await page.waitForTimeout(200); } };
  const left = () => page.locator('#currentStatus').textContent();
  const queueLen = () => page.evaluate(() =>
    JSON.parse(localStorage.getItem('offlineReportsQueue') || '[]').length);
  const fill = async () => {
    await page.evaluate(() => {
      document.querySelectorAll('#startShiftSection .checklist-item').forEach(el => {
        if (el.dataset.type === 'binary') el.querySelector('.option-btn').click();
        else el.querySelectorAll('input[type=text]').forEach((i, k) => {
          i.value = String(30 + k); i.dispatchEvent(new Event('input', { bubbles: true }));
        });
      });
    });
    for (const id of ['3-4', '5-2', '7-2']) {
      await page.setInputFiles(`#start-${id} .photo-input`, { name: 'p.jpg', mimeType: 'image/jpeg', buffer: JPEG });
      await page.waitForTimeout(250);
    }
  };
  const send = async () => {
    await page.click('#mainSubmitBtn'); await page.waitForTimeout(300);
    await page.click('#submitReportBtn'); await page.waitForTimeout(1700);
  };

  console.log('\n── вхід онлайн ──');
  await page.goto(BASE + '/app'); await page.waitForTimeout(700);
  await page.fill('#authPin', '2468'); await page.click('#authLoginBtn'); await page.waitForTimeout(900);
  t('увійшли', (await page.locator('#employeeSelect').inputValue()).includes('Гора'));

  console.log('\n── зв\'язок зник посеред зміни ──');
  await fill();
  t('усе заповнено', (await left()).includes(': 0'));
  await ctx.setOffline(true);
  await send();
  t('сказали, що звіт збережено локально', (await dlgText()).includes('збережено'));
  await closeDlg();
  t('звіт у черзі', (await queueLen()) === 1);
  t('форму очищено', !(await left()).includes(': 0'));
  t('на сервер нічого не пішло', (await (await fetch(BASE + '/received')).json()).length === 0);

  console.log('\n── зв\'язок повернувся ──');
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(2200); await closeDlg();
  t('черга спорожніла', (await queueLen()) === 0);
  const got1 = await (await fetch(BASE + '/received')).json();
  t('сервер отримав рівно один звіт', got1.length === 1);
  t('фото доїхали', got1[0].items.filter(i => i.photoData).length === 3);

  console.log('\n── вхід без мережі (локальний перевірник) ──');
  await fetch(BASE + '/reset');
  // сторінка без service worker, тому перезавантажитися офлайн вона не може:
  // імітуємо саме те, що бачить механік — сесія скінчилася, зв'язку немає
  await ctx.setOffline(true);
  await page.evaluate(() => { dropSession(); requireLogin(); });
  await page.waitForTimeout(400);
  t('без сесії просить PIN', await shown());

  await page.fill('#authPin', '0000'); await page.click('#authLoginBtn'); await page.waitForTimeout(1500);
  t('чужий PIN офлайн теж не підходить', await shown());

  await page.fill('#authPin', '2468'); await page.click('#authLoginBtn'); await page.waitForTimeout(2500);
  await closeDlg();
  t('свій PIN відкриває застосунок офлайн', !(await shown()));
  t('видно, що це офлайн-режим',
    (await page.locator('#employeeSelect option').first().textContent()).includes('офлайн'));

  await fill();
  await send(); await closeDlg();
  t('звіт із офлайн-сесії лягає в чергу', (await queueLen()) === 1);
  t('на сервер нічого не пішло', (await (await fetch(BASE + '/received')).json()).length === 0);

  console.log('\n── повернулися онлайн: черга чекає на справжній вхід ──');
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(2200);
  t('звіт із черги не викинуто', (await queueLen()) === 1);
  t('застосунок просить увійти', await shown());

  await page.fill('#authPin', '2468'); await page.click('#authLoginBtn'); await page.waitForTimeout(1200);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(2200); await closeDlg();
  t('після входу черга пішла', (await queueLen()) === 0);
  t('сервер отримав звіт', (await (await fetch(BASE + '/received')).json()).length === 1);

  console.log('\n── чужий звіт у черзі ──');
  // ctx.setOffline(false) сам піднімає подію online і черга йде одразу, тому
  // сценарій «інша людина на тому ж телефоні» складаємо детерміновано:
  // кладемо в чергу звіт Гори і входимо Сабадашем
  await fetch(BASE + '/reset');
  await fill();
  const foreign = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv' }).format(new Date()) +
                  '_mech_start_aa11bb';
  await page.evaluate((rid) => {
    localStorage.setItem('offlineReportsQueue', JSON.stringify([{
      action: 'submit', report_id: rid, business_date: rid.split('_')[0],
      stage: 'Початок зміни', role: 'Механік', config_version: 'test', app_version: 'test',
      summary: 'Виконано 1 з 1', _author: 'U-003',          // Гора
      items: [{ item_id: 'mech.1-1', value: '20 / 21', values: ['20', '21'], comment: '', photoData: null }]
    }]));
  }, foreign);
  await page.evaluate(() => { dropSession(); requireLogin(); });
  await page.waitForTimeout(300);
  await page.fill('#authPin', '3773'); await page.click('#authLoginBtn'); await page.waitForTimeout(1200);
  await closeDlg();
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(2000);
  t('чужий звіт не відправлено', (await queueLen()) === 1);
  t('на сервер нічого не пішло', (await (await fetch(BASE + '/received')).json()).length === 0);
  t('сказано, чий він і що робити', (await dlgText()).includes('іншим працівником'));
  await closeDlg();

  await page.evaluate(() => { dropSession(); requireLogin(); });
  await page.waitForTimeout(300);
  await page.fill('#authPin', '2468'); await page.click('#authLoginBtn'); await page.waitForTimeout(1200);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(2200); await closeDlg();
  t('автор увійшов — звіт пішов', (await queueLen()) === 0);
  const own = await (await fetch(BASE + '/received')).json();
  t('підписано автором, а не тим, хто заходив між тим',
    own.length === 1 && own[0]._author === 'Гора Андрій Олександрович' && own[0].report_id === foreign);
  t('локальна позначка на сервер не поїхала', own[0]._clientAuthor === null);

  console.log('\n── сервер відмовив: сесія протухла ──');
  await fetch(BASE + '/reset');
  await fill();
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('checklistSessionV1'));
    s.token = 'ЗІПСОВАНИЙ'; localStorage.setItem('checklistSessionV1', JSON.stringify(s));
    session.token = 'ЗІПСОВАНИЙ';
  });
  await send();
  t('показано помилку сервера', (await page.locator('#submitStatus').textContent()).includes('Сесію завершено'));
  await closeDlg(); await page.waitForTimeout(400);
  t('форму НЕ очищено — дані на місці', (await left()).includes(': 0'));
  t('у чергу теж не поклали', (await queueLen()) === 0);
  t('знову просять PIN', await shown());

  await page.fill('#authPin', '2468'); await page.click('#authLoginBtn'); await page.waitForTimeout(1000);
  t('після повторного входу дані все ще у формі', (await left()).includes(': 0'));
  await send(); await closeDlg();
  t('звіт нарешті прийнято', (await (await fetch(BASE + '/received')).json()).length === 1);
  t('форму очищено вже після успіху', !(await left()).includes(': 0'));

  if (errors.length) { console.log('\n⚠️ помилки JS:'); errors.forEach(e => console.log('   ' + e)); fails += errors.length; }
  await browser.close();
  console.log('\n' + (fails ? '❌ ПОМИЛОК: ' + fails : '✅ Усі перевірки пройдено'));
  process.exit(fails ? 1 : 0);
})();

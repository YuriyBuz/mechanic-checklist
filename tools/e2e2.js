/* Друга частина: втрата зв'язку, черга, відмова сервера. Головне питання —
   чи може звіт зникнути безслідно і чи може подвоїтися. */
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8731';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let fails = 0;
const t = (n, c) => { console.log((c ? '  ✅ ' : '  ❌ ') + n); if (!c) fails++; };

(async () => {
  await fetch(BASE + '/reset');
  const browser = await chromium.launch({ executablePath: EXE });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));

  const dlgOpen = () => page.locator('#customDialogOverlay').evaluate(e => !e.classList.contains('hidden'));
  const dlgText = () => page.locator('#customDialogMessage').textContent();
  const closeDlg = async () => { if (await dlgOpen()) { await page.locator('#customDialogButtons button').last().click(); await page.waitForTimeout(200); } };
  const fill = async () => {
    await page.evaluate(() => {
      document.querySelectorAll('#startShiftSection .checklist-item').forEach(el => {
        if (el.dataset.type === 'binary') el.querySelector('.option-btn').click();
        else el.querySelectorAll('input[type=text]').forEach((i, k) => {
          i.value = String(30 + k); i.dispatchEvent(new Event('input', { bubbles: true }));
        });
      });
    });
    const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
    for (const id of ['3-4', '5-2', '7-2']) {
      await page.setInputFiles(`#start-${id} .photo-input`, { name: 'p.jpg', mimeType: 'image/jpeg', buffer: JPEG });
      await page.waitForTimeout(250);
    }
  };
  const left = async () => (await page.locator('#currentStatus').textContent());
  const queueLen = () => page.evaluate(() => JSON.parse(localStorage.getItem('offlineReportsQueue') || '[]').length);

  console.log('\n── вхід ──');
  await page.goto(BASE + '/app'); await page.waitForTimeout(700);
  await page.fill('#authPin', '4821'); await page.click('#authLoginBtn'); await page.waitForTimeout(600);
  t('увійшли без вимоги міняти PIN', (await page.locator('#employeeSelect').inputValue()).includes('Гора'));

  console.log('\n── зв\'язок зник посеред зміни ──');
  await fill();
  t('усе заповнено', (await left()).includes(': 0'));
  await ctx.setOffline(true);
  await page.click('#mainSubmitBtn'); await page.waitForTimeout(300);
  await page.click('#submitReportBtn'); await page.waitForTimeout(1600);
  t('сказали, що звіт збережено локально', (await dlgText()).includes('збережено'));
  await closeDlg();
  t('звіт у черзі', (await queueLen()) === 1);
  t('форму очищено', (await left()).includes(': 38'));
  t('на сервер нічого не пішло', (await (await fetch(BASE + '/received')).json()).length === 0);

  console.log('\n── зв\'язок повернувся ──');
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(2000);
  await closeDlg();
  t('черга спорожніла', (await queueLen()) === 0);
  const got1 = await (await fetch(BASE + '/received')).json();
  t('сервер отримав рівно один звіт', got1.length === 1);
  t('фото доїхали', got1[0].items.filter(i => i.photoData).length === 3);

  console.log('\n── повторна відправка тієї самої черги не дублює ──');
  await page.evaluate(r => localStorage.setItem('offlineReportsQueue', JSON.stringify([r])),
    Object.assign({}, got1[0], { token: undefined }));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(1800); await closeDlg();
  const got2 = await (await fetch(BASE + '/received')).json();
  t('report_id той самий у обох спробах', got2.every(r => r.report_id === got1[0].report_id));
  console.log('   (сервер-заглушка приймає повтор; справжній Code.gs відкидає його за report_id — це перевірено у run_auth.js)');

  console.log('\n── сервер відмовив: сесія протухла ──');
  await fetch(BASE + '/reset');
  await fill();
  await page.evaluate(() => { session.token = 'ЗІПСОВАНИЙ'; });
  await page.click('#mainSubmitBtn'); await page.waitForTimeout(300);
  await page.click('#submitReportBtn'); await page.waitForTimeout(1200);
  t('показано помилку сервера', (await page.locator('#submitStatus').textContent()).includes('Потрібен вхід'));
  await closeDlg();
  await page.waitForTimeout(500);
  t('форму НЕ очищено — дані на місці', (await left()).includes(': 0'));
  t('у чергу теж не поклали', (await queueLen()) === 0);
  t('знову просять PIN', await page.locator('#authOverlay').evaluate(e => !e.classList.contains('hidden')));

  await page.fill('#authPin', '4821'); await page.click('#authLoginBtn'); await page.waitForTimeout(800);
  t('після повторного входу дані все ще у формі', (await left()).includes(': 0'));
  await page.click('#mainSubmitBtn'); await page.waitForTimeout(300);
  await page.click('#submitReportBtn'); await page.waitForTimeout(1600); await closeDlg();
  t('звіт нарешті прийнято', (await (await fetch(BASE + '/received')).json()).length === 1);
  t('форму очищено вже після успіху', (await left()).includes(': 38'));

  if (errors.length) { console.log('\n⚠️ помилки JS:'); errors.forEach(e => console.log('   ' + e)); fails += errors.length; }
  await browser.close();
  console.log('\n' + (fails ? '❌ ПОМИЛОК: ' + fails : '✅ Усі перевірки пройдено'));
  process.exit(fails ? 1 : 0);
})();

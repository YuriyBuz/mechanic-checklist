/* Перерви під час заповнення: чи переживають їх ФОТО, а не лише відповіді.
   Механіки скаржаться, що фото «злітають» посеред чек-листа. Тут відтворено
   все, що буває з планшетом у цеху:
     · браузер вивантажив сторінку, поки була відкрита камера (Android так
       робить, коли бракує пам'яті) — для сторінки це те саме, що перезавантаження;
     · планшет вимкнули або закрили браузер і відкрили знову;
     · вкладку «заморозили» у фоні й розморозили;
     · зв'язок зник посеред заповнення; сервер упав або обірвав відповідь;
     · 10 хвилин бездіяльності → автовихід → вхід знову;
     · справжні фото з камери 12 Мп; кілька звітів у черзі офлайн.
   Кожна перевірка каже, що МАЄ бути; ❌ означає, що механік втрачає дані. */
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8731';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let fails = 0;
const t = (n, c) => { console.log((c ? '  ✅ ' : '  ❌ ') + n); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await fetch(BASE + '/reset');
  const browser = await chromium.launch({ executablePath: EXE });
  const ctx = await browser.newContext();
  let page = await ctx.newPage();
  const errors = [];
  const watch = p => p.on('pageerror', e => errors.push(e.message));
  watch(page);

  // ── допоміжне ──
  const shown = () => page.locator('#authOverlay').evaluate(e => !e.classList.contains('hidden'));
  const dlgOpen = () => page.locator('#customDialogOverlay').evaluate(e => !e.classList.contains('hidden'));
  const dlgText = () => page.locator('#customDialogMessage').textContent();
  const closeDlg = async () => { while (await dlgOpen()) {
    await page.locator('#customDialogButtons button').last().click(); await sleep(200); } };
  const login = async (pin) => {
    if (!(await shown())) return;
    await page.fill('#authPin', pin || '2468'); await page.click('#authLoginBtn'); await sleep(1000); await closeDlg();
  };
  const open = async () => { await page.goto(BASE + '/app'); await sleep(800); await login(); };
  const thumbs = id => page.locator(`#start-${id} .photo-thumbs .photo-thumbnail`).count();
  const photoCount = () => page.evaluate(() =>
    Array.from(document.querySelectorAll('#startShiftSection .photo-thumbs .photo-thumbnail')).length);
  const answered = () => page.locator('#startShiftSection .checklist-item.completed').count();
  const queue = () => page.evaluate(() => JSON.parse(localStorage.getItem('offlineReportsQueue') || '[]'));
  const queuePhotos = q => q.reduce((n, r) => n + r.items.reduce((m, i) => m + (i.photos || []).length, 0), 0);

  // Справжній знімок камери: 4000×3000, JPEG 92% — як із планшета
  const cameraJpeg = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 4000; c.height = 3000;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 4000, 3000); g.addColorStop(0, '#2b3a4a'); g.addColorStop(1, '#c9b8a5');
    x.fillStyle = g; x.fillRect(0, 0, 4000, 3000);
    for (let i = 0; i < 2500; i++) {
      x.fillStyle = `hsl(${Math.random() * 360},35%,${25 + Math.random() * 50}%)`;
      x.fillRect(Math.random() * 4000, Math.random() * 3000, 40 + Math.random() * 300, 40 + Math.random() * 300);
    }
    const b = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
    const u = new Uint8Array(await b.arrayBuffer()); let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  });
  const JPEG = Buffer.from(cameraJpeg, 'base64');
  const shoot = async (id, n) => {
    for (let k = 0; k < (n || 1); k++) {
      await page.setInputFiles(`#start-${id} .photo-input`, { name: 'IMG_' + id + '_' + k + '.jpg', mimeType: 'image/jpeg', buffer: JPEG });
      await page.waitForFunction(() => !/Обробка/.test(document.getElementById('currentStatus').textContent), null, { timeout: 15000 });
    }
  };
  const answerSome = async () => page.evaluate(() => {
    ['start-0-2', 'start-7-13', 'start-6-1', 'start-5-4', 'start-1-2'].forEach(id => {
      const el = document.getElementById(id); if (el) el.querySelector('.option-btn').click();
    });
    const set = (id, vals) => { const el = document.getElementById(id);
      el.querySelectorAll('input[type=text]').forEach((i, k) => { i.value = vals[k]; i.dispatchEvent(new Event('input', { bubbles: true })); }); };
    set('start-7-14', ['3.8', '3.7']); set('start-1-1', ['48', '75']);
    document.getElementById('start-0-1').querySelector('.option-btn').click();   // «Отримав» — фото бланка
  });
  const fillAll = async () => {
    await page.evaluate(() => {
      document.querySelectorAll('#startShiftSection .checklist-item').forEach(el => {
        if (el.classList.contains('completed')) return;
        if (el.dataset.type === 'binary') el.querySelector('.option-btn').click();
        else el.querySelectorAll('input[type=text]').forEach((i, k) => { i.value = String(3 + k);
          i.dispatchEvent(new Event('input', { bubbles: true })); });
      });
    });
    await closeDlg();
  };
  const NEED = ['0-1', '7-14', '7-2', '5-2', '8-2', '3-4'];
  const shootRequired = async () => { for (const id of NEED) if (!(await thumbs(id))) await shoot(id); };
  const send = async () => {
    await page.click('#mainSubmitBtn'); await sleep(300);
    await page.click('#submitReportBtn');
  };

  // Кожен сценарій починається з чистого аркуша, щоб збій одного не тягнув інші
  const fresh = async () => {
    await fetch(BASE + '/reset');
    await page.evaluate(() => { localStorage.removeItem('shiftChecklistState_v3'); localStorage.removeItem('offlineReportsQueue'); });
    // фото з IndexedDB теж прибираємо — інакше вони переходять у наступний сценарій
    await page.evaluate(() => new Promise(r => {
      const q = indexedDB.open('checklistPhotosV1', 1);
      q.onupgradeneeded = () => q.result.createObjectStore('photos');
      q.onsuccess = () => { const t = q.result.transaction('photos', 'readwrite'); t.objectStore('photos').clear();
        t.oncomplete = () => { q.result.close(); r(); }; t.onerror = () => r(); };
      q.onerror = () => r();
    }));
    await page.reload(); await sleep(900); await login();
  };
  const setup = async () => {          // 8 відповідей і 4 фото на трьох пунктах
    await answerSome(); await shoot('7-14', 2); await shoot('0-1'); await shoot('5-2');
    return { photos: await photoCount(), answered: await answered() };
  };
  const payloadPhotos = r => r.items.reduce((n, i) => n + (i.photos || []).length, 0);

  console.log('\n── 0. Фото з камери 12 Мп ──');
  console.log('   розмір знімка: ' + Math.round(JPEG.length / 1024) + ' КБ');
  await open();
  const t0 = Date.now(); await shoot('7-14'); const ms = Date.now() - t0;
  const dataLen = await page.evaluate(() => document.querySelector('#start-7-14 .photo-thumbnail').src.length);
  console.log('   обробка: ' + ms + ' мс, після стиснення: ' + Math.round(dataLen / 1024) + ' КБ тексту');
  t('знімок стиснувся й показаний мініатюрою', (await thumbs('7-14')) === 1);

  console.log('\n── 1. Вкладку «заморозили» у фоні (екран погас ненадовго) ──');
  await fresh(); let b = await setup();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' }); await sleep(500);
  await cdp.send('Page.setWebLifecycleState', { state: 'active' }); await sleep(300);
  t('після розморожування фото й відповіді на місці', (await photoCount()) === b.photos && (await answered()) === b.answered);

  console.log('\n── 2. Заглянули на «Кінець зміни» і повернулися ──');
  await fresh(); b = await setup();
  await page.click('#endShiftBtn'); await sleep(300); await page.click('#startShiftBtn'); await sleep(300);
  let a = { photos: await photoCount(), answered: await answered() };
  console.log('   було: відповідей ' + b.answered + ', фото ' + b.photos + ' → стало: відповідей ' + a.answered + ', фото ' + a.photos);
  t('відповіді на місці', a.answered === b.answered);
  t('мініатюри фото на місці', a.photos === b.photos);
  // а тепер на «Кінці зміни» щось відмітили — і повернулися
  await fresh(); b = await setup();
  await page.click('#endShiftBtn'); await sleep(300);
  await page.evaluate(() => document.querySelector('#endShiftSection .checklist-item[data-type=binary] .option-btn').click());
  await page.click('#startShiftBtn'); await sleep(300);
  const kept = await page.evaluate(() => Object.keys((JSON.parse(localStorage.getItem('shiftChecklistState_v3')) || {}).checklist || {})
    .filter(k => k.startsWith('start-')).length);
  t('відмітка на «Кінці зміни» не стирає збережений «Початок»', kept > 0);
  // наслідок: фото лишились у пам'яті, але їх не видно — механік знімає знову і впирається в ліміт
  await fresh(); await answerSome(); await shoot('7-14', 3);
  await page.click('#endShiftBtn'); await sleep(300); await page.click('#startShiftBtn'); await sleep(300);
  await page.setInputFiles('#start-7-14 .photo-input', { name: 'again.jpg', mimeType: 'image/jpeg', buffer: JPEG });
  await sleep(1500);
  const capMsg = (await dlgOpen()) ? await dlgText() : '';
  console.log('   на екрані фото 7-14: ' + (await thumbs('7-14')) + (capMsg ? '; застосунок: «' + capMsg.split('.')[0] + '»' : ''));
  t('ліміт «не більше 3 фото» спрацьовує лише тоді, коли всі 3 видно на екрані',
    !/не більше/.test(capMsg) || (await thumbs('7-14')) === 3);
  await closeDlg();

  console.log('\n── 3. Зв\'язок зник посеред заповнення, фото знято офлайн ──');
  await fresh(); b = await setup();
  await ctx.setOffline(true); await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await shoot('8-2');
  await ctx.setOffline(false); await page.evaluate(() => window.dispatchEvent(new Event('online'))); await sleep(500);
  t('після повернення зв\'язку всі фото на місці', (await photoCount()) === b.photos + 1);

  console.log('\n── 4. 10 хвилин бездіяльності → автовихід → вхід знову ──');
  await fresh(); b = await setup();
  await page.evaluate(() => {
    localStorage.setItem('checklistLastActivityV1', String(Date.now() - 11 * 60 * 1000));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await sleep(300);
  t('застосунок попросив PIN', await shown());
  await login(); await sleep(500);
  t('після повторного входу фото й відповіді на місці', (await photoCount()) === b.photos && (await answered()) === b.answered);

  console.log('\n── 5. Браузер вивантажив сторінку, поки була відкрита камера ──');
  // Android при нестачі пам'яті вбиває фонову вкладку; повернувшись із камери,
  // механік бачить ту саму сторінку, завантажену заново. Так само — свайп униз
  // («потягнути, щоб оновити») і перезапуск браузера.
  await fresh(); b = await setup();
  await page.reload(); await sleep(900); await login();
  a = { photos: await photoCount(), answered: await answered() };
  console.log('   було: відповідей ' + b.answered + ', фото ' + b.photos + ' → стало: відповідей ' + a.answered + ', фото ' + a.photos);
  t('відповіді пережили перезавантаження', a.answered === b.answered);
  t('ФОТО пережили перезавантаження', a.photos === b.photos);

  console.log('\n── 6. Планшет вимкнули / закрили браузер і відкрили знову ──');
  await fresh(); b = await setup();
  await page.close();
  page = await ctx.newPage(); watch(page); await open();
  a = { photos: await photoCount(), answered: await answered() };
  t('відповіді на місці', a.answered === b.answered);
  t('ФОТО на місці після повторного відкриття', a.photos === b.photos);

  console.log('\n── 7. Відправка: сервер упав (HTTP 500) ──');
  await fresh(); await fillAll(); await shootRequired();
  let p = await photoCount();
  await fetch(BASE + '/mode?http500');
  await send(); await sleep(1800); await closeDlg();
  let q = await queue();
  t('звіт ліг у чергу, а не пропав', q.length === 1);
  t('  разом з усіма фото (' + p + ')', q.length === 1 && queuePhotos(q) === p);
  await fetch(BASE + '/mode');
  await page.evaluate(() => window.dispatchEvent(new Event('online'))); await sleep(1500); await closeDlg();
  let got = await (await fetch(BASE + '/received')).json();
  t('сервер ожив — звіт дійшов із фото', got.length === 1 && payloadPhotos(got[0]) === p);

  console.log('\n── 8. Відправка: зв\'язок обірвався посеред запиту ──');
  await fresh(); await fillAll(); await shootRequired();
  p = await photoCount();
  await fetch(BASE + '/mode?drop');
  await send(); await sleep(1800); await closeDlg();
  q = await queue();
  t('звіт у черзі з усіма фото', q.length === 1 && queuePhotos(q) === p);
  await fetch(BASE + '/mode');
  await page.evaluate(() => window.dispatchEvent(new Event('online'))); await sleep(1500); await closeDlg();
  got = await (await fetch(BASE + '/received')).json();
  t('звіт дійшов, коли зв\'язок повернувся', got.length === 1 && payloadPhotos(got[0]) === p);

  console.log('\n── 9. Сервер прийняв звіт, а відповідь загубилась ──');
  await fresh(); await fillAll(); await shootRequired();
  await fetch(BASE + '/mode?lost');
  await send(); await sleep(1800); await closeDlg();
  await fetch(BASE + '/mode');
  await page.evaluate(() => window.dispatchEvent(new Event('online'))); await sleep(1500); await closeDlg();
  got = await (await fetch(BASE + '/received')).json();
  console.log('   на сервер дійшло: ' + got.map(r => r.report_id.slice(-6)).join(', '));
  t('звіт не загубився, а повтори йдуть з тим самим report_id — сервер їх відкине як дубль',
    got.length >= 2 && got.every(r => r.report_id === got[0].report_id) && (await queue()).length === 0);

  console.log('\n── 10. Повільний сервер (20 с), сторінку перезавантажили під час відправки ──');
  await fresh(); await fillAll(); await shootRequired();
  p = await photoCount(); const n10 = await answered();
  await fetch(BASE + '/mode?slow=20000');
  await send(); await sleep(1500);
  await page.reload(); await sleep(900); await login();
  // браузер обірвав запит на перезавантаженні — клієнт мав або лишити все у формі,
  // або покласти звіт у чергу; головне — щоб відповіді й фото не зникли
  const inForm = (await answered()) === n10 && (await photoCount()) === p;
  await sleep(21000); await closeDlg();
  got = await (await fetch(BASE + '/received')).json();
  console.log('   у формі після перезавантаження: ' + (inForm ? 'усе' : 'порожньо') +
              '; на сервер дійшло копій: ' + got.length + ', фото в них: ' + got.map(payloadPhotos).join(', '));
  t('звіт не загубився: або лишився у формі, або дійшов з усіма фото',
    inForm || (got.length >= 1 && got.every(r => payloadPhotos(r) === p)));
  t('  усі копії з одним report_id — сервер залишить одну', got.every(r => r.report_id === got[0].report_id));
  await fetch(BASE + '/mode');

  console.log('\n── 11. Кілька змін без зв\'язку: скільки звітів із фото вміщає черга ──');
  await fresh();
  await ctx.setOffline(true); await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  const quota = await page.evaluate(() => {
    const k = '__probe__'; let lo = 0, hi = 20 * 1024 * 1024;
    while (hi - lo > 64 * 1024) { const mid = (lo + hi) >> 1;
      try { localStorage.setItem(k, 'x'.repeat(mid)); lo = mid; } catch (e) { hi = mid; } }
    localStorage.removeItem(k);
    let used = 0; for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i);
      used += key.length + (localStorage.getItem(key) || '').length; }
    return { free: lo, used };
  });
  console.log('   localStorage: зайнято ' + Math.round(quota.used / 1024) + ' КБ, вільно ~' + Math.round(quota.free / 1024) + ' КБ');
  let queued = 0, refusedAt = 0;
  for (let n = 1; n <= 5; n++) {
    await fillAll();
    for (const id of NEED) { const have = await thumbs(id); if (have < 2) await shoot(id, 2 - have); }   // 12 фото на звіт
    await send(); await sleep(1500);
    const txt = (await dlgOpen()) ? await dlgText() : '';
    await closeDlg();
    if ((await queue()).length === n) queued = n; else { refusedAt = n; console.log('   звіт №' + n + ': ' + txt.split('\n')[0]); break; }
  }
  const qbytes = await page.evaluate(() => (localStorage.getItem('offlineReportsQueue') || '').length);
  console.log('   у черзі звітів: ' + queued + ' (' + Math.round(qbytes / 1024) + ' КБ)');
  t('у черзі вміщається щонайменше 3 звіти по 12 фото', queued >= 3);
  if (refusedAt) {
    t('коли місця бракує, форма НЕ очищена', (await photoCount()) === 12 && (await answered()) > 40);
    const errBefore = errors.length;
    await page.evaluate(() => { const b = document.querySelectorAll('#start-6-2 .option-btn'); b[b.length - 1].click(); });
    await sleep(300);
    t('при переповненому сховищі відмітки не падають з помилкою', errors.length === errBefore);
  }
  await ctx.setOffline(false); await page.evaluate(() => window.dispatchEvent(new Event('online'))); await sleep(3000); await closeDlg();
  got = await (await fetch(BASE + '/received')).json();
  t('зв\'язок повернувся — усі збережені звіти пішли', got.length === queued && (await queue()).length === 0);

  console.log('\n── 12. Свайп униз на планшеті («потягнути, щоб оновити») ──');
  const ptr = await page.evaluate(() => getComputedStyle(document.body).overscrollBehaviorY + '/' +
    getComputedStyle(document.documentElement).overscrollBehaviorY);
  console.log('   overscroll-behavior-y: ' + ptr);
  t('сторінка не перезавантажується від свайпу вниз', /contain|none/.test(ptr));

  if (errors.length) { console.log('\n⚠️ помилки JS:'); errors.forEach(e => console.log('   ' + e)); fails += errors.length; }
  await browser.close();
  console.log('\n' + (fails ? '❌ ПОМИЛОК: ' + fails : '✅ Усі перевірки пройдено'));
  process.exit(fails ? 1 : 0);
})();

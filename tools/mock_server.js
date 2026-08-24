/* Підробний Apps Script: віддає справжній index.html і відповідає як Code.gs.
   Потрібен, щоб ганяти клієнт у браузері без Google. */
const http = require('http'), fs = require('fs');
const PORT = 8731;
const SRC = __dirname + '/../index.html';

// кадрова таблиця в мініатюрі
const CAN = {
  mech:   { mech: true,  master: false, email: false },
  admin:  { mech: true,  master: true,  email: true  },
  master: { mech: false, master: true,  email: true  }
};
const PEOPLE = [
  { pin: '2468', id: 'EMP-0007', user_id: 'U-003', name: 'Гора Андрій Олександрович',
    roles: ['mech.use'], can: CAN.mech },
  { pin: '3773', id: 'EMP-0041', user_id: 'U-002', name: 'Сабадаш Геннадій Петрович',
    roles: ['mech.use'], can: CAN.mech },
  { pin: '8294', id: 'EMP-0032', user_id: 'U-006', name: 'Шута Олександра Сергіівна',
    roles: ['shift.master'], can: CAN.master },
  { pin: '9988', id: 'EMP-0062', user_id: 'U-000', name: 'Юрій Бузницький',
    roles: ['admin'], can: CAN.admin },
  // «1111» стоїть у двох — вхід має відхилятися для обох
  { pin: '1111', id: 'EMP-0006', user_id: 'U-005', name: 'Гончарук Ольга Михайлівна',
    roles: ['shift.master'], can: CAN.master },
  { pin: '1111', id: 'EMP-0018', user_id: '', name: 'Максімюк Анатолій Вікторович',
    roles: ['shift.master'], can: CAN.master }
];
const received = [];
let fired = {};                     // emp_id → звільнений посеред сесії

const tokenFor = (p, dev) => 'T.' + p.id + '.' + (dev || '');
const bySession = (token, dev) => {
  const parts = String(token || '').split('.');
  if (parts[0] !== 'T' || parts[2] !== (dev || '')) return null;
  if (fired[parts[1]]) return null;
  return PEOPLE.find(p => p.id === parts[1]) || null;
};
const pub = p => ({ user_id: p.user_id, name: p.name, short_name: p.name, roles: p.roles, can: p.can });

const srv = http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }

  if (req.method === 'GET' && req.url.startsWith('/app')) {
    const html = fs.readFileSync(SRC, 'utf8')
      .replace(/const GOOGLE_SCRIPT_URL = '[^']*'/, `const GOOGLE_SCRIPT_URL = 'http://127.0.0.1:${PORT}/exec'`)
      // Tailwind із CDN у пісочниці недоступний — підставляємо або зібраний CSS,
      // або мінімум, від якого залежить видимість елементів
      .replace('<style>', '<style>' + (process.env.TW_CSS
        ? fs.readFileSync(process.env.TW_CSS, 'utf8') : '.hidden{display:none}.flex{display:flex}'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }
  if (req.method === 'GET' && req.url.startsWith('/reset')) {
    received.length = 0; fired = {};
    res.writeHead(200, cors); return res.end('ok');
  }
  if (req.method === 'GET' && req.url.startsWith('/fire/')) {
    fired[req.url.split('/')[2]] = true;
    res.writeHead(200, cors); return res.end('ok');
  }
  if (req.method === 'GET' && req.url.startsWith('/received')) {
    res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, cors));
    return res.end(JSON.stringify(received));
  }

  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    let p = {}; try { p = JSON.parse(body); } catch (e) {}
    const json = o => { res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, cors));
                        res.end(JSON.stringify(o)); };
    const act = p.action || 'submit';

    if (act === 'login') {
      const hits = PEOPLE.filter(x => x.pin === String(p.pin || '').trim() && !fired[x.id]);
      if (!hits.length) return json({ ok: false, error: 'BAD_PIN', message: 'Невірний PIN' });
      if (hits.length > 1) return json({ ok: false, error: 'PIN_NOT_UNIQUE',
        message: 'Цей PIN закріплений за кількома працівниками. Зверніться до адміністратора, ' +
                 'щоб вам призначили власний PIN у кадровій таблиці.' });
      return json({ ok: true, token: tokenFor(hits[0], p.deviceId),
                    expires_at: Date.now() + 12 * 3600 * 1000, user: pub(hits[0]) });
    }
    if (act === 'whoami') {
      const u = bySession(p.token, p.deviceId);
      return u ? json({ ok: true, user: pub(u) })
               : json({ ok: false, error: 'AUTH', message: 'Сесію завершено. Увійдіть за PIN.' });
    }
    if (act === 'submit') {
      const u = bySession(p.token, p.deviceId);
      if (!u) return json({ ok: false, error: 'AUTH', message: 'Сесію завершено. Увійдіть за PIN.' });
      const need = p.role === 'Майстер' ? 'master' : 'mech';
      if (!u.can[need]) return json({ ok: false, error: 'FORBIDDEN',
        message: 'Ваша роль не дає права здавати цей чек-лист' });
      received.push(Object.assign({}, p, { _author: u.name }));
      return json({ ok: true, report_id: p.report_id, counts: { ok: p.items.length }, warnings: [] });
    }
    json({ ok: false, error: 'unknown action: ' + act });
  });
});
srv.listen(PORT, '127.0.0.1', () => console.log('mock on ' + PORT));

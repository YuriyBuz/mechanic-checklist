/* Підробний Apps Script: віддає index.html і відповідає як новий бекенд. */
const http = require('http'), fs = require('fs');
const PORT = 8731;
const SRC = '/home/user/mechanic-checklist/index.html';

const USERS = {
  '7229': { token: 'T-gora', user: { user_id: 'U-003', name: 'Гора Андрій Олександрович',
            position: 'Механік зміни', roles: 'mech.use', can: { mech: true, master: false, email: false } },
            must_change: true },
  '4821': { token: 'T-gora2', user: { user_id: 'U-003', name: 'Гора Андрій Олександрович',
            position: 'Механік зміни', roles: 'mech.use', can: { mech: true, master: false, email: false } },
            must_change: false },
  '8294': { token: 'T-shuta', user: { user_id: 'U-006', name: 'Шута Олександра Сергіівна',
            position: 'Майстер зміни', roles: 'shift.master', can: { mech: false, master: true, email: true } },
            must_change: false }
};
const BY_TOKEN = {}; Object.values(USERS).forEach(u => { BY_TOKEN[u.token] = u; });
const received = [];

const srv = http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }

  if (req.method === 'GET' && req.url.startsWith('/app')) {
    let html = fs.readFileSync(SRC, 'utf8')
      .replace(/const GOOGLE_SCRIPT_URL = '[^']*'/, `const GOOGLE_SCRIPT_URL = 'http://127.0.0.1:${PORT}/exec'`)
      // Tailwind із CDN у пісочниці недоступний — підміняємо тим мінімумом,
      // від якого залежить видимість елементів у тестах
      .replace('<style>', '<style>' + (process.env.TW_CSS ? require('fs').readFileSync(process.env.TW_CSS, 'utf8') : '.hidden{display:none}.flex{display:flex}'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }
  if (req.method === 'GET' && req.url.startsWith('/reset')) {
    received.length = 0;
    USERS['7229'].must_change = true;
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
      const u = USERS[String(p.pin || '').trim()];
      if (!u) return json({ ok: false, error: 'bad_pin', message: 'Невірний PIN' });
      return json({ ok: true, token: u.token, must_change: u.must_change, user: u.user });
    }
    if (act === 'whoami') {
      const u = BY_TOKEN[p.token];
      if (!u) return json({ ok: false, error: 'no_session' });
      return json({ ok: true, must_change: u.must_change, user: u.user });
    }
    if (act === 'changePin') {
      const u = BY_TOKEN[p.token];
      if (!u) return json({ ok: false, error: 'no_session', message: 'Сесія застаріла' });
      if (!/^\d{4,6}$/.test(String(p.new_pin))) return json({ ok: false, error: 'bad_new_pin', message: 'PIN — від 4 до 6 цифр' });
      if (String(p.new_pin) === '1111') return json({ ok: false, error: 'weak_pin', message: 'Такий PIN надто простий, оберіть інший' });
      u.must_change = false;
      return json({ ok: true, token: u.token, message: 'PIN змінено' });
    }
    if (act === 'submit') {
      const u = BY_TOKEN[p.token];
      if (!u) return json({ ok: false, error: 'auth', message: 'Потрібен вхід за PIN' });
      if (u.must_change) return json({ ok: false, error: 'pin_change_required', message: 'Спочатку замініть тимчасовий PIN' });
      if (p.role === 'Механік' && !u.user.can.mech) return json({ ok: false, error: 'forbidden', message: 'Ваша роль не дає права' });
      received.push(p);
      return json({ ok: true, report_id: p.report_id, counts: { ok: p.items.length }, warnings: [] });
    }
    json({ ok: false, error: 'unknown action: ' + act });
  });
});
srv.listen(PORT, '127.0.0.1', () => console.log('mock on ' + PORT));

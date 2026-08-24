/* Мінімальний Apps Script для прогону .gs у Node. Тільки те, що реально викликається. */
const crypto = require('crypto');

function pad(g, r, c) {
  while (g.length < r) g.push([]);
  for (const row of g) while (row.length < c) row.push('');
}
class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  getValues() {
    pad(this.sh.g, this.r + this.nr - 1, this.c + this.nc - 1);
    return this.sh.g.slice(this.r - 1, this.r - 1 + this.nr)
      .map(row => row.slice(this.c - 1, this.c - 1 + this.nc));
  }
  setValues(v) {
    pad(this.sh.g, this.r + v.length - 1, this.c + v[0].length - 1);
    v.forEach((row, i) => row.forEach((x, j) => { this.sh.g[this.r - 1 + i][this.c - 1 + j] = x; }));
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  clearContent() { return this.setValues(Array.from({ length: this.nr }, () => Array(this.nc).fill(''))); }
  setNumberFormat() { return this; } setFontWeight() { return this; } setBackground() { return this; }
  setVerticalAlignment() { return this; } setDataValidation() { return this; } setNote() { return this; }
}
class Sheet {
  constructor(name, grid, id) { this.name = name; this.g = grid || [[]]; this.id = id || 0; }
  getName() { return this.name; } getSheetId() { return this.id; }
  getLastRow() { let n = 0; this.g.forEach((r, i) => { if (r.some(v => v !== '' && v != null)) n = i + 1; }); return n; }
  getLastColumn() { let n = 0; this.g.forEach(r => r.forEach((v, j) => { if (v !== '' && v != null) n = Math.max(n, j + 1); })); return n; }
  getMaxRows() { return Math.max(this.g.length, 100); }
  getDataRange() { return new Range(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
  getRange(r, c, nr, nc) { return new Range(this, r, c, nr || 1, nc || 1); }
  setFrozenRows() {} setFrozenColumns() {} setColumnWidth() {}
}
class SS {
  constructor(id, sheets) { this.id = id; this.sheets = sheets; }
  getId() { return this.id; } getName() { return 'stub'; } getSheets() { return this.sheets; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
}
const bytes = b => Array.from(b).map(x => (x > 127 ? x - 256 : x));   // Java віддає знакові байти
const store = { books: {}, props: {}, cache: {}, log: [] };

global.SpreadsheetApp = {
  getActive: () => store.books.active,
  openById: id => store.books[id] || (() => { throw new Error('no access to ' + id); })(),
  newDataValidation: () => ({ requireValueInList() { return this; }, setAllowInvalid() { return this; }, build() { return {}; } })
};
global.Utilities = {
  DigestAlgorithm: { SHA_256: 'sha256', MD5: 'md5' },
  Charset: { UTF_8: 'utf8' },
  computeDigest: (alg, s) => bytes(crypto.createHash(alg).update(String(s), 'utf8').digest()),
  computeHmacSha256Signature: (s, k) => bytes(crypto.createHmac('sha256', String(k)).update(String(s), 'utf8').digest()),
  base64EncodeWebSafe: s => Buffer.from(String(s), 'utf8').toString('base64url'),
  base64DecodeWebSafe: s => bytes(Buffer.from(String(s), 'base64url')),
  newBlob: b => ({ getDataAsString: () => Buffer.from(b.map(x => x < 0 ? x + 256 : x)).toString('utf8') }),
  getUuid: () => crypto.randomUUID(),
  formatDate: (d, tz, f) => new Date(d).toISOString().replace(/\.\d+Z$/, 'Z')
};
global.PropertiesService = { getScriptProperties: () => ({
  getProperty: k => (k in store.props ? store.props[k] : null),
  setProperty: (k, v) => { store.props[k] = v; }
}) };
global.CacheService = { getScriptCache: () => ({
  get: k => (k in store.cache ? store.cache[k] : null),
  put: (k, v) => { store.cache[k] = v; },
  remove: k => { delete store.cache[k]; }
}) };
global.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) };
global.Logger = { log: m => store.log.push(m) };
global.Session = { getEffectiveUser: () => ({ getEmail: () => 'stub@example.com' }),
                   getActiveUser: () => ({ getEmail: () => 'stub@example.com' }) };
global.MailApp = { sendEmail: o => store.log.push('MAIL → ' + o.to) };
global.ContentService = { MimeType: { JSON: 'json' },
  createTextOutput: t => ({ setMimeType: () => t }) };
global.DriveApp = { getFolderById: () => { throw new Error('no drive in stub'); } };
global.MimeType = { JPEG: 'image/jpeg' };
module.exports = { store, Sheet, SS };

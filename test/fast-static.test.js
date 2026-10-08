const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');
const fastStatic = require('../src/fast-static');

const BODY = '<!doctype html><title>x</title>' + '<p>hola mundo</p>'.repeat(100);

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quizarena-'));
  fs.writeFileSync(path.join(dir, 'index.html'), BODY);
  fs.writeFileSync(path.join(dir, 'tiny.txt'), 'hi');
  fs.writeFileSync(path.join(dir, 'song.mp3'), 'not-text');
  const mw = fastStatic(dir);
  const server = http.createServer((req, res) => mw(req, res, () => { res.statusCode = 404; res.end('next'); }));
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    t.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
    resolve(`http://127.0.0.1:${server.address().port}`);
  }));
}

const get = (url, headers = {}) => new Promise((resolve, reject) => {
  http.get(url, { headers }, res => {
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  }).on('error', reject);
});

test('sirve index.html en "/" sin comprimir si el cliente no lo acepta', async t => {
  const base = await setup(t);
  const r = await get(base + '/', { 'accept-encoding': 'identity' });
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /text\/html/);
  assert.equal(r.headers['content-encoding'], undefined);
  assert.equal(r.body.toString(), BODY);
});

test('usa brotli o gzip precomprimido cuando el cliente lo acepta', async t => {
  const base = await setup(t);
  const br = await get(base + '/index.html', { 'accept-encoding': 'br, gzip' });
  assert.equal(br.headers['content-encoding'], 'br');
  assert.equal(zlib.brotliDecompressSync(br.body).toString(), BODY);
  const gz = await get(base + '/index.html', { 'accept-encoding': 'gzip' });
  assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.equal(zlib.gunzipSync(gz.body).toString(), BODY);
});

test('responde 304 cuando el ETag coincide', async t => {
  const base = await setup(t);
  const first = await get(base + '/index.html', { 'accept-encoding': 'gzip' });
  const again = await get(base + '/index.html', { 'accept-encoding': 'gzip', 'if-none-match': first.headers.etag });
  assert.equal(again.status, 304);
  assert.equal(again.body.length, 0);
});

test('no comprime archivos pequeños', async t => {
  const base = await setup(t);
  const r = await get(base + '/tiny.txt', { 'accept-encoding': 'br, gzip' });
  assert.equal(r.headers['content-encoding'], undefined);
  assert.equal(r.body.toString(), 'hi');
});

test('deja pasar lo que no es texto (mp3) y lo que no existe', async t => {
  const base = await setup(t);
  assert.equal((await get(base + '/song.mp3')).body.toString(), 'next');
  assert.equal((await get(base + '/no-existe.html')).body.toString(), 'next');
});

test('bloquea intentos de salir del directorio público', async t => {
  const base = await setup(t);
  const r = await get(base + '/..%2fpackage.json');
  assert.equal(r.body.toString(), 'next');
  const r2 = await get(base + '/%2e%2e/package.json');
  assert.equal(r2.body.toString(), 'next');
});

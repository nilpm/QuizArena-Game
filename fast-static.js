/* Servidor de archivos de texto (html/css/js/json/svg) pensado para CPU muy limitada.
 *
 * - Cada archivo se lee y se comprime UNA sola vez (brotli + gzip) y se guarda en memoria.
 * - Cada petición solo elige la versión ya comprimida y la escribe: casi 0 de CPU.
 * - ETag + 304: si el navegador ya lo tiene, no se envía ni un byte de contenido.
 * - Si editas un archivo con el servidor encendido, se recarga solo (revisa cada 2 s).
 * - Todo lo que no sea texto (mp3, png…) se deja pasar (next) para que lo sirva express.static,
 *   que soporta "Range" (Safari lo necesita para reproducir audio).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8'
};
const RECHECK_MS = 2000;

module.exports = function fastStatic(dir, extras = {}) {
  dir = path.resolve(dir);
  const cache = new Map();                       // url → entrada

  function build(file, prev) {
    let st;
    try { st = fs.statSync(file); } catch (e) { return null; }
    if (!st.isFile()) return null;
    if (prev && prev.mtime === st.mtimeMs && prev.size === st.size) { prev.checked = Date.now(); return prev; }
    const type = TYPES[path.extname(file).toLowerCase()];
    if (!type) return null;
    const raw = fs.readFileSync(file);
    const tag = crypto.createHash('sha1').update(raw).digest('base64url').slice(0, 16);
    const big = raw.length > 600;                // por debajo de esto comprimir no compensa
    return {
      type, raw, tag, mtime: st.mtimeMs, size: st.size, checked: Date.now(),
      gz: big ? zlib.gzipSync(raw, { level: 9 }) : null,
      br: big ? zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } }) : null
    };
  }

  function get(url) {
    const prev = cache.get(url);
    if (prev && Date.now() - prev.checked < RECHECK_MS) return prev;
    let file;
    if (extras[url]) file = extras[url];
    else {
      file = path.join(dir, url);
      if (file !== dir && !file.startsWith(dir + path.sep)) return null;   // nada fuera de /public
    }
    const e = build(file, prev);
    if (e) cache.set(url, e); else cache.delete(url);
    return e;
  }

  // Precalienta la caché al arrancar (así ningún jugador paga el costo de comprimir)
  const warm = (d, base) => {
    let names = []; try { names = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const n of names) {
      if (n.isDirectory()) warm(path.join(d, n.name), base + n.name + '/');
      else get(base + n.name);
    }
  };
  warm(dir, '/');
  Object.keys(extras).forEach(get);

  return function (req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let url = req.url.split('?')[0];
    try { url = decodeURIComponent(url); } catch (e) { return next(); }
    if (url.includes('\0') || url.includes('..')) return next();
    if (url.endsWith('/')) url += 'index.html';
    const e = get(url);
    if (!e) return next();

    const ae = String(req.headers['accept-encoding'] || '');
    let body = e.raw, enc = '';
    if (e.br && /\bbr\b/.test(ae)) { body = e.br; enc = 'br'; }
    else if (e.gz && /\bgzip\b/.test(ae)) { body = e.gz; enc = 'gzip'; }

    const etag = `"${e.tag}${enc ? '-' + enc : ''}"`;
    const h = { 'Content-Type': e.type, ETag: etag, 'Vary': 'Accept-Encoding', 'Cache-Control': extras[url] ? 'public, max-age=3600' : 'no-cache' };
    if (String(req.headers['if-none-match'] || '').includes(etag)) { res.writeHead(304, h); return res.end(); }
    if (enc) h['Content-Encoding'] = enc;
    h['Content-Length'] = body.length;
    res.writeHead(200, h);
    res.end(req.method === 'HEAD' ? undefined : body);
  };
};

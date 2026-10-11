/* Minimal static file server for the built site (dist/).
 * Used by the deploy sandbox: listens on PORT and binds 0.0.0.0. */
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT || 3000);
const APP_ROOT = dirname(fileURLToPath(import.meta.url));
const DIST_ROOT = resolve(APP_ROOT, 'dist');
const ROOT = existsSync(join(DIST_ROOT, 'index.html')) ? DIST_ROOT : APP_ROOT;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ts': 'video/mp2t',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

// Text assets worth compressing on the fly. Images/video/webp are already
// encoded and would only burn CPU for no gain.
const COMPRESS_EXT = new Set(['js', 'mjs', 'css', 'html', 'json', 'svg', 'txt', 'map']);
const HAS_BROTLI = typeof brotliCompressSync === 'function';

async function send(req, res, filePath, urlPath) {
  const meta = await stat(filePath);
  const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
  const total = meta.size;
  const range = req.headers.range;
  /* Weak validator from size+mtime. Without it every response is
     "max-age=0, must-revalidate" with NO validator, so a revalidating request
     (e.g. the <video> element after a rel=preload warmed the cache) had to
     re-download the whole body. With ETag the revalidation is a 304 and the
     preloaded body is reused. */
  const etag = `"${total.toString(16)}-${Math.floor(meta.mtimeMs).toString(16)}"`;
  // Vite-hashed /assets/* (JS/CSS/fonts) never change once built → safe to
  // cache forever. Everything else (HTML, covers, detail tiles) keeps a
  // revalidate policy so a content swap on a stable filename is not served stale.
  const immutable = urlPath.startsWith('/assets/');
  const cacheControl = immutable
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=0, must-revalidate';
  const common = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': cacheControl,
    ETag: etag,
    'Last-Modified': meta.mtime.toUTCString()
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, common);
    res.end();
    return;
  }
  // On-the-fly compression for text assets (prefer brotli, fall back to gzip).
  // Skipped for range requests (video streaming) and already-encoded binaries.
  const ext = extname(filePath).toLowerCase().slice(1);
  if (!range && COMPRESS_EXT.has(ext)) {
    const ae = req.headers['accept-encoding'] || '';
    const buf = await readFile(filePath);
    let body = null, enc = null;
    if (HAS_BROTLI && /\bbr\b/.test(ae)) { body = brotliCompressSync(buf); enc = 'br'; }
    else if (/\bgzip\b/.test(ae)) { body = gzipSync(buf); enc = 'gzip'; }
    if (body) {
      res.writeHead(200, { ...common, 'Content-Encoding': enc, 'Vary': 'Accept-Encoding', 'Content-Length': body.length });
      if (req.method !== 'HEAD') res.end(body);
      else res.end();
      return;
    }
  }
  if (!range) {
    res.writeHead(200, { ...common, 'Content-Length': total });
    if (req.method !== 'HEAD') pipeSafely(filePath, res);
    else res.end();
    return;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    res.writeHead(416, { ...common, 'Content-Range': `bytes */${total}` });
    res.end();
    return;
  }
  const start = match[1] ? Number(match[1]) : Math.max(0, total - Number(match[2]) - 1);
  const end = match[2] ? Number(match[2]) : total - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= total) {
    res.writeHead(416, { ...common, 'Content-Range': `bytes */${total}` });
    res.end();
    return;
  }
  const boundedEnd = Math.min(end, total - 1);
  res.writeHead(206, {
    ...common,
    'Content-Length': boundedEnd - start + 1,
    'Content-Range': `bytes ${start}-${boundedEnd}/${total}`
  });
  if (req.method !== 'HEAD') pipeSafely(filePath, res, { start, end: boundedEnd });
  else res.end();
}

/* A read can fail mid-flight (a client that hangs up, a transient EIO from the
   sandbox filesystem). The stream error arrives out of band, so without a
   handler it becomes an unhandled 'error' event and takes the whole server down
   - which is exactly what leaves the deploy probe with no port to reach. */
function pipeSafely(filePath, res, options) {
  const stream = options ? createReadStream(filePath, options) : createReadStream(filePath);
  stream.on('error', (err) => {
    console.error(`stream error for ${filePath}: ${err && err.code ? err.code : err}`);
    stream.destroy();
    try { res.end(); } catch (e) { /* the socket is already gone */ }
  });
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath.endsWith('/')) urlPath += 'index.html';
    let filePath = normalize(join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    try {
      const s = await stat(filePath);
      if (s.isDirectory()) filePath = join(filePath, 'index.html');
    } catch {
      // Only client-side routes fall back to the SPA entry. Missing assets must
      // return 404 so a typo cannot silently load index.html as a video.
      const requestedExt = extname(urlPath).toLowerCase();
      if (requestedExt) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      filePath = join(ROOT, 'index.html');
    }
    await send(req, res, filePath, urlPath);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Internal error: ' + (err && err.message));
  }
});

// Never let one bad request stop the server: the deploy probe only asks for a
// listening port, and a crash here reads as "service not ready".
process.on('uncaughtException', (err) => {
  console.error(`uncaughtException: ${err && err.stack ? err.stack : err}`);
});

server.on('error', (err) => {
  console.error(`server error: ${err && err.code ? err.code : err}`);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`static server serving ${ROOT} on http://0.0.0.0:${PORT}`);
});

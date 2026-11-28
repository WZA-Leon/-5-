'use strict';
/* ==========================================================================
   极简静态文件服务器：本地预览 / 截图验证 / PWA 资源检查。
   只读、无依赖；默认只监听回环地址，避免把开发目录暴露到局域网。
   用法:
     node tools/serve.js
     PORT=8080 HOST=0.0.0.0 node tools/serve.js   # 手机同网段调试时显式指定
   ========================================================================== */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { ROOT, isInside } = require('./lib/paths');

const PORT = Number(process.env.PORT || 8123);
const HOST = process.env.HOST || '127.0.0.1';

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error('invalid PORT:', process.env.PORT);
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, status, body, headers = {}) {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': data.length,
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(data);
}

function resolveRequestPath(rawUrl) {
  const pathname = String(rawUrl || '/').split('?')[0].split('#')[0] || '/';
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return { error: 400 };
  }
  if (decoded.includes('\0')) return { error: 400 };

  // 先按 URL 段拒绝 . / .. / 隐藏文件，再落到文件系统。这样 /../.gitignore、
  // /%2e%2e/ 以及 Windows 的反斜杠变体都不会被静态服务器读到。
  const segments = decoded.split(/[\\/]+/).filter(Boolean);
  if (
    segments.some((s) => s === '.' || s === '..' || (s.startsWith('.') && s !== '.well-known'))
  ) {
    return { error: 403 };
  }

  const rel = segments.length ? segments.join(path.sep) : 'index.html';
  const filePath = path.resolve(ROOT, rel);
  if (!isInside(ROOT, filePath)) return { error: 403 };
  return { filePath };
}

function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    send(res, 405, 'method not allowed');
    return;
  }

  const { filePath, error } = resolveRequestPath(req.url);
  if (error) {
    send(res, error, error === 400 ? 'bad request' : 'forbidden');
    return;
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    send(res, 404, 'not found');
    return;
  }
  if (!stat.isFile()) {
    send(res, 404, 'not found');
    return;
  }

  const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  fs.createReadStream(filePath)
    .on('error', () => {
      if (!res.headersSent) send(res, 500, 'read error');
      else res.destroy();
    })
    .pipe(res);
}

function main() {
  const server = http.createServer(handler);
  server.on('error', (err) => {
    console.error('server error:', err.message);
    process.exit(1);
  });
  server.listen(PORT, HOST, () => {
    console.log(`serving http://${HOST}:${PORT}/  (root: ${ROOT})`);
  });
  return server;
}

if (require.main === module) main();

module.exports = { main, handler, resolveRequestPath, MIME };

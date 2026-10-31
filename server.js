const { createServer } = require('http');
const { parse } = require('url');
const fs = require('fs');
const path = require('path');
const next = require('next');

process.env.NODE_ENV = 'production';
process.chdir(__dirname);

const hostname = process.env.HOSTNAME || '0.0.0.0';
const rawPort = process.env.PORT || 3000;
const port = isNaN(rawPort) ? 3000 : parseInt(rawPort, 10);
const listenTarget = rawPort;

const app = next({ dev: false, hostname, port, dir: __dirname });
const handle = app.getRequestHandler();

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp'
};

app.prepare().then(() => {
  createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      const pathname = parsedUrl.pathname || '';

      // 1. Direct interception for _next/static/ files (CSS, JS chunks)
      if (pathname.startsWith('/_next/static/')) {
        const relativePath = pathname.replace('/_next/', '');
        let filePath = path.join(__dirname, '.next', relativePath);
        if (!fs.existsSync(filePath)) {
          filePath = path.join(__dirname, 'public', pathname);
        }
        if (fs.existsSync(filePath)) {
          const ext = path.extname(filePath).toLowerCase();
          res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          const stream = fs.createReadStream(filePath);
          stream.pipe(res);
          return;
        }
      }

      // 2. Direct interception for public/ static files (logos, favicons)
      if (pathname !== '/') {
        const publicPath = path.join(__dirname, 'public', pathname);
        if (fs.existsSync(publicPath) && fs.statSync(publicPath).isFile()) {
          const ext = path.extname(publicPath).toLowerCase();
          res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
          res.setHeader('Cache-Control', 'public, max-age=86400');
          const stream = fs.createReadStream(publicPath);
          stream.pipe(res);
          return;
        }
      }

      // 3. Pass everything else to Next.js App Router handler
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  }).listen(listenTarget, () => {
    console.log(`> Ready on ${isNaN(listenTarget) ? listenTarget : `http://${hostname}:${listenTarget}`}`);
  });
});

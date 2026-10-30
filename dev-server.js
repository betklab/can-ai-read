// Local preview: node dev-server.js  ->  http://localhost:3000
// Serves index.html and runs api/check.js the way Vercel does.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import handler from './api/check.js';

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/api/check') {
    req.query = Object.fromEntries(u.searchParams);
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
    return handler(req, res);
  }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(await readFile(new URL('./index.html', import.meta.url)));
}).listen(process.env.PORT || 3000, () => console.log('http://localhost:' + (process.env.PORT || 3000)));

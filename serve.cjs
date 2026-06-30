const http = require('http'), fs = require('fs'), path = require('path');
const root = __dirname;
http.createServer((req, res) => {
  let u = req.url.split('?')[0];
  if (u === '/') u = '/test-built.html';
  const file = path.join(root, u);
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('404'); return; }
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(5195, () => console.log('http://localhost:5195'));

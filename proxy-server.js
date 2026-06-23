var http = require('http');
var fs = require('fs');
var path = require('path');
var DIST = path.join(__dirname, 'frontend', 'dist');
var mime = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json'};

process.on('uncaughtException', function(e) { console.error('Uncaught:', e.message); });

http.createServer(function(req, res) {
    try {
        if (req.url.startsWith('/api/')) {
            var opts = {hostname:'localhost',port:8000,path:req.url,method:req.method};
            opts.headers = {};
            for (var k in req.headers) {
                if (k !== 'host') opts.headers[k] = req.headers[k];
            }
            var pr = http.request(opts, function(pr2) {
                res.writeHead(pr2.statusCode, pr2.headers);
                pr2.pipe(res);
            });
            pr.on('error', function(e) {
                try { res.writeHead(502); res.end('Proxy error: ' + e.message); } catch(ex) {}
            });
            req.pipe(pr);
        } else {
            var fp = path.join(DIST, req.url === '/' ? 'index.html' : decodeURIComponent(req.url));
            fs.readFile(fp, function(e, d) {
                if (e) { res.writeHead(404); res.end('Not found'); return; }
                res.writeHead(200, {'Content-Type': mime[path.extname(fp)] || 'text/plain'});
                res.end(d);
            });
        }
    } catch(e) {
        try { res.writeHead(500); res.end('Server error'); } catch(ex) {}
    }
}).listen(5173, '0.0.0.0');
console.log('Server on http://127.0.0.1:5173');

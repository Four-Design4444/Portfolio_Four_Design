const http=require('http'),fs=require('fs'),path=require('path');
const root=__dirname;
http.createServer((req,res)=>{
  let p=decodeURIComponent(req.url.split('?')[0]);if(p==='/')p='/index.html';
  const f=path.join(root,p);
  fs.readFile(f,(e,d)=>{
    if(e){res.writeHead(404);res.end('404');return}
    const ext=path.extname(f);
    res.writeHead(200,{'Content-Type':ext==='.html'?'text/html; charset=utf-8':'application/octet-stream'});
    res.end(d);
  });
}).listen(8907,'127.0.0.1',()=>console.log('serving on 8907'));

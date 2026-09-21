/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Isolated, same-origin HTTP test stack. No existing relay or user data needed.
   node tests/e2e/_local-stack.mjs smoke release36
   E2E_PORT=8241 node tests/e2e/_local-stack.mjs  # every suite */
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const port = Number(process.env.E2E_PORT || 8241);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorija-e2e-'));
const log = fs.openSync(path.join(dir, 'servers.log'), 'w');
const env = { ...process.env, CHAT_SIGNAL_HOST:'127.0.0.1', CHAT_SIGNAL_PORT:String(port+2), CHAT_PRESENCE_PORT:String(port+3),
  CHAT_OFFLINE_STORE_PATH:path.join(dir,'offline-messages.json'), CHAT_OFFLINE_STORE_DIR:path.join(dir,'mailboxes'),
  CHAT_PUSH_STORE_PATH:path.join(dir,'push.json'), CHAT_VAPID_STORE_PATH:path.join(dir,'vapid.json'),
  CHAT_POLICY_STORE_PATH:path.join(dir,'policy.json'), CHAT_EXPIRY_LOG_PATH:path.join(dir,'expiry.json'),
  CHAT_SELF_DESTRUCT_STORE_PATH:path.join(dir,'self-destruct.json'),
  MONITOR_PASSWORD:'Local-Test-Only-Password-36', TURN_PASSWORD:'Local-Test-Only-Turn-36' };
const children = [];
const run = (file, args=[], overrides={}, output=log) => {
  const child = spawn(process.execPath,[file,...args],{cwd:root,env:{...env,...overrides},stdio:['ignore',output,output]});
  children.push(child); return child;
};
const sockets = new Set();
const proxy = http.createServer((req,res) => {
  const pathname = new URL(req.url,'http://localhost').pathname;
  const candidate = path.join(root, pathname === '/' ? 'index.html' : pathname);
  const isFile = candidate.startsWith(root) && fs.existsSync(candidate) && fs.statSync(candidate).isFile();
  const upstream = http.request({hostname:'localhost',port:isFile?port+1:port+2,path:req.url,method:req.method,headers:req.headers},response=>{
    res.writeHead(response.statusCode,response.headers);response.pipe(res);
  });
  upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);
});
proxy.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
proxy.on('upgrade',(req,socket,head)=>{
  const upstream=net.connect(port+2,'127.0.0.1',()=>{
    upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`+Object.entries(req.headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')+'\r\n\r\n');
    upstream.write(head);socket.pipe(upstream);upstream.pipe(socket);
  });
  upstream.on('error',()=>socket.destroy());socket.on('close',()=>upstream.destroy());socket.on('error',()=>upstream.destroy());
});
function cleanup() { children.forEach(p=>{if(p.exitCode===null)p.kill('SIGTERM');}); sockets.forEach(s=>s.destroy());proxy.close(); }
process.on('SIGINT',()=>{cleanup();process.exitCode=130;});process.on('SIGTERM',()=>{cleanup();process.exitCode=143;});
try {
  await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(port,'127.0.0.1',resolve);});
  run('scripts/dev-static.js',[],{PORT:String(port+1)});run('scripts/server.js');
  const url=`http://localhost:${port}`;
  let ready=false;
  for(let i=0;i<100;i++){
    try { ready=(await fetch(url+'/index.html')).ok && (await fetch(url+'/chat-health')).ok; } catch(_){}
    if(ready)break;
    await new Promise(r=>setTimeout(r,100));
  }
  if(!ready)throw Error(`Local stack failed; inspect ${path.join(dir,'servers.log')}`);
  console.log(`Isolated test stack: ${url}; evidence directory: ${dir}`);
  const suite=run('tests/e2e/run-all.mjs',process.argv.slice(2),{PKG_URL:url,RELAY_URL:url,PKG_RELAY:url,RELAY_WS:url.replace(/^http/,'ws')+'/chat-signal',CHAT_DATA_DIR:dir},'inherit');
  process.exitCode=await new Promise(resolve=>suite.once('exit',code=>resolve(code??1)));
} finally { cleanup();fs.closeSync(log); }

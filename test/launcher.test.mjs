import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,writeFile,readFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';

test('concurrent launches reuse one service and preserve streams; explicit restart replaces it', {skip:process.platform!=='win32',timeout:60000},async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'tree-launcher-')),data=path.join(root,'data');await mkdir(data);
  await copyFile(new URL('../Start.ps1',import.meta.url),path.join(root,'Start.ps1'));
  // Stand-in service uses the real launcher, process creation, state file and HTTP contract.
  await writeFile(path.join(root,'server.mjs'),`import http from 'node:http';import {writeFile,appendFile} from 'node:fs/promises';import path from 'node:path';import {randomUUID} from 'node:crypto';
const data=process.env.TREE_DATA_DIR,token=randomUUID(),streams=new Set();
const server=http.createServer((req,res)=>{if(req.url==='/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(': connected\\n\\n');streams.add(res);res.on('close',()=>streams.delete(res));return;}if(req.url==='/test/emit'){for(const s of streams)s.write('data: still running\\n\\n');res.end('ok');return;}if(req.url==='/api/shutdown'&&req.headers['x-tree-token']===token){res.end('{}');setTimeout(()=>process.exit(0),50);return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({app:'conversation-tree',token,pid:process.pid,active:{task:'running'}}));});
server.listen(0,'127.0.0.1',async()=>{const state={url:'http://127.0.0.1:'+server.address().port,pid:process.pid,startedAt:Date.now()};await appendFile(path.join(data,'launches.txt'),process.pid+'\\n');await writeFile(path.join(data,'service.json'),JSON.stringify(state));});`);
  const launch=(restart=false)=>new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'Start.ps1'),'-NoBrowser','-DataDirectory',data,...(restart?['-Restart']:[])],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
    const timer=setTimeout(()=>{child.kill();reject(new Error('Launcher process timed out: '+stderr));},45000);
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    // A Windows background child can inherit capture handles. Check launcher exit,
    // not the lifetime of inherited pipes held by the intentionally running service.
    child.on('exit',code=>{clearTimeout(timer);child.stdout.destroy();child.stderr.destroy();code===0?resolve({stdout}):reject(new Error(stderr||'Launcher failed: '+code));});
  });
  const state=async()=>JSON.parse(await readFile(path.join(data,'service.json'),'utf8'));
  let controller;
  try{
    console.log('launcher: concurrent cold start');
    const results=await Promise.all([launch(),launch()]);console.log('launcher: cold starts returned');assert(results.some(r=>r.stdout.includes('Opened existing')));
    const first=await state(),session=await (await fetch(first.url+'/api/session')).json();
    assert.equal((await readFile(path.join(data,'launches.txt'),'utf8')).trim().split('\n').length,1);
    controller=new AbortController();const events=await fetch(first.url+'/api/events',{signal:controller.signal}),reader=events.body.getReader();await reader.read();
    console.log('launcher: reopening with an active stream');await Promise.all([launch(),launch()]);console.log('launcher: reopen returned');
    const reused=await state();assert.equal(reused.pid,first.pid);assert.equal((await (await fetch(first.url+'/api/session')).json()).token,session.token);
    await fetch(first.url+'/test/emit');assert.match(new TextDecoder().decode((await reader.read()).value),/still running/);controller.abort();
    console.log('launcher: explicit restart');await launch(true);console.log('launcher: restart returned');const restarted=await state();assert.notEqual(restarted.pid,first.pid);assert.equal((await readFile(path.join(data,'launches.txt'),'utf8')).trim().split('\n').length,2);
  }finally{
    controller?.abort();
    try{const s=await state(),session=await (await fetch(s.url+'/api/session')).json();await fetch(s.url+'/api/shutdown',{method:'POST',headers:{'X-Tree-Token':session.token}});}catch{}
    await delay(250);await rm(root,{recursive:true,force:true});
  }
});

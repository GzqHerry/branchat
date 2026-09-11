import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import ssh2 from 'ssh2';
import {SshConnections,openSSH,profileInput,shellQuote} from '../ssh.mjs';

test('SSH profile validates inputs and excludes passwords',()=>{
  assert.throws(()=>profileInput({host:'x;command',username:'a'}));
  assert.throws(()=>profileInput({host:'host',username:'user',port:65536}));
  assert.equal(profileInput({host:'host',username:'user',password:'secret'}).password,undefined);
  assert.equal(shellQuote("a'b"),"'a'\\''b'");
});

test('SSH stdio: local backend history, isolated forks, streams, approvals and disconnect', {timeout:30000},async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'tree-direct-ssh-'));
  const privateKey=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs1',format:'pem'},publicKeyEncoding:{type:'pkcs1',format:'pem'}}).privateKey;
  const clients=new Set(),commands=[],calls=[],histories=new Map();let rpcChannel,approvalAnswer,readDelay=false,holdRead=false,releaseRead,holdStart=false,releaseStart;
  const write=msg=>rpcChannel.write(JSON.stringify(msg)+'\n');
  const emit=(method,params)=>write({method,params});
  const finish=(id,turn)=>{turn.items.push({type:'agentMessage',id:randomUUID(),phase:'final_answer',text:'远程回答完成'});turn.status='completed';emit('turn/completed',{threadId:id,turn});};
  const ssh=new ssh2.Server({hostKeys:[privateKey]},client=>{
    clients.add(client);client.on('error',()=>{});client.on('close',()=>clients.delete(client));
    client.on('authentication',ctx=>ctx.username==='tester'&&ctx.method==='password'&&ctx.password==='test-password'?ctx.accept():ctx.reject());
    client.on('ready',()=>client.on('session',accept=>{
      const session=accept();session.on('exec',(accept,reject,info)=>{
        const stream=accept();commands.push(info.command);
        if(info.command.includes('TREE_HOME=')){stream.write('TREE_HOME=/remote/test\nTREE_CODEX=/remote/test/codex\n');stream.exit(0);stream.end();return;}
        if(!info.command.includes('app-server')){const candidate=info.command.match(/(?:cd|mkdir -p) '([^']+)'/);stream.write((candidate?.[1]||'/remote/test')+'\n');stream.exit(0);stream.end();return;}
        rpcChannel=stream;
        createInterface({input:stream}).on('line',line=>{
          const msg=JSON.parse(line);if(!msg.method){approvalAnswer=msg.result;return;}calls.push(msg);const p=msg.params||{};let result={};
          if(msg.method==='initialize')result={userAgent:'fixture'};
          else if(msg.method==='model/list')result={data:[{model:'fixture-model',displayName:'Fixture',supportedReasoningEfforts:[{reasoningEffort:'high'}],defaultReasoningEffort:'high'}],nextCursor:null};
          else if(msg.method==='thread/list')result={data:p.archived?[]:[...histories.values()],nextCursor:null};
          else if(msg.method==='thread/start'){const thread={id:randomUUID(),cwd:p.cwd,turns:[],updatedAt:1};histories.set(thread.id,thread);result={thread};}
          else if(msg.method==='thread/read')result={thread:histories.get(p.threadId)};
          else if(msg.method==='thread/turns/list')result={data:histories.get(p.threadId).turns,nextCursor:null};
          else if(msg.method==='thread/resume')result={thread:histories.get(p.threadId)};
          else if(msg.method==='thread/fork'){const original=histories.get(p.threadId),index=original.turns.findIndex(t=>t.id===(p.lastTurnId||p.beforeTurnId));const thread={...structuredClone(original),id:randomUUID(),turns:structuredClone(original.turns.slice(0,index+(p.lastTurnId?1:0)))};histories.set(thread.id,thread);result={thread};}
          else if(msg.method==='turn/interrupt'){const turn=histories.get(p.threadId).turns.find(t=>t.id===p.turnId);turn.status='interrupted';emit('turn/completed',{threadId:p.threadId,turn});}
          else if(msg.method==='turn/start'){const turn={id:randomUUID(),status:'inProgress',items:[{type:'userMessage',id:randomUUID(),content:p.input}]};histories.get(p.threadId).turns.push(turn);result={turn};}
          if(msg.id!==undefined){if(holdRead&&msg.method==='thread/read'){holdRead=false;releaseRead=()=>write({id:msg.id,result});return;}if(holdStart&&msg.method==='turn/start'){holdStart=false;emit('turn/started',{threadId:p.threadId,turn:result.turn});releaseStart=()=>write({id:msg.id,result});return;}if(readDelay&&msg.method==='thread/read')setTimeout(()=>write({id:msg.id,result}),50);else write({id:msg.id,result});}
        });
      });
    }));
  });
  ssh.listen(0,'127.0.0.1');await once(ssh,'listening');
  const manager=await new SshConnections(directory,fileURLToPath(new URL('..',import.meta.url))).init();
  const profile=await manager.add({host:'127.0.0.1',username:'tester',port:ssh.address().port});
  const gateway=http.createServer((req,res)=>manager.proxy(profile.id,req,res,req.url).catch(e=>{res.writeHead(400);res.end(e.message);}));
  try{
    let fp;await assert.rejects(openSSH(profile,{password:'test-password'}),e=>{fp=e.hostKey.fingerprint;return true;});
    await assert.rejects(openSSH(profile,{password:'wrong'},fp),/认证失败/);
    await assert.rejects(openSSH(profile,{password:'test-password'},'SHA256:changed'),e=>!!e.hostKey);
    manager.connect(profile.id,{password:'test-password',trustedFingerprint:fp});
    for(let i=0;i<150&&!manager.live.has(profile.id);i++)await delay(20);
    assert.equal(manager.status()[0].connected,true,manager.status()[0].error);
    const sharedConnection=manager.live.get(profile.id);
    manager.connect(profile.id,{password:'test-password'});
    assert.equal(manager.live.get(profile.id),sharedConnection,'Second window reuses the established SSH connection');
    assert(!(await readFile(manager.file,'utf8')).includes('password'));
    gateway.listen(0,'127.0.0.1');await once(gateway,'listening');const base='http://127.0.0.1:'+gateway.address().port;
    const token=(await (await fetch(base+'/api/session')).json()).token;
    const api=async(route,body)=>{const response=await fetch(base+'/api/'+route,{...(body?{method:'POST',headers:{'Content-Type':'application/json','X-Tree-Token':token},body:JSON.stringify(body)}:{})});const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;};
    assert.equal((await api('models')).data[0].model,'fixture-model');
    const readsBeforeNew=calls.filter(c=>c.method==='thread/read'||c.method==='thread/turns/list').length;
    const created=await api('new',{text:'第一问',model:'fixture-model',effort:'high'}),id=created.conversation.id;
    assert.equal(calls.filter(c=>c.method==='turn/start').at(-1).params.effort,'high');
    assert.equal(calls.filter(c=>c.method==='turn/start').at(-1).params.model,'fixture-model');
    assert.equal(calls.filter(c=>c.method==='thread/read'||c.method==='thread/turns/list').length,readsBeforeNew,'New conversation acknowledgement never waits for history');
    assert.match(created.conversation.workspaceCwd,/^\/remote\/test\/CodexProjects\//);
    const second=await api('new',{text:'另一个窗口的提问'}),secondId=second.conversation.id;
    assert.equal(Object.keys((await api('session')).active).length,2,'Two conversations run on the same SSH connection');
    const turn=histories.get(id).turns[0];
    turn.items.push({type:'reasoning',id:'private-reasoning',summary:[]});
    readDelay=true;const beforeReads=calls.filter(c=>c.method==='thread/read').length;
    const duplicateReads=await Promise.all(Array.from({length:4},()=>api('tree?id='+id)));
    assert.equal(calls.filter(c=>c.method==='thread/read').length-beforeReads,1,'Concurrent windows share one tree read');
    assert(!duplicateReads[0].root.turns[0].items.some(i=>i.type==='reasoning'));
    assert(histories.get(id).turns[0].items.some(i=>i.type==='reasoning'),'Runtime context is unchanged');readDelay=false;
    const controller=new AbortController(),events=await fetch(base+'/api/events',{signal:controller.signal}),reader=events.body.getReader();await reader.read();
    const secondController=new AbortController(),secondEvents=await fetch(base+'/api/events',{signal:secondController.signal}),secondReader=secondEvents.body.getReader();await secondReader.read();
    emit('item/agentMessage/delta',{threadId:id,turnId:turn.id,itemId:'live',delta:'实时回答'});
    assert.match(new TextDecoder().decode((await reader.read()).value),/实时回答/);controller.abort();
    assert.match(new TextDecoder().decode((await secondReader.read()).value),/实时回答/);
    emit('item/agentMessage/delta',{threadId:secondId,turnId:histories.get(secondId).turns[0].id,itemId:'live2',delta:'关闭一个窗口后仍在输出'});
    assert.match(new TextDecoder().decode((await secondReader.read()).value),/关闭一个窗口后仍在输出/);secondController.abort();
    assert.equal(manager.live.get(profile.id),sharedConnection);
    finish(secondId,histories.get(secondId).turns[0]);await delay(40);
    write({id:'permission-1',method:'item/permissions/requestApproval',params:{threadId:id,turnId:turn.id,permissions:{fileSystem:{write:['/remote/shared']}}}});
    let requests=[];for(let i=0;i<40&&!requests.length;i++){requests=(await api('interactions')).requests;await delay(10);}
    await api('interactions/respond',{id:requests[0].id,choiceId:'session'});
    for(let i=0;i<40&&!approvalAnswer;i++)await delay(10);assert.equal(approvalAnswer.scope,'session');
    finish(id,turn);await delay(40);
    await api('send',{threadId:id,text:'后续内容',model:'other-model',effort:'low'});assert.equal(calls.filter(c=>c.method==='turn/start').at(-1).params.effort,'low');assert.equal(calls.filter(c=>c.method==='turn/start').at(-1).params.model,'other-model');finish(id,histories.get(id).turns[1]);await delay(40);
    const fork=await api('fork',{threadId:id,turnId:turn.id});
    assert.equal(histories.get(fork.id).turns.length,1);assert.equal(calls.find(x=>x.method==='thread/fork').params.lastTurnId,turn.id);
    assert.equal((await api('threads')).threads.length,2,'Owned branches must not reappear as root conversations');
    await api('branches/delete',{threadId:fork.id,expectedIds:[fork.id]});assert.equal((await api('threads')).threads.length,2,'Deleted branch stays absent');
    assert(!(await api('tree?id='+id)).branches.some(b=>b.id===fork.id));
    assert(calls.some(x=>x.method==='thread/fork'&&x.params.sandbox==='workspace-write'));
    assert(!commands.some(c=>/command -v node|python3|server\.mjs|tar -x/.test(c)),'No remote web runtime or deploy commands');
    const saved=JSON.parse(await readFile(path.join(directory,'ssh-hosts',profile.id,'branches.json'),'utf8'));assert(saved.conversations[id]);
    // Stop bypasses a blocked history read and cancels sends queued before it.
    await api('send',{threadId:id,text:'stop regression'});
    await api('send',{threadId:secondId,text:'unrelated active turn'});
    holdRead=true;const blockedRead=api('tree?id='+id);
    for(let i=0;i<100&&!releaseRead;i++)await delay(10);assert(releaseRead);
    const queued=fetch(base+'/api/send',{method:'POST',headers:{'Content-Type':'application/json','X-Tree-Token':token},body:JSON.stringify({threadId:id,text:'must not start'})});
    await delay(40);const stopped=await api('stop',{threadId:id,turnId:histories.get(id).turns.at(-1).id});
    assert(stopped.requested||stopped.stopped);assert.equal(histories.get(id).turns.at(-1).status,'interrupted');
    assert.equal(histories.get(secondId).turns.at(-1).status,'inProgress','Stop is branch scoped');
    releaseRead();await blockedRead;assert.equal((await queued).status,400);
    assert(!histories.get(id).turns.some(t=>t.items.some(i=>i.content?.some(c=>c.text==='must not start'))));
    // A turn/start acknowledgement may arrive after the interrupt notification.
    holdStart=true;const pendingStart=api('send',{threadId:id,text:'delayed start'});
    for(let i=0;i<100&&!releaseStart;i++)await delay(10);assert(releaseStart);
    await api('stop',{threadId:id});releaseStart();await pendingStart;
    assert.equal(histories.get(id).turns.at(-1).status,'interrupted');
    assert(!(await api('session')).active[id],'Late start acknowledgement cannot revive the stopped turn');
    await api('stop',{threadId:id});
    finish(secondId,histories.get(secondId).turns.at(-1));await delay(40);
    // Sending an idle turn must not wait for an unrelated full-history read.
    holdRead=true;releaseRead=null;const slowHistory=api('tree?id='+id);
    for(let i=0;i<100&&!releaseRead;i++)await delay(10);assert(releaseRead);
    const fastSend=await api('send',{threadId:id,text:'send while reading'});
    assert.equal(fastSend.turn.status,'inProgress');
    await api('stop',{threadId:id});releaseRead();const refreshed=await slowHistory;
    assert.equal(refreshed.root.turns.at(-1).id,fastSend.turn.id,'Snapshot is refreshed after overlapping mutation');
    manager.disconnect(profile.id);assert.equal((await fetch(base+'/api/session')).status,503);assert.equal(manager.status()[0].stage,'SSH 已断开');
    manager.connect(profile.id,{password:'test-password'});
    for(let i=0;i<150&&!manager.live.has(profile.id);i++)await delay(20);
    assert.equal(manager.status()[0].connected,true);
    const restored=await (await fetch(base+'/api/threads')).json();assert.equal(restored.threads.length,2);assert(restored.threads.some(t=>t.id===id));
    const tree=await (await fetch(base+'/api/tree?id='+id)).json();assert.equal(tree.root.turns.length,5);assert.equal(tree.branches.length,0);
  }finally{manager.close();gateway.closeAllConnections();gateway.close();for(const client of clients)client.end();ssh.close();await delay(30);await rm(directory,{recursive:true,force:true});}
});

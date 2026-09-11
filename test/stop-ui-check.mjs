import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
const require=createRequire(import.meta.url),{chromium}=require(process.env.TREE_PLAYWRIGHT||'playwright');
const base=process.env.TREE_TEST_URL||'http://127.0.0.1:47831/';
const rootId='50000000-0000-0000-0000-000000000001',branchId='50000000-0000-0000-0000-000000000002';
const turn=(id,text,status='inProgress')=>({id,status,startedAt:Date.now()/1000,items:[{type:'userMessage',id:'q-'+id,content:[{type:'text',text}]}]});
const original=turn('root-live','正在思考的问题'),branchTurn=turn('branch-live','分支正在思考');
const root={id:rootId,turns:[original]},branch={id:branchId,rootId,parentId:rootId,pivotTurnId:'root-live',prefixCount:0,name:'独立分支',thread:{id:branchId,turns:[branchTurn]}};
const sends=[],errors=[];let dropResponse=false,slowTree=false,releaseTree,stopCalls=0;
const active=()=>Object.fromEntries([root,branch.thread].filter(t=>t.turns.at(-1).status==='inProgress').map(t=>[t.id,t.turns.at(-1).id]));
const browser=await chromium.launch({headless:true,...(process.env.TREE_BROWSER_EXE?{executablePath:process.env.TREE_BROWSER_EXE}:{})});
try{
 const context=await browser.newContext({viewport:{width:1280,height:900}});
 await context.route('**/api/**',async route=>{
   const url=new URL(route.request().url()),input=route.request().postDataJSON();let result={};
   if(url.pathname==='/api/events')return route.fulfill({contentType:'text/event-stream',body:': connected\n\n'});
   if(url.pathname==='/api/session')result={token:'test',features:['workbench','new-conversation'],active:active()};
   if(url.pathname==='/api/threads')result={threads:[{id:rootId,name:'队列测试',source:'web'}]};
   if(url.pathname==='/api/tree'&&slowTree){await new Promise(resolve=>releaseTree=resolve);}
   if(url.pathname==='/api/tree')result={root,rootRecord:{id:rootId,name:'队列测试'},branches:[branch],active:active()};
   if(url.pathname==='/api/send'){
     const t=input.threadId===rootId?root:branch.thread;
     if(t.turns.at(-1).status==='inProgress')return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'正在回答'})});
     sends.push(input);const next=turn('sent-'+sends.length,input.text);t.turns.push(next);result={turn:next};
     if(dropResponse){dropResponse=false;return route.abort('connectionfailed');}
   }
   if(url.pathname==='/api/stop'){stopCalls++;const t=input.threadId===rootId?root:branch.thread;t.turns.at(-1).status='interrupted';result={stopped:true};}
   await route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.locator('.node.active').waitFor();

 await page.locator('#prompt').fill('must not auto send');await page.locator('#prompt').press('Enter');await page.locator('.queue-row').waitFor();
 await page.evaluate(()=>{window.heldQueueLock=navigator.locks.request('tree-question-queue:50000000-0000-0000-0000-000000000001',()=>new Promise(resolve=>window.releaseQueueLock=resolve));});
 await page.waitForFunction(()=>!!window.releaseQueueLock);
 slowTree=true;await page.locator('#refresh').click();
 await page.waitForFunction(()=>document.querySelector('#prompt').disabled);
 await page.locator('#stop').click();
 assert.equal(stopCalls,1,'Stop works while ordinary actions are busy and the queue lock is held');
 assert.equal(root.turns.at(-1).status,'interrupted');
 assert.equal(await page.locator('#stop').isVisible(),false);
 assert.equal(await page.evaluate(()=>localStorage.getItem('tree-queue-stop:50000000-0000-0000-0000-000000000001')),'true');
 assert.equal(sends.length,0);assert.match(await page.locator('#question-queue').innerText(),/队列已暂停/);
 slowTree=false;releaseTree?.();await page.evaluate(()=>window.releaseQueueLock());
 await page.waitForFunction(()=>!document.querySelector('#prompt').disabled);
 assert.deepEqual(errors,[]);console.log('PASS: stop bypasses UI busy state and held queue lock; confirmed status; queued prompts remain paused');
}finally{await browser.close();}

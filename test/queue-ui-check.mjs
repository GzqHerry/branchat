import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
const require=createRequire(import.meta.url),{chromium}=require(process.env.TREE_PLAYWRIGHT||'playwright');
const base=process.env.TREE_TEST_URL||'http://127.0.0.1:47831/';
const rootId='50000000-0000-0000-0000-000000000001',branchId='50000000-0000-0000-0000-000000000002';
const turn=(id,text,status='inProgress')=>({id,status,startedAt:Date.now()/1000,items:[{type:'userMessage',id:'q-'+id,content:[{type:'text',text}]}]});
const original=turn('root-live','正在思考的问题'),branchTurn=turn('branch-live','分支正在思考');
const root={id:rootId,turns:[original]},branch={id:branchId,rootId,parentId:rootId,pivotTurnId:'root-live',prefixCount:0,name:'独立分支',thread:{id:branchId,turns:[branchTurn]}};
const sends=[],errors=[];let dropResponse=false;
const active=()=>Object.fromEntries([root,branch.thread].filter(t=>t.turns.at(-1).status==='inProgress').map(t=>[t.id,t.turns.at(-1).id]));
const browser=await chromium.launch({headless:true,...(process.env.TREE_BROWSER_EXE?{executablePath:process.env.TREE_BROWSER_EXE}:{})});
try{
 const context=await browser.newContext({viewport:{width:1280,height:900}});
 await context.route('**/api/**',async route=>{
   const url=new URL(route.request().url()),input=route.request().postDataJSON();let result={};
   if(url.pathname==='/api/events')return route.fulfill({contentType:'text/event-stream',body:': connected\n\n'});
   if(url.pathname==='/api/session')result={token:'test',features:['workbench','new-conversation'],active:active()};
   if(url.pathname==='/api/threads')result={threads:[{id:rootId,name:'队列测试',source:'web'}]};
   if(url.pathname==='/api/tree')result={root,rootRecord:{id:rootId,name:'队列测试'},branches:[branch],active:active()};
   if(url.pathname==='/api/send'){
     const t=input.threadId===rootId?root:branch.thread;
     if(t.turns.at(-1).status==='inProgress')return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'正在回答'})});
     sends.push(input);const next=turn('sent-'+sends.length,input.text);t.turns.push(next);result={turn:next};
     if(dropResponse){dropResponse=false;return route.abort('connectionfailed');}
   }
   if(url.pathname==='/api/stop'){const t=input.threadId===rootId?root:branch.thread;t.turns.at(-1).status='interrupted';result={stopped:true};}
   await route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.locator('.node.active').waitFor();
 assert.equal(await page.locator('#prompt').isEnabled(),true);assert.equal(await page.locator('#stop').isVisible(),true);
 const enqueue=async text=>{await page.locator('#prompt').fill(text);await page.locator('#prompt').press('Enter');await page.waitForFunction(()=>document.querySelector('#prompt').value==='');};
 await enqueue('排队问题一');await enqueue('排队问题二');assert.equal(await page.locator('.queue-row').count(),2);assert.equal(sends.length,0);
 await page.locator('.node[data-key="'+branchId+':leaf"]').click();await enqueue('只发送到独立分支');assert.equal(await page.locator('.queue-row').count(),1);
 await page.locator('.node[data-key="'+rootId+':root-live"]').click();await page.reload();await page.locator('.queue-row').nth(1).waitFor();
 const second=await context.newPage();second.on('pageerror',e=>errors.push(e.message));await second.goto(base);await second.locator('.queue-row').nth(1).waitFor();
 await page.locator('#prompt').fill('尚未提交的下一条草稿');
 original.status='completed';await page.waitForFunction(()=>JSON.parse(localStorage.getItem('tree-question-queues'))[Object.keys(JSON.parse(localStorage.getItem('tree-question-queues')))[0]].items.length===1);
 assert.equal(sends.filter(s=>s.text==='排队问题一').length,1);assert.equal(sends[0].threadId,rootId);assert.equal(await page.locator('#prompt').inputValue(),'尚未提交的下一条草稿');assert.equal(sends.some(s=>s.threadId===branchId),false);
 await delay(2300);assert.equal(sends.length,1);
 root.turns.at(-1).status='completed';branchTurn.status='completed';
 await page.waitForFunction(()=>Object.values(JSON.parse(localStorage.getItem('tree-question-queues'))).every(q=>q.items.length===0));
 assert.equal(sends.filter(s=>s.text==='排队问题二').length,1);assert.equal(sends.filter(s=>s.text==='只发送到独立分支'&&s.threadId===branchId).length,1);
 await second.close();await page.bringToFront();await page.evaluate(()=>dispatchEvent(new Event('focus')));await page.waitForFunction(()=>document.querySelector('.node.active')?.dataset.key.endsWith('sent-2')||document.querySelector('#messages').textContent.includes('排队问题二'));
 const rootLatest=root.turns.at(-1).id;await page.locator('.node[data-key="'+rootId+':'+rootLatest+'"]').click();await enqueue('失败后保留');root.turns.at(-1).status='failed';
 await page.waitForFunction(()=>document.querySelector('#question-queue').textContent.includes('上一轮未正常完成'));
 assert.equal(sends.some(s=>s.text==='失败后保留'),false);
 await page.getByRole('button',{name:'移除排队问题 1',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#question-queue').hidden);
 // Lost response after accepted send is reconciled, never sent twice.
 root.turns.at(-1).status='inProgress';await page.evaluate(()=>dispatchEvent(new Event('focus')));await enqueue('断线也不重复');
 await page.getByRole('button',{name:'继续队列',exact:true}).click();dropResponse=true;root.turns.at(-1).status='completed';
 await page.waitForFunction(()=>document.querySelector('#question-queue').hidden,{},{timeout:15000});assert.equal(sends.filter(s=>s.text==='断线也不重复').length,1);
 await page.evaluate(()=>dispatchEvent(new Event('focus')));await delay(150);await page.locator('.node[data-key="'+rootId+':'+root.turns.at(-1).id+'"]').click();await enqueue('停止后不自动发送');await page.locator('#stop').click();await page.waitForFunction(()=>document.querySelector('#question-queue').textContent.includes('队列已暂停'));await delay(2300);assert.equal(sends.some(s=>s.text==='停止后不自动发送'),false);
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'work/queue-mobile.png'});
 assert.deepEqual(errors,[]);console.log('PASS: typing during thinking; Enter FIFO; persistent reload; branch isolation; two-tab exactly-once dispatch; unsent draft preserved; failure pause; remove pending; ambiguous POST reconciled; stop pauses queue; mobile layout');
}finally{await browser.close();}

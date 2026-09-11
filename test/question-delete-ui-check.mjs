import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.TREE_PLAYWRIGHT||'playwright');
const rootId='60000000-0000-0000-0000-000000000001',childId='60000000-0000-0000-0000-000000000002';
const turn=(id,text)=>({id,status:'completed',items:[{type:'userMessage',id:'q-'+id,content:[{type:'text',text}]},{type:'agentMessage',id:'a-'+id,text:'回答 '+text,phase:'final_answer'}]});
const all=[turn('A','保留提问'),turn('B','删除这条提问'),turn('C','后续提问')];let deleted=false,deletions=0,revision=0;
const browser=await chromium.launch({headless:true,...(process.env.TREE_BROWSER_EXE?{executablePath:process.env.TREE_BROWSER_EXE}:{})});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({rootId})=>sessionStorage.setItem('tree-live-phases',JSON.stringify({[rootId+':B']:{streamObserved:true},[rootId+':C']:{streamObserved:true}})),{rootId});
 await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url()),body=route.request().postDataJSON();let data={};
   if(url.pathname==='/api/events')return route.fulfill({contentType:'text/event-stream',body:': ready\n\n'});
   if(url.pathname==='/api/session')data={token:'test',features:['workbench','question-delete','branch-delete'],active:{}};
   if(url.pathname==='/api/threads')data={threads:[{id:rootId,name:'删除提问测试',source:'web'}]};
   if(url.pathname==='/api/tree')data={root:{id:rootId,turns:deleted?all.slice(0,1):all,contextRevision:revision},rootRecord:{id:rootId,name:'删除提问测试'},branches:deleted?[]:[{id:childId,parentId:rootId,rootId,pivotTurnId:'B',prefixCount:2,name:'被影响子分支',thread:{id:childId,turns:all.slice(0,2)}}],active:{},metadata:{}};
   if(url.pathname==='/api/questions/preview')data={turns:all.slice(1).map(t=>({id:t.id,name:t.items[0].content[0].text})),branches:[{id:childId,name:'被影响子分支'}]};
   if(url.pathname==='/api/questions/delete'){assert.equal(body.threadId,rootId);assert.equal(body.turnId,'B');assert.deepEqual(body.expectedTurnIds,['B','C']);assert.deepEqual(body.expectedBranchIds,[childId]);deleted=true;revision++;deletions++;data={deletionId:'receipt',remainingTurnId:'A',affectedIds:[rootId,childId]};}
   if(url.pathname==='/api/library')data={metadata:{},trash:[],branches:[],questionTrash:deleted?[{id:'receipt',name:'删除这条提问',turnCount:2,branchCount:1,deletedAt:Date.now()}]:[]};
   await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto(process.env.TREE_TEST_URL||'http://127.0.0.1:47831/');await page.locator('.node.active').waitFor();
 const row=page.locator('.tree-row').filter({has:page.locator('.node[data-key="'+rootId+':B"]')}),remove=row.getByRole('button',{name:'删除此提问及后续内容',exact:true});
 assert.equal(await remove.evaluate(el=>getComputedStyle(el).opacity),'0');await row.hover();await page.waitForFunction(()=>[...document.querySelectorAll('.tree-question-delete')].some(b=>getComputedStyle(b).opacity==='1'));
 await remove.click();assert.equal(await page.locator('.node.active').getAttribute('data-key'),rootId+':C');await page.getByRole('heading',{name:'删除此提问及后续内容'}).waitFor();assert.match(await page.locator('#question-delete-summary').innerText(),/2 轮问答和 1 个子分支/);
 await page.locator('#question-delete-dialog').getByRole('button',{name:'取消',exact:true}).click();assert.equal(deletions,0);assert.equal(await page.locator('#stream-a-C').count(),1);
 await page.evaluate(({id})=>localStorage.setItem('tree-question-queues',JSON.stringify({[id]:{rootId:id,paused:true,contextRevision:0,items:[{id:'pending',text:'待确认草稿',state:'waiting'}]}})),{id:rootId});
 await remove.click();await page.locator('#question-delete-dialog').getByRole('button',{name:'确认删除',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.node.active')?.dataset.key.endsWith(':A'));assert.equal(deletions,1);assert.equal(await page.locator('#stream-a-B,#stream-a-C').count(),0);assert.equal(await page.getByRole('button',{name:'被影响子分支',exact:true}).count(),0);
 await page.waitForFunction(()=>document.querySelector('#question-queue')?.textContent.includes('上下文已变化'));
 await page.locator('#recycle-bin').click();await page.getByRole('button',{name:'恢复提问记录',exact:true}).waitFor();assert.match(await page.locator('#library-list').innerText(),/恢复为独立对话/);await page.locator('#library-dialog').getByRole('button',{name:'关闭',exact:true}).click();
 await page.reload();await page.locator('.node.active').waitFor();assert.equal(await page.locator('#stream-a-B').count(),0);
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'work/question-delete-mobile.png'});assert.deepEqual(errors,[]);
 console.log('PASS: hover delete affordance; scope confirmation; cancel preserves selection/history; confirmed suffix removal; descendant removal; context changed queue pause; recycle-bin restoration entry; reload persistence; mobile layout');
}finally{await browser.close();}

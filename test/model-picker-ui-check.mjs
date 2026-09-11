import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.TREE_PLAYWRIGHT||'playwright');
const rootId='40000000-0000-0000-0000-000000000001',branchId='40000000-0000-0000-0000-000000000002',alternative='40000000-0000-0000-0000-000000000003';
const turn=(id,q,a)=>({id,status:'completed',items:[{type:'userMessage',id:'q-'+id,content:[{type:'text',text:q}]},{type:'agentMessage',phase:'final_answer',id:'a-'+id,text:a}]});
const base=turn('one','解释 PPO','# PPO\n\n公式 $r_t$。\n\n```js\nconst ratio = 1.2;\n```\n\n## 方法\n\n'+Array.from({length:24},(_,i)=>'解释段落 '+i).join('\n\n'));
const next=turn('two','第二个问题','## 主线结论\n\n保留这个答案。');
const forkTurn=turn('branch-turn','另一种方法','## 备选方法\n\n这是可引用的独立答案。');
const metadata={},branches=[{id:branchId,rootId,parentId:rootId,pivotTurnId:'one',prefixCount:1,name:'另一种方法',thread:{id:branchId,model:'fixture',turns:[base,forkTurn]}}];
let forkRequest,sendRequest,summaryCreated=false;
const root={id:rootId,model:'fixture',turns:[base,next]};
const tree=()=>({root,rootRecord:{id:rootId,name:'PPO 讨论'},branches:branches.filter(b=>!b.hidden),metadata,active:{},usage:{[rootId]:{last:{totalTokens:1234},modelContextWindow:100000}}});
const browser=await chromium.launch({headless:true,...(process.env.TREE_BROWSER_EXE?{executablePath:process.env.TREE_BROWSER_EXE}:{})});
try{
 const page=await browser.newPage({viewport:{width:1440,height:940}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/model-picker.js',async route=>route.fulfill({contentType:'text/javascript',body:await readFile(new URL('../public/model-picker.js',import.meta.url),'utf8')}));
 await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url()),body=route.request().postDataJSON();let result={};
   if(url.pathname==='/api/events')return route.fulfill({contentType:'text/event-stream',body:': events\n\n'});
   if(url.pathname==='/api/session')result={token:'test',features:['new-conversation','branch-delete','workbench','model-effort'],active:{}};
   if(url.pathname==='/api/threads')result={threads:[{id:rootId,name:'PPO 讨论',source:'web',updated_at:Date.now()/1000,...metadata[rootId]}],metadata};
   if(url.pathname==='/api/models')result={data:[{model:'gpt-6-astra',displayName:'GPT-6 Astra',defaultReasoningEffort:'medium',supportedReasoningEfforts:['low','medium','high','xhigh'].map(reasoningEffort=>({reasoningEffort}))},{model:'gpt-5.6-sol',displayName:'GPT-5.6 Sol',defaultReasoningEffort:'low',supportedReasoningEfforts:['low','high'].map(reasoningEffort=>({reasoningEffort}))}]};
   if(url.pathname==='/api/tree')result=tree();
   if(url.pathname==='/api/metadata'){metadata[body.key]={...metadata[body.key],...body};result=metadata[body.key];}
   if(url.pathname==='/api/library')result={metadata,branches:branches.filter(b=>!b.hidden),trash:branches.filter(b=>b.hidden)};
   if(url.pathname==='/api/search')result={total:1,results:[{rootId,threadId:rootId,turnId:'one',itemId:'a-one',name:'PPO 讨论',role:'Codex',snippet:'公式与方法'}]};
   if(url.pathname==='/api/fork'){forkRequest=body;const b={id:alternative,rootId,parentId:body.threadId,pivotTurnId:body.turnId,prefixCount:0,name:'备选答案',thread:{id:alternative,turns:[turn('new-turn','解释 PPO','新的答案')]}};branches.push(b);result=b;}
   if(url.pathname==='/api/send'){sendRequest=body;result={turn:next};}
   if(url.pathname==='/api/summary'){if(body){summaryCreated=true;result={id:'summary'};}else result={status:'completed',text:'目标：解释 PPO。结论：使用裁剪策略。'};}
   if(url.pathname==='/api/lightweight'){assert.match(body.context,/PPO/);result=branches[0];}
   if(url.pathname==='/api/branches/delete'){const b=branches.find(b=>b.id===body.threadId);b.hidden=true;b.deletionId='receipt';b.deletedAt=Date.now();result={deletedIds:[b.id],deletionId:'receipt'};}
   if(url.pathname==='/api/branches/restore'){branches.find(b=>b.id===body.threadId).hidden=false;result={restoredIds:[body.threadId]};}
   if(url.pathname==='/api/export')result=url.searchParams.has('id')?{name:'PPO',markdown:'# PPO'}:{format:'conversation-tree',version:1,roots:[],branches:[]};
   await route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
 });
 await page.goto(process.env.TREE_TEST_URL||'http://127.0.0.1:47831/');await page.locator('#stream-a-two').waitFor();

 await page.locator('#model-trigger').click();
 await page.locator('[data-model="gpt-6-astra"]').click();
 await page.locator('#model-effort').focus();await page.keyboard.press('End');
 assert.match(await page.locator('#model-trigger').innerText(),/极高/);
 await page.keyboard.press('Escape');assert.equal(await page.locator('#model-panel').isVisible(),false);
 await page.locator('#prompt').fill('测试模型与强度');await Promise.all([page.waitForResponse(r=>r.url().includes('/api/tree')),page.locator('#send').click()]);
 assert.equal(sendRequest.model,'gpt-6-astra');assert.equal(sendRequest.effort,'xhigh');
 await page.locator('#model-trigger').click();await page.locator('[data-model="gpt-5.6-sol"]').click();
 assert.equal(await page.locator('#model-effort').getAttribute('max'),'1');
 await page.locator('[data-model="gpt-6-astra"]').click();assert.equal(await page.locator('#model-effort').inputValue(),'3');
 for(const width of [1440,390]){
   await page.setViewportSize({width,height:940});
   const b=await page.locator('#model-panel').boundingBox();assert.ok(b.x>=0&&b.x+b.width<=width&&b.y>=0&&b.y+b.height<=940);
   await page.screenshot({path:new URL('../../../work/model-panel-'+width+'.png',import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, '$1')});
 }
 await page.setViewportSize({width:1440,height:940});await page.evaluate(()=>{document.documentElement.dataset.theme='dark';document.documentElement.dataset.palette='amber';});
 await page.screenshot({path:new URL('../../../work/model-panel-dark.png',import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, '$1')});
 await page.locator('#model-trigger').click();await page.reload();await page.locator('#stream-a-two').waitFor();
 await page.locator('#model-trigger').click();await page.locator('[data-model="gpt-6-astra"]').waitFor();
 assert.equal(await page.locator('#model-effort').inputValue(),'3');
 assert.deepEqual(errors,[]);console.log('PASS: model menu, keyboard slider, request payload, per-model levels, persistence and desktop/mobile bounds');
}finally{await browser.close();}

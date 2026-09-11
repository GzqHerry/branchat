import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.TREE_PLAYWRIGHT||'playwright');
const rootId='40000000-0000-0000-0000-000000000001',branchId='40000000-0000-0000-0000-000000000002',alternative='40000000-0000-0000-0000-000000000003';
const turn=(id,q,a)=>({id,status:'completed',items:[{type:'userMessage',id:'q-'+id,content:[{type:'text',text:q}]},{type:'agentMessage',phase:'final_answer',id:'a-'+id,text:a}]});
const base=turn('one','解释 PPO','# PPO\n\n公式 $r_t$。\n\n```js\nconst ratio = 1.2;\n```\n\n## 方法\n\n'+Array.from({length:24},(_,i)=>'解释段落 '+i).join('\n\n'));
const next=turn('two','第二个问题','## 主线结论\n\n保留这个答案。');
const forkTurn=turn('branch-turn','另一种方法','## 备选方法\n\n这是可引用的独立答案。');
const metadata={},branches=[{id:branchId,rootId,parentId:rootId,pivotTurnId:'one',prefixCount:1,name:'另一种方法',thread:{id:branchId,model:'fixture',turns:[base,forkTurn]}}];
let forkRequest,sendRequest,summaryCreated=false,treeReads=0;
const root={id:rootId,model:'fixture',turns:[base,next]};
const tree=()=>({root,rootRecord:{id:rootId,name:'PPO 讨论'},branches:branches.filter(b=>!b.hidden),metadata,active:{},usage:{[rootId]:{last:{totalTokens:1234},modelContextWindow:100000}}});
const browser=await chromium.launch({headless:true,...(process.env.TREE_BROWSER_EXE?{executablePath:process.env.TREE_BROWSER_EXE}:{})});
try{
 const page=await browser.newPage({viewport:{width:1440,height:940}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.EventSource=class {static OPEN=1;readyState=1;constructor(){window.fixtureEvents=this;}close(){this.readyState=2;}};});
 await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url()),body=route.request().postDataJSON();let result={};
   if(url.pathname==='/api/events')return route.fulfill({contentType:'text/event-stream',body:': events\n\n'});
   if(url.pathname==='/api/session')result={token:'test',features:['new-conversation','branch-delete','workbench'],active:{}};
   if(url.pathname==='/api/threads')result={threads:[{id:rootId,name:'PPO 讨论',source:'web',updated_at:Date.now()/1000,...metadata[rootId]}],metadata};
   if(url.pathname==='/api/tree'){treeReads++;result=tree();}
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

 next.status='inProgress';
 const event=async(method,params)=>page.evaluate(({method,params})=>window.fixtureEvents.onmessage({data:JSON.stringify({method,params})}),{method,params});
 await event('turn/started',{threadId:rootId,turn:next});
 await page.evaluate(()=>dispatchEvent(new Event('focus')));await page.waitForTimeout(500);
 const baseline=treeReads;
 await event('item/agentMessage/delta',{threadId:rootId,turnId:next.id,itemId:'a-two',delta:'持续输出'});
 await page.waitForTimeout(4500);assert.equal(treeReads,baseline,'Active stream does not poll entire history every two seconds');
 assert.match(await page.locator('#stream-a-two').innerText(),/持续输出/);
 next.status='completed';await event('turn/completed',{threadId:rootId,turn:next});await page.waitForTimeout(500);
 assert.ok(treeReads>baseline,'Completion still synchronizes immediately');
 assert.deepEqual(errors,[]);console.log('PASS: live output immediate, no redundant two-second history polls, completion sync retained');
}finally{await browser.close();}

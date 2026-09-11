import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {approvalChoices} from '../execution.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.TREE_PLAYWRIGHT||'playwright');
const server=http.createServer(async(req,res)=>{try{const file=new URL('../public/'+(req.url==='/'?'index.html':req.url.slice(1)),import.meta.url);res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':req.url.endsWith('.css')?'text/css':'text/html');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.TREE_BROWSER_EXE?{executablePath:process.env.TREE_BROWSER_EXE}:{})});
const rootId='80000000-0000-0000-0000-000000000001',childId='80000000-0000-0000-0000-000000000002';
const root={id:rootId,turns:[{id:'one',status:'completed',items:[{type:'userMessage',id:'q',content:[{type:'text',text:'本机编辑测试'}]}]}]},record={id:rootId,name:'本机编辑测试'};
const request=(id,method,params)=>({id,method,params:{threadId:rootId,rootId,turnId:'one',threadName:'本机编辑测试',...params},choices:approvalChoices(method,params)});
let requests=[request('1','item/commandExecution/requestApproval',{command:'echo <test>',cwd:'C:/project',reason:'需要访问项目里的文件'})];const responses=[],newChats=[],errors=[];
try{
 const context=await browser.newContext({viewport:{width:1280,height:900}});
 await context.route('**/api/**',async route=>{
   const url=new URL(route.request().url()),input=route.request().postDataJSON();let result={};
   if(url.pathname==='/api/events')return route.fulfill({contentType:'text/event-stream',body:': connected\n\n'});
   if(url.pathname==='/api/session')result={token:'test',features:['workbench','local-edit','automatic-edit','new-conversation','utf8-body'],active:{}};
   if(url.pathname==='/api/threads')result={threads:[{...record,source:'web'}]};
   if(url.pathname==='/api/tree')result={root,rootRecord:record,branches:[],active:{}};
   if(url.pathname==='/api/execution')throw new Error('Manual directory/mode endpoint must not be called');
   if(url.pathname==='/api/interactions')result={requests};
   if(url.pathname==='/api/interactions/respond'){responses.push(input);requests=requests.filter(r=>r.id!==input.id);result={answered:true};}
   if(url.pathname==='/api/new'){newChats.push(input);result={conversation:record,turn:root.turns[0]};}
   await route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('.node.active').waitFor();
 await page.locator('#approval-panel').waitFor();assert.equal(await page.locator('#execution-mode,#execution-directory,#execution-select').count(),0);assert.equal(await page.locator('dialog[open]').count(),0);
 assert.equal(await page.locator('#approval-panel').evaluate(p=>p.nextElementSibling.id),'composer');assert.match(await page.locator('.interaction-card pre').textContent(),/echo <test>/);assert.equal(responses.length,0);
 await page.getByRole('button',{name:'拒绝',exact:true}).click();assert.equal(responses[0].choiceId,'decline');await page.waitForFunction(()=>document.querySelector('#approval-panel').hidden);
 requests=[request('2','item/permissions/requestApproval',{permissions:{fileSystem:{write:['C:/projects/large'],read:null}},reason:'修改另一个项目'})];
 await page.waitForFunction(()=>!document.querySelector('#approval-panel').hidden);assert.match(await page.locator('.permission-scopes').textContent(),/读写：C:\/projects\/large/);
 await page.reload();await page.getByRole('button',{name:'本次会话允许',exact:true}).click();assert.equal(responses[1].choiceId,'session');
 requests=[request('3','item/tool/requestUserInput',{questions:[{id:'q1',question:'请补充文件用途',isOther:true,options:null}]})];
 await page.getByLabel('请补充文件用途',{exact:true}).fill('内容正在输入，不能被流式同步清空');
 requests.push(request('4','item/fileChange/requestApproval',{threadId:childId,threadName:'其他分支',reviewItem:{changes:[{path:'C:/project/test.js',diff:'+ actual change'}]}}));
 await page.locator('#interaction-inbox').waitFor();assert.equal(await page.getByLabel('请补充文件用途',{exact:true}).inputValue(),'内容正在输入，不能被流式同步清空');
 await page.locator('#interaction-inbox').click();await page.locator('[data-request-id="4"]').waitFor();assert.equal(await page.getByLabel('请补充文件用途',{exact:true}).inputValue(),'内容正在输入，不能被流式同步清空');
 await page.locator('[data-request-id="4"]').getByRole('button',{name:'允许一次',exact:true}).click();assert.equal(responses[2].id,'4');
 await page.getByRole('button',{name:'提交回答',exact:true}).click();assert.deepEqual(responses[3].answers,{q1:'内容正在输入，不能被流式同步清空'});
 await page.locator('#new-chat').click();await page.locator('#prompt').fill('创建一个新项目');await page.locator('#prompt').press('Enter');await page.waitForFunction(()=>document.querySelector('#prompt').value==='');assert.deepEqual(newChats[0],{text:'创建一个新项目'});
 requests=[request('5','item/permissions/requestApproval',{permissions:{fileSystem:{write:['C:/Users/test/Desktop/一个大型项目'],read:null}},reason:'需要写入这个项目中的文件，无需切换目录'})];await page.locator('#approval-panel').waitFor();
 await page.evaluate(()=>{document.documentElement.dataset.theme='dark';document.documentElement.dataset.palette='amber';});
 await page.screenshot({path:fileURLToPath(new URL('../../../work/automatic-edit-desktop.png',import.meta.url))});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.equal(await page.locator('#prompt').isVisible(),true);await page.screenshot({path:fileURLToPath(new URL('../../../work/automatic-edit-mobile.png',import.meta.url))});
 await page.getByRole('button',{name:'收起详情',exact:true}).click();assert.equal(await page.locator('#approval-list').isVisible(),false);await page.getByRole('button',{name:'展开请求',exact:true}).click();
 assert.deepEqual(errors,[]);console.log('PASS: no manual mode/workspace; automatic lower approval card; explicit deny/session; reload recovery; partial answers survive polling and other requests; branch routing; new chat no config; mobile and dark layout');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}

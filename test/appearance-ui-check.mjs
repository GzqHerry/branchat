import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.TREE_PLAYWRIGHT||'playwright');
const base=process.env.TREE_TEST_URL||'http://127.0.0.1:47841';
const browser=await chromium.launch({headless:true,...(process.env.TREE_BROWSER_EXE?{executablePath:process.env.TREE_BROWSER_EXE}:{})});
const page=await browser.newPage({viewport:{width:1280,height:850}}),errors=[];
const rootId='30000000-0000-0000-0000-000000000001',newId='30000000-0000-0000-0000-000000000002';
const turn=(id,text)=>({id,status:'completed',items:[{id:'q-'+id,type:'userMessage',content:[{type:'text',text}]},{id:'a-'+id,type:'agentMessage',phase:'final_answer',text:'测试回答。'}]});
const trees={[rootId]:{root:{id:rootId,turns:[turn('old1','已有对话'),turn('old2','后续问题')]},rootRecord:null,branches:[],active:{}}};
const catalog=[{id:rootId,title:'项目讨论：对话树与工作进度',updated_at:Date.now()/1000,cwd:'C:/sample/tree'}, {id:'archived',title:'归档讨论',archived:true,updated_at:1},{id:'long',title:'较早的对话标题用于验证两行截断和窄屏布局'.repeat(10),updated_at:1}];
let newCalls=0,sendCalls=0;
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/**',async route=>{
 const url=new URL(route.request().url()),body=route.request().postDataJSON();let data;
 if(url.pathname==='/api/events')return route.fulfill({contentType:'text/event-stream',body:': fixture\n\n'});
 if(url.pathname==='/api/session')data={token:'test',features:['new-conversation'],active:{}};
 if(url.pathname==='/api/threads')data={threads:catalog};
 if(url.pathname==='/api/tree')data=trees[url.searchParams.get('id')];
 if(url.pathname==='/api/new'){
   newCalls++;assert.equal(body.text,'新会话首条\n第二行');
   const record={id:newId,name:'新会话首条',createdAt:Date.now()},first=turn('new1',body.text);
   trees[newId]={root:{id:newId,turns:[first]},rootRecord:record,branches:[],active:{}};
   catalog.unshift({...record,source:'web',updated_at:Date.now()/1000});data={conversation:record,turn:first};
 }
 if(url.pathname==='/api/send'){sendCalls++;assert.equal(body.threadId,newId);const next=turn('new2',body.text);trees[newId].root.turns.push(next);data={turn:next};}
 if(url.pathname==='/api/rename'){trees[newId].rootRecord.name=body.name;catalog[0].name=body.name;data={};}
 await route.fulfill({contentType:'application/json',body:JSON.stringify(data||{})});
});
try{
 await page.goto(base);await page.locator('#tree .node').first().waitFor();
 await page.locator('#conversation').click();
 assert.equal(await page.locator('.history-entry').count(),2);
 await page.locator('#history-search').fill('不存在');assert.equal(await page.locator('.history-entry').count(),0);
 await page.locator('#history-search').fill('');await page.locator('#archived').check();assert.equal(await page.locator('.history-entry').count(),3);
 await page.locator('#history-search').fill('项目讨论');await page.locator('#history-search').press('Enter');
 await page.locator('#history-dialog').waitFor({state:'hidden'});
 await page.locator('#new-chat').click();await page.locator('#prompt').fill('新会话首条');
 await page.locator('#prompt').dispatchEvent('compositionstart');await page.locator('#prompt').dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true,keyCode:229});assert.equal(newCalls,0);
 await page.locator('#prompt').dispatchEvent('compositionend');await page.locator('#prompt').press('Shift+Enter');await page.locator('#prompt').pressSequentially('第二行');
 assert.equal(await page.locator('#prompt').inputValue(),'新会话首条\n第二行');
 await page.reload();await page.waitForFunction(()=>!document.querySelector('#prompt').disabled);
 assert.equal(await page.locator('#prompt').inputValue(),'新会话首条\n第二行');
 await page.locator('#prompt').press('Enter');await page.waitForFunction(()=>document.querySelectorAll('.message.user').length===1);
 assert.equal(newCalls,1);assert.equal(await page.locator('#branch-name').innerText(),'新会话首条');
 await page.locator('#prompt').fill('继续提问');await page.locator('#prompt').press('Enter');
 await page.waitForFunction(()=>document.querySelectorAll('.message.user').length===2);assert.equal(sendCalls,1);assert.equal(newCalls,1);
 await page.locator('#branch-menu-button').click();await page.locator('#branch-menu').getByRole('button',{name:'重命名',exact:true}).click();await page.locator('#name-input').fill('新的名称');await page.getByRole('button',{name:'保存',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#branch-name').textContent==='新的名称');
 await page.locator('#appearance').click();await page.locator('.theme-options label').filter({hasText:'黑夜'}).click();
 for(const color of ['green','blue','rose','amber','graphite']){
   await page.locator('.palette-options label').filter({has:page.locator('input[value="'+color+'"]')}).click();
   assert.equal(await page.locator('html').getAttribute('data-palette'),color);
 }
 await page.locator('.palette-options label').filter({has:page.locator('input[value="blue"]')}).click();
 await page.locator('#close-settings').click();await page.reload();await page.locator('#tree .node').first().waitFor();
 assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');assert.equal(await page.locator('html').getAttribute('data-palette'),'blue');
 await page.locator('#conversation').click();await page.screenshot({path:'work/history-dark.png'});await page.locator('#close-history').click();
 await page.locator('#appearance').click();await page.locator('.theme-options label').filter({hasText:'系统'}).click();await page.emulateMedia({colorScheme:'light'});
 await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');await page.emulateMedia({colorScheme:'dark'});
 await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'work/settings-mobile.png'});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.locator('.theme-options label').filter({hasText:'白天'}).click();await page.locator('#close-settings').click();
 await page.locator('#conversation').click();await page.screenshot({path:'work/history-mobile.png'});
 assert.equal(await page.locator('#history-dialog').evaluate(e=>e.scrollWidth<=e.clientWidth),true);
 await page.locator('#close-history').click();await page.setViewportSize({width:1280,height:850});await page.screenshot({path:'work/appearance-day.png'});
 assert.deepEqual(errors,[]);console.log('PASS: searchable grouped history; archive filter; new chat; persisted draft; Enter send; Shift+Enter; IME; direct continuation; rename; 5 palettes; theme persistence; system theme; desktop/mobile; no page errors');
}finally{await browser.close();}

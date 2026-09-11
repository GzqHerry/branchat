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
 await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url()),body=route.request().postDataJSON();let result={};
   if(url.pathname==='/api/events')return route.fulfill({contentType:'text/event-stream',body:': events\n\n'});
   if(url.pathname==='/api/session')result={token:'test',features:['new-conversation','branch-delete','workbench'],active:{}};
   if(url.pathname==='/api/threads')result={threads:[{id:rootId,name:'PPO 讨论',source:'web',updated_at:Date.now()/1000,...metadata[rootId]}],metadata};
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
 const existing=await page.locator('#stream-a-two').elementHandle();
 await page.locator('#stream-a-two p').evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);});
 const chosen=await page.evaluate(()=>getSelection().toString());
 const synced=page.waitForResponse(r=>r.url().includes('/api/tree'));await page.evaluate(()=>dispatchEvent(new Event('focus')));await synced;await page.waitForTimeout(150);
 assert.equal(await existing.evaluate(el=>el.isConnected),true);assert.equal(await page.evaluate(()=>getSelection().toString()),chosen);await page.evaluate(()=>getSelection().removeAllRanges());
 assert.match(await page.locator('#context-usage').innerText(),/1,234/);
 await page.locator('#outline-toggle').click();assert.equal(await page.locator('#outline-list button').count(),3);
 await page.locator('#outline-list button').first().click();await page.locator('#outline-toggle').click();
 await page.locator('#messages').evaluate(el=>el.scrollTop=180);await page.waitForTimeout(100);
 const savedTop=await page.locator('#messages').evaluate(el=>el.scrollTop);
 await page.locator('.node[data-key="'+branchId+':leaf"]').click();await page.locator('#shared-history').click();
 assert.equal(await page.locator('#stream-a-one').isVisible(),false);assert.equal(await page.locator('#stream-a-branch-turn').isVisible(),true);
 await page.locator('#breadcrumbs button').first().click();
 await page.locator('.node[data-key="'+rootId+':two"]').click();
 assert.ok(Math.abs(await page.locator('#messages').evaluate(el=>el.scrollTop)-savedTop)<5);
 await page.locator('article[data-turn-id="one"] .is-favorite').count();
 await page.locator('article.user[data-turn-id="one"]').getByRole('button',{name:'收藏提问',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('article.user[data-turn-id="one"] .is-favorite'));
 await page.locator('article.user[data-turn-id="one"]').getByRole('button',{name:'提问备注'}).click();await page.locator('#note-input').fill('复习裁剪公式');await page.getByRole('button',{name:'保存备注',exact:true}).click();
 assert.equal(metadata[rootId+':one'].note,'复习裁剪公式');
 await page.getByRole('button',{name:'收藏与备注',exact:true}).click();assert.match(await page.locator('#library-list').innerText(),/复习裁剪公式/);await page.locator('#library-dialog').getByRole('button',{name:'关闭',exact:true}).click();
 await page.getByRole('button',{name:'全文搜索',exact:true}).click();await page.locator('#global-query').fill('PPO');await page.locator('#global-query').press('Enter');await page.locator('.search-result').click();assert.equal(await page.locator('.node.active').getAttribute('data-key'),rootId+':one');
 await page.locator('#stream-a-one').getByRole('button',{name:'收起代码',exact:true}).click();assert.equal(await page.locator('#stream-a-one pre').isVisible(),false);await page.locator('#stream-a-one').getByRole('button',{name:'展开代码',exact:true}).click();
 await page.locator('#compare-button').click();await page.locator('#compare-select').selectOption(branchId);await page.locator('#compare-open').click();assert.match(await page.locator('#compare-content').innerText(),/独立答案/);assert.doesNotMatch(await page.locator('#compare-content').innerText(),/解释段落/);
 await page.locator('#compare-panel').getByRole('button',{name:'引用此答案到当前分支'}).click();assert.match(await page.locator('#prompt').inputValue(),/引用「另一种方法」/);assert.equal(sendRequest,undefined);
 await page.locator('#compare-panel').getByRole('button',{name:'关闭对照'}).click();
 await page.locator('#appearance').click();await page.getByRole('slider',{name:'字号',exact:true}).fill('18');await page.locator('#close-settings').click();assert.equal(await page.locator('#stream-a-one').evaluate(el=>getComputedStyle(el).fontSize),'18px');
 await page.locator('#branch-menu-button').click();await page.getByRole('button',{name:'创建轻量分支',exact:true}).click();await page.locator('#summary-generate').click();await page.waitForFunction(()=>document.querySelector('#light-context').value.includes('裁剪策略'));assert.ok(summaryCreated);await page.locator('#light-dialog').getByRole('button',{name:'关闭',exact:true}).click();
 await page.locator('article.assistant[data-turn-id="one"]').getByRole('button',{name:'重新生成备选答案',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#branch-name').textContent==='备选答案');assert.equal(forkRequest.regenerate,true);assert.equal(root.turns.length,2);
 await page.locator('#branch-menu-button').click();await page.locator('#branch-menu').getByRole('button',{name:'删除分支',exact:true}).click();await page.locator('#delete-dialog').getByRole('button',{name:'删除',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#branch-toast').hidden);
 await page.getByRole('button',{name:'回收站',exact:true}).click();await page.locator('#library-list').getByRole('button',{name:'恢复',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#library-list').textContent.includes('回收站是空的'));await page.locator('#library-dialog').getByRole('button',{name:'关闭',exact:true}).click();
 await page.locator('#appearance').click();const download=page.waitForEvent('download');await page.getByRole('button',{name:'备份全部对话',exact:true}).click();assert.match((await download).suggestedFilename(),/\.json$/);await page.locator('#close-settings').click();
 await page.locator('.node[data-key="'+branchId+':leaf"]').click();await page.locator('#shared-history').click();
 await page.screenshot({path:'work/workbench-desktop.png'});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.locator('#messages').evaluate(el=>el.scrollWidth<=el.clientWidth),true);await page.screenshot({path:'work/workbench-mobile.png'});
 assert.equal(await page.locator('#recycle-bin').innerText(),'回收站');assert.ok(await page.locator('#recycle-bin').isVisible());
 await page.locator('#recycle-bin').click();await page.getByRole('heading',{name:'回收站',exact:true}).waitFor();assert.match(await page.locator('#library-description').innerText(),/恢复/);await page.locator('#library-dialog').getByRole('button',{name:'关闭',exact:true}).click();
 await page.locator('#branch-menu-button').click();assert.equal(await page.locator('#branch-menu-button').getAttribute('aria-expanded'),'true');await page.keyboard.press('End');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'删除分支');await page.keyboard.press('Home');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'重命名');await page.keyboard.press('Escape');assert.equal(await page.locator('#branch-menu-button').getAttribute('aria-expanded'),'false');assert.equal(await page.evaluate(()=>document.activeElement.id),'branch-menu-button');
 await page.locator('#prompt').fill(Array.from({length:10},(_,i)=>'草稿第 '+i+' 行').join('\n'));assert.ok(await page.locator('#prompt').evaluate(el=>el.clientHeight)>60);await page.locator('#prompt').fill('');
 await page.locator('#appearance').click();await page.getByRole('radio',{name:'黑夜'}).check();await page.locator('#close-settings').click();await page.screenshot({path:'work/workbench-mobile-dark.png'});
 assert.deepEqual(errors,[]);console.log('PASS: bookmarks/notes; fulltext navigation; reading position/settings; code collapse; shared history; explicit cross-branch quote; comparison; summary preview; preserved regeneration; recycle bin; backup download; desktop/mobile; no JS errors');
}finally{await browser.close();}

import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.TREE_PLAYWRIGHT||'playwright');
const rootId='40000000-0000-0000-0000-000000000001',branchId='40000000-0000-0000-0000-000000000002',alternative='40000000-0000-0000-0000-000000000003';
const turn=(id,q,a)=>({id,status:'completed',items:[{type:'userMessage',id:'q-'+id,content:[{type:'text',text:q}]},{type:'agentMessage',phase:'final_answer',id:'a-'+id,text:a}]});
const base=turn('one','解释 PPO','# PPO\n\n公式 $r_t$。\n\n```js\nconst ratio = 1.2;\n```\n\n## 方法\n\n'+Array.from({length:24},(_,i)=>'解释段落 '+i).join('\n\n'));
const sourceCode='rgb_views = {\n    name: self.decode_video_frame(source, timestamp)\n    for name, source in episode.videos.items()\n}\n\n# Decode a sampled frame\ndef decode_frame(path: str, timestamp=0.5):\n    return {"path": path, "ready": True}';
const next=turn('two','第二个问题','```python\n'+sourceCode+'\n```');
const forkTurn=turn('branch-turn','另一种方法','## 备选方法\n\n这是可引用的独立答案。');
const metadata={},branches=[{id:branchId,rootId,parentId:rootId,pivotTurnId:'one',prefixCount:1,name:'另一种方法',thread:{id:branchId,model:'fixture',turns:[base,forkTurn]}}];
let forkRequest,sendRequest,summaryCreated=false;
const root={id:rootId,model:'fixture',turns:[base,next]};
const tree=()=>({root,rootRecord:{id:rootId,name:'PPO 讨论'},branches:branches.filter(b=>!b.hidden),metadata,active:{},usage:{[rootId]:{last:{totalTokens:1234},modelContextWindow:100000}}});
const browser=await chromium.launch({headless:true,...(process.env.TREE_BROWSER_EXE?{executablePath:process.env.TREE_BROWSER_EXE}:{})});
try{
 const page=await browser.newPage({viewport:{width:1440,height:940}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copiedCode=text;}}});});
 await page.route('**/model-picker.js',async route=>route.fulfill({contentType:'text/javascript',body:await readFile(new URL('../public/model-picker.js',import.meta.url),'utf8')}));
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

 const code=page.locator('#stream-a-two pre code');
 assert.equal(await code.textContent(),sourceCode);
 assert.ok(await code.locator('.hljs-keyword').count()>0);assert.ok(await code.locator('.hljs-string').count()>0);
 await page.locator('#stream-a-two').getByRole('button',{name:'复制代码',exact:true}).click();assert.equal(await page.evaluate(()=>window.copiedCode),sourceCode);
 await page.locator('#stream-a-two').getByRole('button',{name:'收起代码',exact:true}).click();assert.equal(await code.isVisible(),false);
 await page.locator('#stream-a-two').getByRole('button',{name:'展开代码',exact:true}).click();assert.equal(await code.isVisible(),true);
 const checks=await page.evaluate(async()=>{
   const {markdown}=await import('/markdown.js');
   const samples={js:'const x = "hello";',ts:'interface User { name: string }',sh:'echo "hi"',json:'{"ok": true}',yaml:'enabled: true',html:'<script>alert(1)</script>',cpp:'int main() { return 0; }',sql:'SELECT * FROM users;',powershell:'$value = "hello"'};
   for(const [lang,source] of Object.entries(samples)){const block=markdown('```'+lang+'\n'+source+'\n```').querySelector('code');if(block.textContent!==source||!block.querySelector('span'))throw new Error('Highlight failed for '+lang);if(block.querySelector('script,img,iframe'))throw new Error('Unsafe markup');}
   const attack='<img src=x onerror="window.pwned=true">';const fragment=markdown('```html\n'+attack+'\n```');if(fragment.querySelector('img'))throw new Error('HTML escaped incorrectly');
   const plain=markdown('```unknown-lang\n'+attack+'\n```').querySelector('code');if(plain.textContent!==attack||plain.querySelector('*'))throw new Error('Unknown language changed');
   const large=markdown('```python\n'+'x'.repeat(50001)+'\n```').querySelector('code');if(large.querySelector('*'))throw new Error('Large output should remain plain');
   const partial=markdown('```python\nprint("unfinished');if(!partial.querySelector('code').textContent.includes('unfinished'))throw new Error('Partial code missing');
   const math=markdown('A formula $x^2$ and `x = 2`');if(!math.querySelector('math')||math.querySelector('code span'))throw new Error('Inline math/code changed');
   return true;
 });assert.equal(checks,true);
 for(const theme of ['light','dark']){
   await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.palette='amber';},theme);
   const colors=await code.evaluate(el=>[getComputedStyle(el.querySelector('.hljs-keyword')).color,getComputedStyle(el.querySelector('.hljs-string')).color,getComputedStyle(el).color]);assert.equal(new Set(colors).size,3);
   await code.scrollIntoViewIfNeeded();await page.locator('#stream-a-two').screenshot({path:'../../work/code-highlight-'+theme+'.png'});
 }
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.deepEqual(errors,[]);console.log('PASS: syntax and aliases; exact copying; folding; safe HTML; incomplete streaming; long/unknown fallback; math; light/dark colors; mobile');
}finally{await browser.close();}

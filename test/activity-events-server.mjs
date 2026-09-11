import http from 'node:http';
import {readFile} from 'node:fs/promises';
const rootId='20000000-0000-0000-0000-000000000001',branchId='20000000-0000-0000-0000-000000000002';
const question=text=>({type:'userMessage',id:text,content:[{type:'text',text}]});
const message=(id,text,phase='final_answer')=>({type:'agentMessage',id,text,phase});
const base={id:'base',status:'completed',items:[question('共同历史'),message('history',Array.from({length:35},(_,i)=>'历史记录 '+(i+1)).join('\n\n'))]};
const turn={id:'live',status:'inProgress',startedAt:Math.floor(Date.now()/1000),items:[question('验证进度与滚动'),message('progress','我准备事件流测试夹具。','commentary')]};
let step=0,reads=0;const clients=new Set();
function snapshot(){return {root:{id:rootId,turns:[base,{...turn,id:'source-live'}]},active:turn.status==='inProgress'?{[branchId]:turn.id}:{},branches:[{id:branchId,parentId:rootId,rootId,pivotTurnId:'base',prefixCount:1,name:'进度测试分支',thread:{id:branchId,turns:[base,turn]}}]};}
function emit(method,params){for(const res of clients)res.write('data: '+JSON.stringify({method,params:{threadId:branchId,turnId:turn.id,...params}})+'\n\n');}
function item(value,completed=false){const index=turn.items.findIndex(i=>i.id===value.id);if(index<0)turn.items.push(value);else turn.items[index]=value;emit(completed?'item/completed':'item/started',{item:value});}
function delta(text){turn.items.find(i=>i.id==='answer').text+=text;emit('item/agentMessage/delta',{itemId:'answer',delta:text});}
function advance(){
 step++;
 if(step===1)item({type:'commandExecution',id:'command',command:'node --test test/scroll.test.mjs',cwd:'C:/sample',status:'inProgress',aggregatedOutput:''});
 if(step===2){
   item({...turn.items.find(i=>i.id==='command'),status:'completed',aggregatedOutput:'2 tests passed\n<script>unsafe()</script>',exitCode:0,durationMs:1200},true);
   item({type:'fileChange',id:'file',status:'inProgress',changes:[{path:'C:/sample/public/components/conversation-activity-and-scroll-controller.js',kind:{type:'update',move_path:null},diff:'@@ -1 +1 @@\n-const follow = false;\n+const follow = true;\n+// <script>unsafe()</script>'}]});
 }
 if(step===3){
   item({...turn.items.find(i=>i.id==='file'),status:'completed'},true);
   item(message('progress2','文件已修改，正在验证自动滚动。','commentary'),true);
   item({type:'reasoning',id:'private',summary:[],content:['PRIVATE_REASONING_MUST_NOT_RENDER']},true);
   item(message('answer',''));delta(Array.from({length:45},(_,i)=>'连续输出 '+(i+1)).join('\n\n'));
 }
 if(step===4)delta('\n\n新的输出已经到达。\n\n'+Array.from({length:15},(_,i)=>'补充内容 '+(i+1)).join('\n\n'));
 if(step===5){item(turn.items.find(i=>i.id==='answer'),true);turn.status='completed';turn.durationMs=Date.now()-turn.startedAt*1000;emit('turn/completed',{turn});}
}
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');const json=x=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(x));};
 if(url.pathname==='/api/session')return json({token:'fixture',active:snapshot().active});
 if(url.pathname==='/api/threads')return json({threads:[{id:rootId,title:'进度与滚动回归'}]});
 if(url.pathname==='/api/tree'){reads++;return json(snapshot());}
 if(url.pathname==='/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(': live\n\n');clients.add(res);res.on('close',()=>clients.delete(res));return;}
 if(url.pathname==='/test/advance'&&req.method==='POST'){advance();return json({step});}
 if(url.pathname==='/test/status')return json({step,reads,clients:clients.size});
 if(url.pathname==='/test/stop'){json({stopped:true});setTimeout(()=>process.exit(0),100);return;}
 const files={'/':'index.html','/app.js':'app.js','/markdown.js':'markdown.js','/marked.js':'marked.js','/lucide.js':'lucide.js','/style.css':'style.css'};
 files['/theme.css']='theme.css';files['/connections-ui.js']='connections-ui.js';
 if(!files[url.pathname]){res.writeHead(404);res.end();return;}
 const bytes=await readFile(new URL('../public/'+files[url.pathname],import.meta.url));
 res.writeHead(200,{'Content-Type':url.pathname.endsWith('.js')?'text/javascript':url.pathname.endsWith('.css')?'text/css':'text/html'});res.end(bytes);
});
const port=Number(process.env.PORT||47839);
server.listen(port,'127.0.0.1',()=>console.log('Activity fixture: http://127.0.0.1:'+port));

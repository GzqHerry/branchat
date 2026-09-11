import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const rootId='10000000-0000-0000-0000-000000000001',branchId='10000000-0000-0000-0000-000000000002';
const base={id:'root-turn',status:'completed',items:[{type:'userMessage',content:[{type:'text',text:'共同历史'}]}]};
let start=0,reads=0;const clients=new Set(),timers=[];
const now=()=>Date.now()-start;
const question=text=>({type:'userMessage',id:text,content:[{type:'text',text}]});
const answer=(id,text)=>({type:'agentMessage',id,text,phase:'final_answer'});
function snapshot(){
 const elapsed=now(),done=elapsed>=18000;
 const turn={id:'branch-turn',status:done?'completed':'inProgress',startedAt:Math.floor(start/1000),durationMs:done?18000:null,items:[question('网页分支问题')]};
 if(elapsed>=1000)turn.items.push({type:'reasoning',id:'reasoning-1',summary:[],content:[]});
 if(elapsed>=9000)turn.items.push(answer('answer','第一段'+(elapsed>=13000?'，第二段':'')));
 const sourceTurn={id:'source-live',status:done?'completed':'inProgress',startedAt:Math.floor(start/1000),items:[question('IDE 原对话正在运行'),...(elapsed>=9000?[answer('source-answer',done?'IDE 答案已完成':'IDE 答案已输出一部分')]:[])]};
 return {root:{id:rootId,turns:[base,sourceTurn]},active:done?{}:{[branchId]:turn.id},branches:[{id:branchId,rootId,parentId:rootId,pivotTurnId:base.id,prefixCount:1,name:'实时分支',thread:{id:branchId,turns:[base,turn]}}]};
}
function emit(method,params){for(const res of clients)res.write('data: '+JSON.stringify({method,params:{threadId:branchId,turnId:'branch-turn',...params}})+'\n\n');}
function begin(){
 if(start)return;start=Date.now();
 const at=(delay,fn)=>timers.push(setTimeout(fn,delay));
 at(1000,()=>emit('item/started',{item:{type:'reasoning',id:'reasoning-1',summary:[],content:[]}}));
 at(9000,()=>{emit('item/completed',{item:{type:'reasoning',id:'reasoning-1',summary:[],content:[]}});emit('item/started',{item:answer('answer','')});emit('item/agentMessage/delta',{itemId:'answer',delta:'第一段'});});
 at(13000,()=>emit('item/agentMessage/delta',{itemId:'answer',delta:'，第二段'}));
 at(18000,()=>emit('turn/completed',{turn:snapshot().branches[0].thread.turns[1]}));
}
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');const json=x=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(x));};
 if(url.pathname==='/api/session')return json({token:'fixture',active:snapshot().active});
 if(url.pathname==='/api/threads')return json({threads:[{id:rootId,title:'实时阶段回归测试'}]});
 if(url.pathname==='/api/tree'){begin();reads++;return json(snapshot());}
 if(url.pathname==='/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(': live\n\n');clients.add(res);res.on('close',()=>clients.delete(res));return;}
 if(url.pathname==='/test/status')return json({reads,elapsed:now(),clients:clients.size});
 if(url.pathname==='/test/stop'){json({stopped:true});setTimeout(()=>process.exit(0),100);return;}
 const files={'/':'index.html','/app.js':'app.js','/markdown.js':'markdown.js','/marked.js':'marked.js','/lucide.js':'lucide.js','/style.css':'style.css'};
 files['/theme.css']='theme.css';files['/connections-ui.js']='connections-ui.js';
 if(!files[url.pathname]){res.writeHead(404);res.end();return;}
 const bytes=await readFile(fileURLToPath(new URL('../public/'+files[url.pathname],import.meta.url)));
 res.writeHead(200,{'Content-Type':url.pathname.endsWith('.js')?'text/javascript':url.pathname.endsWith('.css')?'text/css':'text/html'});res.end(bytes);
});
server.listen(47839,'127.0.0.1',()=>console.log('Streaming fixture: http://127.0.0.1:47839'));

// Browser regression fixture: serves the production UI but never emits SSE events.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const rootId='10000000-0000-0000-0000-000000000001';
const branchId='10000000-0000-0000-0000-000000000002';
const rootTurn={id:'root-turn',status:'completed',items:[{type:'userMessage',content:[{type:'text',text:'同步回归测试'}]}]};
let reads=0;
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 const json=value=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 if(url.pathname==='/api/session')return json({token:'fixture',connected:true,active:{[branchId]:'pending-turn'}});
 if(url.pathname==='/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(': no events\n\n');return;}
 if(url.pathname==='/api/threads')return json({threads:[{id:rootId,title:'状态同步回归测试'}]});
 if(url.pathname==='/api/tree'){
  const completed=++reads>1;
  return json({root:{id:rootId,turns:[rootTurn]},active:completed?{}:{[branchId]:'pending-turn'},branches:[{
   id:branchId,parentId:rootId,rootId,pivotTurnId:rootTurn.id,prefixCount:1,name:'无完成通知的分支',thread:{id:branchId,turns:[rootTurn,{
    id:'pending-turn',status:completed?'completed':'inProgress',startedAt:Math.floor(Date.now()/1000)-10,durationMs:10000,
    items:[{type:'userMessage',content:[{type:'text',text:'测试问题'}]},...(completed?[{type:'agentMessage',id:'answer',text:'轮询已恢复回答',phase:'final_answer'}]:[])],
   }]},
  }]});
 }
 if(url.pathname==='/test/status')return json({reads});
 if(url.pathname==='/test/stop'){json({stopped:true});setTimeout(()=>process.exit(0),100);return;}
 const files={'/':'index.html','/app.js':'app.js','/markdown.js':'markdown.js','/marked.js':'marked.js','/lucide.js':'lucide.js','/style.css':'style.css'};
 files['/theme.css']='theme.css';files['/connections-ui.js']='connections-ui.js';
 if(!files[url.pathname]){res.writeHead(404);res.end();return;}
 const bytes=await readFile(fileURLToPath(new URL('../public/'+files[url.pathname],import.meta.url)));
 res.writeHead(200,{'Content-Type':url.pathname.endsWith('.js')?'text/javascript':url.pathname.endsWith('.css')?'text/css':'text/html'});res.end(bytes);
});
server.listen(47839,'127.0.0.1',()=>console.log('Regression fixture: http://127.0.0.1:47839'));

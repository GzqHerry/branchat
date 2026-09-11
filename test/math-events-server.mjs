import http from 'node:http';
import {readFile} from 'node:fs/promises';
const rootId='40000000-0000-0000-0000-000000000001',branchId='40000000-0000-0000-0000-000000000002';
const text=String.raw`## PPO 的策略与目标

在状态 \(s\) 下选择动作 \(a\)，策略参数为 $\theta$。

\[
\pi_\theta(a\mid s)
\]

优势函数：

\[ A_t \approx \text{采取该动作后的预期回报} - \text{当前状态的预期回报} \]

\[
r_t(\theta)=\frac{\pi_\theta(a_t\mid s_t)}{\pi_{\theta_{\mathrm{old}}}(a_t\mid s_t)}
\]

$$
L^{\mathrm{clip}}(\theta)=\mathbb{E}_t\left[\min\left(r_t(\theta)A_t,\operatorname{clip}\left(r_t(\theta),1-\epsilon,1+\epsilon\right)A_t\right)\right]
$$

| 概率比 $r_t$ | 贡献 |
| --- | --- |
| 1.1 | \(1.1A_t\) |
| 1.5 | \(1.2A_t\) |

- 当 \(A_t>0\) 时，提高该动作的概率。
- 当 \(A_t<0\) 时，降低该动作的概率。

> 方差为 \(\sigma^2\)。

\[ \begin{pmatrix} a & b \\ c & d \end{pmatrix} \]

\[ x_1+x_2+x_3+x_4+x_5+x_6+x_7+x_8+x_9+x_{10}+x_{11}+x_{12}+x_{13}+x_{14}+x_{15}+x_{16}+x_{17}+x_{18}+x_{19}+x_{20} \]

价格 $20 和 $30，转义价格 \$40。

错误公式：\(\frac{1}\)。其后的公式 $x^2$ 正常。

递归宏：\(\def\a{\a}\a\)。

受限指令：\(\href{javascript:alert(1)}{click}\)。

<script>window.unsafeMath=true</script>
`+'\n代码 `\\(x^2\\)` 不应渲染。\n\n```latex\n\\[ x^2 \\]\n```\n';
const user=(id,text)=>({type:'userMessage',id,content:[{type:'text',text}]});
const base={id:'ppo',status:'completed',items:[user('q','解释 PPO（强化学习）'),{type:'agentMessage',id:'ppo-answer',phase:'final_answer',text}]};
const turn={id:'stream',status:'inProgress',startedAt:Date.now()/1000,items:[user('stream-q','验证流式公式')]};
let step=0;const clients=new Set();
const snapshot=()=>({root:{id:rootId,turns:[base]},branches:[{id:branchId,parentId:rootId,rootId,pivotTurnId:base.id,prefixCount:1,name:'公式流式验证',thread:{id:branchId,turns:[base,turn]}}],active:turn.status==='inProgress'?{[branchId]:turn.id}:{}});
function emit(method,params){for(const client of clients)client.write('data: '+JSON.stringify({method,params:{threadId:branchId,turnId:turn.id,...params}})+'\n\n');}
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');const json=value=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:");
 if(url.pathname==='/favicon.ico'){res.writeHead(204);return res.end();}
 if(url.pathname==='/api/session')return json({token:'test',active:snapshot().active});
 if(url.pathname==='/api/threads')return json({threads:[{id:rootId,title:'PPO 公式显示验证',updated_at:Date.now()/1000}]});
 if(url.pathname==='/api/tree')return json(snapshot());
 if(url.pathname==='/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(': live\n\n');clients.add(res);res.on('close',()=>clients.delete(res));return;}
 if(url.pathname==='/test/advance'&&req.method==='POST'){
   step++;
   if(step===1){const item={type:'agentMessage',id:'live-answer',text:'',phase:'final_answer'};turn.items.push(item);emit('item/started',{item});item.text=String.raw`正在输出 \(A_t`;emit('item/agentMessage/delta',{itemId:item.id,delta:item.text});}
   if(step===2){const delta=String.raw`>0\)，以及 $$\frac{1}{2}$$。`;turn.items.at(-1).text+=delta;emit('item/agentMessage/delta',{itemId:'live-answer',delta});}
   if(step===3){turn.status='completed';emit('turn/completed',{turn});}
   return json({step});
 }
 if(url.pathname==='/test/stop'){json({stopped:true});setTimeout(()=>process.exit(0),100);return;}
 const files={'/':'index.html','/app.js':'app.js','/markdown.js':'markdown.js','/marked.js':'marked.js','/lucide.js':'lucide.js','/style.css':'style.css','/theme.css':'theme.css','/connections-ui.js':'connections-ui.js'};
 if(!files[url.pathname]){res.writeHead(404);return res.end();}
 res.writeHead(200,{'Content-Type':url.pathname.endsWith('.js')?'text/javascript':url.pathname.endsWith('.css')?'text/css':'text/html'});res.end(await readFile(new URL('../public/'+files[url.pathname],import.meta.url)));
});
server.listen(Number(process.env.PORT||47842),'127.0.0.1',()=>console.log('Math fixture ready'));

import {remoteId, apiBase, scopedStorage, storagePrefix, connectionLabel, gatewayHeaders, prepareConnection, initConnections} from './connections-ui.js';
const treeStorage=scopedStorage(window.localStorage), treeSession=scopedStorage(window.sessionStorage);
import {markdown} from './markdown.js';
const $ = id => document.getElementById(id);
const icon = name => {const i=document.createElement('i');i.dataset.lucide=name;return i;};
const icons = () => window.lucide?.createIcons();
let token='', catalog=[], snapshot=null, selected=null, busy=false, requestSeq=0;
const collapsed=new Set();
let drafts={};try{drafts=JSON.parse(treeStorage.getItem('tree-drafts')||'{}')}catch{}
let lastRoot=treeStorage.getItem('tree-root');
let eventSource;
let pendingNew=false,features=new Set(),newConversationCwd='',newConversationShared=false;
let modelChoice=treeStorage.getItem('tree-model')||'';
let executionUI,modelUI;
const stoppingThreads=new Set(),staleWriterThreads=new Set();
function queueStopKey(id){return 'tree-queue-stop:'+id;}
function queueStopped(id){return treeStorage.getItem(queueStopKey(id))==='true';}
function modelSettings(){return modelUI?.settings()||{model:$('model-select')?.value};}
const queueStorage='tree-question-queues';
let questionQueues={};try{questionQueues=JSON.parse(treeStorage.getItem(queueStorage)||'{}');}catch{}
let queuePumpRunning=false,queueRenderKey='',queueEnqueuePending=false;
let questionDeleteTarget=null;
let deleteTarget=null,deleteUndo=null;
try{deleteUndo=JSON.parse(treeStorage.getItem('tree-delete-undo')||'null');}catch{}
function showDeleteUndo(){
 $('branch-toast').hidden=!deleteUndo;
 $('branch-toast-text').textContent=deleteUndo?'已删除“'+deleteUndo.name+'”'+(deleteUndo.count>1?'及 '+(deleteUndo.count-1)+' 个子分支':''):'';
 try{if(deleteUndo)treeStorage.setItem('tree-delete-undo',JSON.stringify(deleteUndo));else treeStorage.removeItem('tree-delete-undo');}catch{}
}
showDeleteUndo();
function deletionScope(id){
 const ids=new Set([id]);for(const parent of ids)for(const branch of snapshot?.branches||[])if(branch.parentId===parent)ids.add(branch.id);
 return (snapshot?.branches||[]).filter(b=>ids.has(b.id));
}
let preferences={theme:'system',palette:'green'};
try{Object.assign(preferences,JSON.parse(treeStorage.getItem('tree-appearance')||'{}'));}catch{}
const systemTheme=matchMedia('(prefers-color-scheme: dark)');
const paletteNames={green:'松绿',blue:'湖蓝',rose:'玫红',amber:'琥珀',graphite:'石墨'};
function applyAppearance(){
 if(!['light','dark','system'].includes(preferences.theme))preferences.theme='system';
 if(!paletteNames[preferences.palette])preferences.palette='green';
 document.documentElement.dataset.theme=preferences.theme==='system'?(systemTheme.matches?'dark':'light'):preferences.theme;
 document.documentElement.dataset.palette=preferences.palette;
 document.querySelector('input[name="theme"][value="'+preferences.theme+'"]').checked=true;
 document.querySelector('input[name="palette"][value="'+preferences.palette+'"]').checked=true;
 $('palette-name').textContent=paletteNames[preferences.palette];
 try{treeStorage.setItem('tree-appearance',JSON.stringify(preferences));}catch{}
}
applyAppearance();systemTheme.addEventListener('change',applyAppearance);
$('appearance').onclick=()=>$('settings-dialog').showModal();
$('close-settings').onclick=()=>$('settings-dialog').close();
$('settings-dialog').onchange=e=>{if(['theme','palette'].includes(e.target.name)){preferences[e.target.name]=e.target.value;applyAppearance();}};
let livePhases={};try{livePhases=JSON.parse(treeSession.getItem('tree-live-phases')||'{}')}catch{}
const phaseKey=(threadId,turnId)=>threadId+':'+turnId;
const expandedActivity=new Map();
const turnActivityState=new Map();
function activitySettled(turn){return turn.status!=='inProgress'||turn.items.some(i=>i.type==='agentMessage'&&i.phase!=='commentary'&&i.text?.trim());}
function activityState(thread,turn){
 const key=phaseKey(thread.id,turn.id),settled=activitySettled(turn);let state=turnActivityState.get(key);
 if(!state){state={settled,open:!settled};turnActivityState.set(key,state);}
 else if(settled&&!state.settled){state.settled=true;state.open=false;}
 return state;
}
function updateTurnActivity(thread,turn){
 const group=$('activity-'+phaseKey(thread.id,turn.id));if(!group)return;
 const state=activityState(thread,turn);if(group.open!==state.open)group.open=state.open;
 const count=turn.items.filter(i=>!['userMessage','reasoning'].includes(i.type)&&(i.type!=='agentMessage'||i.phase==='commentary')).length;
 const observed=livePhases[phaseKey(thread.id,turn.id)],elapsed=turn.durationMs||(turn.startedAt?(turn.completedAt?turn.completedAt*1000:Date.now())-turn.startedAt*1000:0);
 group.querySelector('.turn-activity-label').textContent=(!state.settled?'正在处理':turn.status==='failed'?'处理记录 · 未完成':turn.status==='interrupted'?'处理记录 · 已停止':'处理记录')+(count?' · '+count+' 项':'')+(elapsed?' · '+clockText(elapsed):observed?.thinkingMs?' · 已思考 '+clockText(observed.thinkingMs):'');
 group.classList.toggle('is-processing',!state.settled);
}
function turnActivity(thread,turn){
 const group=document.createElement('details');group.id='activity-'+phaseKey(thread.id,turn.id);group.className='turn-activity';group.dataset.turnId=turn.id;
 const summary=document.createElement('summary'),label=document.createElement('span');label.className='turn-activity-label';summary.append(icon('list-checks'),label);group.append(summary);
 group.open=activityState(thread,turn).open;
 const body=document.createElement('div');body.className='turn-activity-body';group.append(body);
 group.ontoggle=()=>{if(!group.isConnected)return;activityState(thread,turn).open=group.open;};
 return {group,body};
}
const streamRenders=new Map();let streamFrame=0;
function renderStream(content,item){
 streamRenders.set(item.id,{content,item});
 if(streamFrame)return;
 streamFrame=requestAnimationFrame(()=>{
   streamFrame=0;beforeOutput();let changed=false;
   for(const {content,item} of streamRenders.values()){
     if(!content.isConnected)continue;
     if(item.phase==='commentary')content.textContent=item.text;
     else content.replaceChildren(markdown(item.text));
     enhanceContent(content);changed=true;
   }
   streamRenders.clear();icons();afterOutput(changed);
 });
}
let followOutput=true,scrollUpdating=false,scrollFrame=0,unreadOutput=false,visibleSignature='';
function updateLatest(){
 $('latest').hidden=followOutput;$('latest-label').hidden=!unreadOutput;
 $('latest').setAttribute('aria-label',unreadOutput?'有新内容，回到最新输出':'回到最新输出');
}
function beforeOutput(){scrollUpdating=true;}
function afterOutput(changed=false,oldScroll=null){
 const list=$('messages');
 if(changed&&!followOutput)unreadOutput=true;
 if(followOutput){list.scrollTop=list.scrollHeight;unreadOutput=false;}
 else if(oldScroll!==null)list.scrollTop=oldScroll;
 updateLatest();cancelAnimationFrame(scrollFrame);
 // DOM growth and scroll anchoring must not be mistaken for the reader scrolling up.
 scrollFrame=requestAnimationFrame(()=>{if(followOutput)list.scrollTop=list.scrollHeight;scrollUpdating=false;});
}
$('messages').addEventListener('scroll',()=>{
 if(scrollUpdating)return;
 const list=$('messages');followOutput=list.scrollHeight-list.clientHeight-list.scrollTop<60;
 if(followOutput)unreadOutput=false;updateLatest();
});
$('latest').onclick=()=>{followOutput=true;beforeOutput();afterOutput();};
new ResizeObserver(()=>{beforeOutput();afterOutput();}).observe($('messages'));
function savePhases(){try{treeSession.setItem('tree-live-phases',JSON.stringify(livePhases))}catch{}}
function clockText(ms){const seconds=Math.max(0,Math.floor(ms/1000));return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');}
function phaseText(thread,turn){
 const state=livePhases[phaseKey(thread.id,turn.id)];
 const start=state?.startedAt||turn.startedAt*1000;
 const elapsed=start?Date.now()-start:0;
 if(!record(thread.id))return {label:'IDE 正在处理 · '+clockText(elapsed),detail:'原对话'};
 if(state?.phase==='thinking')return {label:'思考中 · '+clockText((state.thinkingMs||0)+Date.now()-state.thinkingAt),detail:'本轮已用 '+clockText(elapsed)};
 const stage=state?.phase==='answering'?'正在回答':state?.phase==='working'?'正在处理':'等待模型';
 return {label:stage+' · '+clockText(elapsed),detail:state?.thinkingMs?'已思考 '+clockText(state.thinkingMs):'本轮计时'};
}
function currentRun(){const t=current();const id=snapshot?.active?.[t?.id];const turn=t?.turns.find(t=>t.id===id)||t?.turns.at(-1);return turn&&(turn.status==='inProgress'||id===turn.id)?{thread:t,turn}:null;}
function updateLiveProgress(){
 const run=currentRun();
 const shown=run&&(!selected.turnId||selected.turnId===run.turn.id);
 let panel=$('live-progress');
 if(!shown){if(panel){beforeOutput();panel.remove();afterOutput();}return;}
 beforeOutput();
 if(!panel){panel=document.createElement('div');panel.id='live-progress';panel.className='live-progress';panel.setAttribute('role','status');panel.append(icon('loader-circle'));const text=document.createElement('div');text.className='live-copy';const label=document.createElement('strong');label.id='live-label';const detail=document.createElement('span');detail.id='live-detail';text.append(label,detail);panel.append(text);$('messages').append(panel);icons();}
 const state=phaseText(run.thread,run.turn);$('live-label').textContent=state.label;$('live-detail').textContent=state.detail;
 afterOutput();
}
function error(e){const text=e.message||String(e);if(/active writer|已有回答正在进行/i.test(text)&&selected?.threadId)staleWriterThreads.add(selected.threadId);$('notice').textContent=text;$('notice').hidden=false;const modal=[...document.querySelectorAll('dialog[open]')].at(-1);if(modal){let alert=modal.querySelector('.dialog-error');if(!alert){alert=document.createElement('p');alert.className='dialog-error';alert.setAttribute('role','alert');modal.querySelector('.dialog-head')?.after(alert);if(!alert.parentNode)modal.prepend(alert);}alert.textContent=text;}}
function clearError(){$('notice').hidden=true;document.querySelectorAll('.dialog-error').forEach(el=>el.remove());}
async function api(endpoint, body){
 if(body&&['new','send','fork','lightweight'].includes(endpoint)&&features.has('local-edit')&&!features.has('automatic-edit'))throw new Error('后台仍是旧版。请双击 Restart.cmd 重启一次，启用默认文件编辑和下方授权提示。你的输入会保留。');
 // Older running services decoded HTTP chunks separately. JSON Unicode escapes
 // keep their requests ASCII until a service with buffered UTF-8 parsing starts.
 let payload=body?JSON.stringify(body):undefined;
 if(payload&&!features.has('utf8-body'))payload=payload.replace(/[^\x00-\x7f]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
 try{
   const historyRead=endpoint.startsWith('tree?')||endpoint==='threads';
   const response=await fetch(apiBase+endpoint,body?{method:'POST',headers:{'Content-Type':'application/json','X-Tree-Token':token,...gatewayHeaders()},body:payload,...(endpoint==='stop'?{signal:AbortSignal.timeout(15000)}:{})}:{signal:AbortSignal.timeout(endpoint==='export'?300000:historyRead?(remoteId?90000:60000):endpoint.startsWith('search?')?60000:20000)});
   const data=await response.json();if(!response.ok){const failure=new Error(data.error||'请求失败');failure.httpStatus=response.status;throw failure;}return data;
 }catch(e){
   if(e.name==='TimeoutError'||/signal timed out/i.test(e.message)){if(endpoint==='stop')throw new Error('停止请求等待超过 15 秒，还未收到确认');const failure=new Error('读取'+(endpoint.startsWith('tree?')?'对话历史':'服务状态')+'超时，可能是历史较大或连接较慢。输入已保留；此提示不代表提问发送失败。');failure.code='READ_TIMEOUT';throw failure;}
   throw e;
 }
}
function draftKey(){return selected ? selected.threadId+':'+(selected.turnId||'leaf') : '';}
function persistDraft(){if(!selected)return;drafts[draftKey()]=$('prompt').value;try{treeStorage.setItem('tree-drafts',JSON.stringify(drafts))}catch{}}
function threads(){return snapshot?[snapshot.root,...snapshot.branches.filter(b=>b.thread).map(b=>b.thread)]:[];}
function record(id){return snapshot?.rootRecord&&snapshot.rootRecord.id===id?snapshot.rootRecord:snapshot?.branches.find(b=>b.id===id);}
function current(){return threads().find(t=>t.id===selected?.threadId);}
function promptText(turn){const text=turn.items.filter(i=>i.type==='userMessage').flatMap(i=>i.content.filter(c=>c.type==='text').map(c=>c.text)).join('\n').trim();return (text.startsWith('<in-app-browser-context')||text.startsWith('# Files mentioned by the user:'))&&text.includes('## My request:')?text.slice(text.indexOf('## My request:')+14).trim():text;}
function currentPivot(){return current()?.turns.find(t=>t.id===selected?.turnId);}
function isLeaf(){const t=current();return !!record(t?.id)&&(!selected.turnId||t.turns.at(-1)?.id===selected.turnId);}
function canContinueInPlace(){const t=current(),pivot=currentPivot();if(!record(t?.id)||!t||record(t.id)?.imported)return false;if(isLeaf())return true;return !!pivot&&['failed','interrupted'].includes(pivot.status)&&t.turns.at(-1)?.id===pivot.id;}
function canFork(){const t=currentPivot();return t&&t.status!=='inProgress';}
function updateComposer(){
 executionUI?.update();
 for(const thread of threads())for(const turn of thread.turns)updateTurnActivity(thread,turn);
 const t=current();const run=currentRun();const running=!!run;
 const imported=record(t?.id)?.imported;
 const allowed=pendingNew||!!t&&!imported&&(canContinueInPlace()||canFork());
 const queueable=!!t&&isLeaf()&&!imported;
 const queued=questionQueues[t?.id]?.items?.length>0;
 const stateText=$('run-state')?.textContent||'';
 const remoteUiRunning=$('prompt')?.disabled&&/处理中|等待模型|重连中|回答中/.test(stateText);
 $('prompt').disabled=busy||!allowed;
 $('send').disabled=busy||queueEnqueuePending||!allowed||!$('prompt').value.trim();
 const enqueue=queueable&&(running||queued);
 $('send').title=enqueue?'加入提问队列':'发送提问';$('send').setAttribute('aria-label',$('send').title);
 const sendMode=enqueue?'queue':'send';if($('send').dataset.mode!==sendMode){$('send').dataset.mode=sendMode;$('send').replaceChildren(icon(enqueue?'list-plus':'arrow-up'));icons();}
 $('prompt').placeholder=enqueue?'输入下一个问题，Enter 加入队列…':'继续提问…';
 if($('compose-hint'))$('compose-hint').textContent=enqueue?'Enter 排队 · Shift + Enter 换行':'Enter 发送 · Shift + Enter 换行';
 $('fork').disabled=busy||!canFork()||imported;
 const deletable=snapshot?.branches.some(b=>b.id===selected?.threadId);
 $('delete-branch').hidden=!deletable;
 const deletionRunning=deletable&&deletionScope(selected.threadId).some(b=>snapshot.active[b.id]||b.thread?.turns.some(turn=>turn.status==='inProgress'));
 $('delete-branch').disabled=busy||deletionRunning;
 $('delete-branch').title=deletionRunning?'请先停止该分支及子分支的回答':'删除分支';
 $('undo-delete').disabled=busy;
 const remoteWriterError=/active writer|已有回答正在进行/i.test($('notice')?.textContent||'');
 // Remote SSH runs may stream status without populating the local currentRun map.
 // Use the visible composer state as a fallback so an active remote answer always
 // exposes the stop control instead of leaving the user with a disabled composer.
 const stopping=stoppingThreads.has(t?.id);
 const activeUi=running||remoteUiRunning||staleWriterThreads.has(t?.id)||remoteWriterError;
 if(activeUi){
   $('send').hidden=false;$('send').disabled=busy||stopping;$('send').title=stopping?'正在停止…':'停止回答';$('send').setAttribute('aria-label',$('send').title);
   if($('send').dataset.mode!=='stop'){$('send').dataset.mode='stop';$('send').replaceChildren(icon('square'));icons();}
   $('stop').hidden=true;
 }else{
   $('stop').hidden=true;$('send').hidden=false;
 }
 $('stop').disabled=stoppingThreads.has(t?.id);$('stop').title=stoppingThreads.has(t?.id)?'正在请求停止…':'停止回答';$('stop').setAttribute('aria-label',$('stop').title);
 for(const id of ['new-chat','history-new','conversation'])$(id).disabled=busy;
 $('destination').textContent=pendingNew?'新对话':!t?'尚未选择提问':isLeaf()?'继续：'+record(t.id).name:canFork()?'发送后从此提问创建新分支':'当前提问尚未结束';
 const last=t?.turns.at(-1);
 $('run-state').textContent=busy?'处理中…':running?phaseText(t,run.turn).label:last?.status==='completed'&&record(t?.id)?'已完成'+(last.durationMs?' · '+Math.round(last.durationMs/1000)+' 秒':''):'就绪';
 if($('model-select')){const wanted=modelChoice||t?.model;if(wanted&&[...$('model-select').options].some(o=>o.value===wanted))$('model-select').value=wanted;}
 modelUI?.update();
 updateUsage();
 resizePrompt();
 updateLiveProgress();
 renderQuestionQueue();
}
function conversationTitle(t){return (t?.name||t?.title||t?.first_user_message||'未命名对话').replace(/\s+/g,' ').trim().slice(0,160);}
function conversationGroup(t){
 const today=new Date();today.setHours(0,0,0,0);
 const stamp=Number(t.updated_at||0)*1000;
 if(stamp>=today.getTime())return '今天';
 const yesterday=new Date(today);yesterday.setDate(yesterday.getDate()-1);
 if(stamp>=yesterday.getTime())return '昨天';
 const week=new Date(today);week.setDate(week.getDate()-6);
 return stamp>=week.getTime()?'最近 7 天':'更早';
}
function renderHistory(){
 const query=$('history-search').value.trim().toLocaleLowerCase();
 const items=catalog.filter(t=>($('archived').checked||!t.archived)&&(!query||(conversationTitle(t)+' '+(t.cwd||'')).toLocaleLowerCase().includes(query))).sort((a,b)=>(b.updated_at||0)-(a.updated_at||0));
 $('history-count').textContent=items.length+' 个对话';const list=$('history-list');list.replaceChildren();let group='';
 for(const t of items){
   const nextGroup=conversationGroup(t);
   if(nextGroup!==group){const heading=document.createElement('div');heading.className='history-group';heading.textContent=nextGroup;list.append(heading);group=nextGroup;}
   const button=document.createElement('button');button.className='history-entry'+(!pendingNew&&t.id===lastRoot?' selected':'');button.dataset.id=t.id;
   button.setAttribute('aria-current',String(!pendingNew&&t.id===lastRoot));button.append(icon(t.source==='web'?'message-circle':'panel-left'));
   const copy=document.createElement('span');copy.className='history-copy';const title=document.createElement('strong');title.textContent=conversationTitle(t);copy.append(title);
   const meta=document.createElement('span');meta.className='history-meta';meta.textContent=(t.source==='web'?'网页对话':remoteId?'远程 Codex':'Codex IDE')+(t.cwd?' · '+t.cwd.split(/[\\/]/).filter(Boolean).at(-1):'')+(t.archived?' · 已归档':'');copy.append(meta);button.append(copy);
   const time=document.createElement('time');const date=new Date(Number(t.updated_at||0)*1000);
   time.textContent=t.updated_at?date.toLocaleDateString('zh-CN',{month:'2-digit',day:'2-digit'}):'';time.title=t.updated_at?date.toLocaleString('zh-CN'):'';button.append(time);
   if(!pendingNew&&t.id===lastRoot)button.append(icon('check'));
   button.onclick=()=>{if(busy)return;$('history-dialog').close();act(async()=>{await loadTree(t.id);});};list.append(button);
 }
 if(!items.length){const empty=document.createElement('p');empty.className='history-empty';empty.textContent=query?'没有匹配的对话':'暂无历史对话';list.append(empty);}icons();
}
async function loadCatalog(choose=true){
 const data=await api('threads');catalog=data.threads;libraryMetadata=data.metadata||libraryMetadata;
 const items=catalog.filter(t=>$('archived').checked||!t.archived);
 renderHistory();if(!choose)return;
 if(pendingNew||treeStorage.getItem('tree-new')==='true'){startNew();return;}
 const initial=items.find(t=>t.id===lastRoot)||items[0];
 if(initial)await loadTree(initial.id);else startNew();
}
function startNew(){
 const chosen=window.prompt('新对话工作路径（留空使用默认目录）',newConversationCwd||'');
 if(chosen===null)return;
 newConversationCwd=chosen.trim();
 newConversationShared=window.confirm('将此对话设为公开会话？\n公开会话会显示给同一 SSH 用户的其他网页窗口。');
 saveReading();
 persistDraft();requestSeq++;pendingNew=true;snapshot=null;selected={threadId:'new',turnId:null};treeStorage.setItem('tree-new','true');
 $('conversation-label').textContent='新对话';$('source-kind').textContent='网页对话';$('branch-type').textContent='网页对话';$('branch-name').textContent='新对话';$('rename').hidden=true;
 $('tree').replaceChildren();$('count').textContent='0 个提问';$('branch-count').textContent='0 个分支';
 beforeOutput();$('messages').replaceChildren();const empty=document.createElement('div');empty.className='empty';empty.append(icon('messages-square'));const title=document.createElement('p');title.textContent='新对话';empty.append(title);$('messages').append(empty);followOutput=true;afterOutput();
 $('prompt').value=drafts[draftKey()]||'';clearError();updateComposer();icons();$('prompt').focus();
 renderWorkbench();
}
$('new-chat').onclick=()=>{if(!busy)startNew();};
$('history-new').onclick=()=>{if(!busy){$('history-dialog').close();startNew();}};
$('conversation').onclick=()=>{$('history-search').value='';renderHistory();$('history-dialog').showModal();$('history-search').focus();loadCatalog(false).catch(error);};
$('close-history').onclick=()=>$('history-dialog').close();
$('history-search').oninput=renderHistory;
$('history-dialog').onkeydown=e=>{
 const entries=[...$('history-list').querySelectorAll('.history-entry')];const index=entries.indexOf(document.activeElement);
 if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();entries[Math.max(0,Math.min(entries.length-1,index+(e.key==='ArrowDown'?1:-1)))]?.focus();}
 if(e.key==='Enter'&&document.activeElement===$('history-search')){e.preventDefault();entries[0]?.click();}
};
async function loadTree(id,keep=false){
 if(!keep)saveReading();
 const previousSelection=selected;
 const followLatest=keep&&selected?.turnId===current()?.turns.at(-1)?.id;
 const seq=++requestSeq;const data=await api('tree?id='+encodeURIComponent(id));if(seq!==requestSeq)return;
 // A status request can finish after the user has typed or selected another branch.
 // Save the latest draft at commit time, not before starting the request.
 persistDraft();
 // Keep newer SSE content when a slower history request returns an older snapshot.
 for(const branch of [...data.branches,...(data.rootRecord?[{id:data.root.id,thread:data.root}]:[])]){
   const live=threads().find(t=>t.id===branch.id);
   if(!live||!branch.thread)continue;
   if((live.contextRevision||0)!==(branch.thread.contextRevision||0))continue;
   for(const oldTurn of live.turns){
     if(!livePhases[phaseKey(branch.id,oldTurn.id)])continue;
     const index=branch.thread.turns.findIndex(t=>t.id===oldTurn.id);
     if(index<0){branch.thread.turns.push(oldTurn);continue;}
     const fetched=branch.thread.turns[index];
     if(fetched.status!=='inProgress')continue;
     if(oldTurn.status!=='inProgress'){branch.thread.turns[index]=oldTurn;delete data.active[branch.id];continue;}
     // While receiving this turn's stream, use its ordered events for partial
     // text. A history response can otherwise include a delta still in transit.
     if(livePhases[phaseKey(branch.id,oldTurn.id)].streamObserved){branch.thread.turns[index]=oldTurn;continue;}
     for(const item of oldTurn.items){
       const pos=fetched.items.findIndex(i=>i.id===item.id);
       if(pos<0)fetched.items.push(item);
       else if(item.type==='agentMessage'&&item.text?.startsWith(fetched.items[pos].text||''))fetched.items[pos]=item;
     }
   }
 }
 snapshot=data;libraryMetadata=data.metadata||libraryMetadata;pendingNew=false;treeStorage.removeItem('tree-new');lastRoot=data.root.id;treeStorage.setItem('tree-root',lastRoot);
 $('conversation-label').textContent=data.rootRecord?.name||conversationTitle(catalog.find(t=>t.id===lastRoot));$('source-kind').textContent=data.rootRecord?'网页对话':remoteId?'远程 Codex':'Codex IDE';
 if(!keep||!threads().some(t=>t.id===selected?.threadId)){
   selected={threadId:data.root.id,turnId:data.root.turns.at(-1)?.id||null};
 }else if(followLatest&&selected===previousSelection){
   const latest=current()?.turns.at(-1)?.id;
   if(latest&&latest!==selected.turnId){const oldDraft=draftKey(),text=$('prompt').value;selected={threadId:selected.threadId,turnId:latest};if(text&&!drafts[draftKey()]){drafts[draftKey()]=text;delete drafts[oldDraft];try{treeStorage.setItem('tree-drafts',JSON.stringify(drafts));}catch{}}}
 }
 if(selected?.turnId&&!current()?.turns.some(t=>t.id===selected.turnId))selected={threadId:selected.threadId,turnId:current()?.turns.at(-1)?.id||null};
 renderTree();renderChat(keep);$('prompt').value=drafts[draftKey()]||'';updateComposer();
}
function select(threadId,turnId){if(busy)return;saveReading();persistDraft();selected={threadId,turnId};markRead();renderTree();renderChat();$('prompt').value=drafts[draftKey()]||'';updateComposer();}
function renderTree(){
 if(!snapshot)return;
 const nav=$('tree');nav.replaceChildren();
 const query=$('search').value.toLocaleLowerCase();let count=0;
 const branchMap=new Map(snapshot.branches.filter(b=>b.thread).map(b=>[b.id,b]));
 const childrenOf=(tid,pivot)=>[...branchMap.values()].filter(b=>b.parentId===tid&&b.pivotTurnId===pivot);
 const ul=document.createElement('ul');
 const makeRow=(label,tid,turn,branch=false)=>{
   const li=document.createElement('li');const row=document.createElement('div');row.className='tree-row';
   const key=tid+':'+(turn?.id||'leaf');
   const btn=document.createElement('button');btn.className='node'+(branch?' branch-node':'');btn.title=label;btn.setAttribute('aria-label',label);btn.dataset.key=key;
   if(selected?.threadId===tid&&selected?.turnId===(turn?.id||null))btn.classList.add('active');
   btn.append(icon(branch?'git-branch':'message-circle'));const span=document.createElement('span');span.className='label';span.textContent=label;btn.append(span);
   if(turn?.status==='inProgress'){const state=document.createElement('span');state.className='state';state.textContent='进行中';btn.append(state);}
   btn.onclick=()=>select(tid,turn?.id||null);row.append(btn);li.append(row);return {li,row,key};
 };
 const branchNode=(branch,parent,seen)=>{
   if(seen.has(branch.id))return;const nextSeen=new Set([...seen,branch.id]);
   const {li,row,key}=makeRow(branch.name,branch.id,null,true);parent.append(li);
   const children=document.createElement('ul');li.append(children);
   sequence(branch.thread,branch.prefixCount,children,nextSeen);
   addToggle(row,key,children);
 };
 const addToggle=(row,key,children)=>{
   if(!children.children.length)return;
   const button=document.createElement('button');button.className='icon chevron';button.title=collapsed.has(key)?'展开':'收起';button.setAttribute('aria-label',button.title);button.setAttribute('aria-expanded',String(!collapsed.has(key)));button.append(icon(collapsed.has(key)?'chevron-right':'chevron-down'));button.onclick=()=>{collapsed.has(key)?collapsed.delete(key):collapsed.add(key);renderTree();};row.prepend(button);children.hidden=collapsed.has(key)&&!query;
 };
 const sequence=(thread,start,parent,seen)=>{
   for(let i=start;i<thread.turns.length;i++){
     const turn=thread.turns[i],text=promptText(turn);if(!text)continue;count++;
     const children=document.createElement('ul');
     if(!query||text.toLocaleLowerCase().includes(query)){
       const {li,row,key}=makeRow(text,thread.id,turn);parent.append(li);li.append(children);
       const remove=toolButton('trash-2','删除此提问及后续内容',()=>openQuestionDeletion(thread.id,turn.id));remove.classList.add('tree-question-delete');remove.disabled=busy||turn.status==='inProgress';row.append(remove);
       for(const child of childrenOf(thread.id,turn.id))branchNode(child,children,seen);
       // Continuations stay on this level; only forks belong beneath a question.
       addToggle(row,key,children);
     }else{
       for(const child of childrenOf(thread.id,turn.id))branchNode(child,parent,seen);
     }
   }
 };
 const rootLabel=document.createElement('div');rootLabel.className='tree-root-label';rootLabel.textContent=snapshot.rootRecord?'主对话':'原对话';nav.append(rootLabel);
 sequence(snapshot.root,0,ul,new Set());nav.append(ul);
 if(!ul.children.length){const empty=document.createElement('div');empty.className='empty-tree';empty.textContent=query?'没有匹配的提问':'暂无提问';nav.append(empty);}
 const total=snapshot.root.turns.filter(t=>promptText(t)).length+snapshot.branches.reduce((n,b)=>n+(b.thread?.turns.slice(b.prefixCount).filter(t=>promptText(t)).length||0),0);
 $('count').textContent=total+' 个提问';$('branch-count').textContent=snapshot.branches.length+' 个分支';decorateTree();icons();
}
function addMessage(type,text,label,target=$('messages')){
 const message=document.createElement('article');message.className='message '+type;
 const heading=document.createElement('div');heading.className='message-label';heading.append(icon(type==='user'?'user-round':'sparkles'));heading.append(document.createTextNode(label));
 const content=document.createElement('div');content.className='content';if(type==='assistant'){content.classList.add('markdown');content.append(markdown(text));}else content.textContent=text;message.append(heading,content);target.append(message);return content;
}
function activeTool(item,turn){return turn.status==='inProgress'&&['inProgress','running','pending'].includes(item.status);}
function toolTitle(item,running){
 if(item.type==='fileChange')return (running?'正在编辑文件':'文件编辑')+' · '+(item.changes?.map(c=>c.path.split(/[\\/]/).at(-1)).join('、')||'等待文件信息');
 if(item.type==='commandExecution')return running?'正在执行命令':'执行命令';
 if(item.type==='webSearch')return running?'正在搜索':'搜索';
 if(item.type==='contextCompaction')return '整理上下文';
 if(item.type==='plan')return '工作计划';
 return item.arguments?.title||item.tool||'执行记录';
}
function toolIcon(item){return item.type==='fileChange'?'file-pen-line':item.type==='commandExecution'?'terminal':item.type==='webSearch'?'search':item.type==='plan'?'list-checks':'wrench';}
function disclosure(key,label,className,build,defaultOpen=false){
 const details=document.createElement('details');details.className=className;details.dataset.activityKey=key;
 const summary=document.createElement('summary');summary.append(label);details.append(summary);
 details.open=expandedActivity.get(key)??defaultOpen;
 let body;
 const populate=()=>{if(details.open&&!body){body=document.createElement('div');body.className='activity-body';build(body);details.append(body);}};
 populate();
 details.ontoggle=()=>{
   if(!details.isConnected)return;
   expandedActivity.set(key,details.open);populate();icons();
 };
 return details;
}
function textBlock(parent,title,value){
 if(value===undefined||value===null||value==='')return;
 const label=document.createElement('div');label.className='activity-field';label.textContent=title;
 const pre=document.createElement('pre');pre.textContent=typeof value==='string'?value:JSON.stringify(value,null,2);parent.append(label,pre);
}
function toolDetails(item,turn,key){
 const running=activeTool(item,turn),label=document.createElement('span');label.className='activity-heading';
 label.append(icon(running?'loader-circle':toolIcon(item)));
 const title=document.createElement('span');title.className='activity-title';title.textContent=toolTitle(item,running);label.append(title);
 const status=document.createElement('span');status.className='activity-status';
 status.textContent=running?'进行中':item.status==='failed'?'失败':item.status==='declined'?'已拒绝':item.status==='completed'?'已完成':item.status||'';
 if(item.durationMs!=null)status.textContent+=' · '+clockText(item.durationMs);label.append(status);
 const details=disclosure(key,label,'tool-details activity-tool'+(running?' is-running':''),body=>{
   if(item.type==='fileChange'){
     for(const [index,change] of (item.changes||[]).entries()){
       const path=document.createElement('span');path.className='file-path';
       const kind=typeof change.kind==='string'?change.kind:change.kind?.type;
       path.textContent=({add:'新增',delete:'删除',update:'修改'}[kind]||'修改')+' · '+change.path;
       body.append(disclosure(key+':file:'+index,path,'file-change',diff=>{
         if(change.kind?.move_path)textBlock(diff,'移动到',change.kind.move_path);
         const pre=document.createElement('pre');pre.className='file-diff';
         for(const line of (change.diff||'暂无差异内容').split('\n')){
           const row=document.createElement('span');row.className=line.startsWith('+')?'diff-add':line.startsWith('-')?'diff-remove':'';row.textContent=line+'\n';pre.append(row);
         }
         diff.append(pre);
       }));
     }
   }else if(item.type==='commandExecution'){
     textBlock(body,'命令',item.command);textBlock(body,'目录',item.cwd);textBlock(body,'输出',item.aggregatedOutput);textBlock(body,'退出码',item.exitCode);
   }else{
     textBlock(body,'内容',item.text||item.query||item.action);
     textBlock(body,'参数',item.arguments);
     const result=item.result;
     textBlock(body,'结果',result?.content?result.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'):result);
     if(item.contentItems)textBlock(body,'输出',item.contentItems.filter(c=>c.type==='text'||c.type==='inputText').map(c=>c.text).join('\n'));
   }
   textBlock(body,'错误',item.error);
 });
 return details;
}
function addTools(items,turn,key,target=$('messages')){
 if(items.length===1){target.append(toolDetails(items[0],turn,key+':'+items[0].id));return;}
 const running=items.findLast(item=>activeTool(item,turn));
 const label=document.createElement('span');label.className='activity-heading';label.append(icon(running?'loader-circle':'list-checks'));
 const title=document.createElement('span');title.className='activity-title';title.textContent=(running?toolTitle(running,true):'执行记录')+' · '+items.length+' 项';label.append(title);
 const group=disclosure(key+':group:'+items[0].id,label,'tool-details activity-group'+(running?' is-running':''),body=>{
   for(const item of items)body.append(toolDetails(item,turn,key+':'+item.id));
 });
 target.append(group);
}
function renderChat(preserveScroll=false){
 const t=current();if(!t)return;
 const branch=record(t.id);$('branch-type').textContent=branch?(branch.imported?'导入记录':t.id===snapshot.root.id?'网页对话':(branch.lightweight?'轻量分支':'独立分支')+(branch.numberLabel?' · '+branch.numberLabel:'')):'原对话 · 只读';$('branch-name').textContent=branch?.name||conversationTitle(catalog.find(x=>x.id===t.id));$('rename').hidden=!branch;
 $('branch-name').title=$('branch-name').textContent;
 const end=selected.turnId?t.turns.findIndex(x=>x.id===selected.turnId):t.turns.length-1;
 const shownTurns=t.turns.slice(0,end+1);
 const signature=JSON.stringify([selected,shownTurns.map(turn=>[turn.id,turn.status,turn.error,turn.items.filter(i=>i.type!=='reasoning')])]);
 // Preserve text selections, focus and native disclosures on unchanged polls.
 if(preserveScroll&&signature===visibleSignature)return;
 const list=$('messages');const oldScroll=list.scrollTop;beforeOutput();
 if(!preserveScroll){followOutput=true;unreadOutput=false;}
 // Capture native disclosure state synchronously before polling replaces the DOM.
 for(const details of list.querySelectorAll('details[data-activity-key]'))expandedActivity.set(details.dataset.activityKey,details.open);
 list.replaceChildren();
 for(const turn of shownTurns){
   const anchor=document.createElement('div');anchor.className='turn-anchor';anchor.dataset.turnId=turn.id;list.append(anchor);
   const firstIndex=list.children.length;
   const question=promptText(turn);if(question){const content=addMessage('user',question,'你');content.closest('article').dataset.turnId=turn.id;}
   const observed=livePhases[phaseKey(t.id,turn.id)];
   const hasActivity=turn.items.some(i=>!['userMessage','reasoning'].includes(i.type)&&(i.type!=='agentMessage'||i.phase==='commentary'))||observed?.thinkingMs;
   const activity=hasActivity?turnActivity(t,turn):null;if(activity)list.append(activity.group);
   if(turn.status!=='inProgress'&&observed?.thinkingMs){const timing=document.createElement('div');timing.className='thinking-result';timing.append(icon('brain'));timing.append(document.createTextNode('已思考 '+clockText(observed.thinkingMs)));activity.body.append(timing);}
   const visible=turn.items.filter(i=>!['userMessage','reasoning'].includes(i.type));let tools=[];
   const flush=()=>{if(tools.length)addTools(tools,turn,phaseKey(t.id,turn.id),activity.body);tools=[];};
   for(const item of visible){
     if(item.type!=='agentMessage'){tools.push(item);continue;}
     flush();
     const commentary=item.phase==='commentary';
     const content=addMessage(commentary?'commentary':'assistant',item.text,commentary?'进度':'Codex',commentary?activity.body:list);content.id='stream-'+item.id;
     content.closest('article').dataset.turnId=turn.id;
     if(commentary&&turn.status==='inProgress'&&item===visible.at(-1))content.closest('article').classList.add('is-current');
   }
   flush();
   updateTurnActivity(t,turn);
   if(turn.error)addMessage('error',turn.error.message||'回答失败','错误');
   if(turn.status==='interrupted')addMessage('commentary','回答已停止','状态');
   if(branch&&shownTurns.indexOf(turn)<branch.prefixCount)for(const child of [...list.children].slice(firstIndex-1))child.classList.add('inherited');
 }
 if(!list.children.length){const empty=document.createElement('div');empty.className='empty';empty.append(icon('git-branch'));const p=document.createElement('p');p.textContent='分支已就绪';empty.append(p);list.append(empty);}
 renderWorkbench();icons();afterOutput(preserveScroll&&signature!==visibleSignature,oldScroll);visibleSignature=signature;
 if(!preserveScroll)restoreReading();
}
async function doFork(){
 const oldKey=draftKey();const text=$('prompt').value;const parent=current();
 const branch=await api('fork',{threadId:selected.threadId,turnId:selected.turnId});
 // The server acknowledged the fork. Select it immediately so a slow tree
 // refresh cannot strand an empty branch or cause the next attempt to fork again.
 snapshot.branches.push({...branch,thread:{...parent,id:branch.id,cwd:branch.workspaceCwd||parent.cwd,contextRevision:0,turns:parent.turns.slice(0,branch.prefixCount)}});
 selected={threadId:branch.id,turnId:null};
 drafts[draftKey()]=text;delete drafts[oldKey];renderTree();renderChat();$('prompt').value=text;persistDraft();updateComposer();return branch.id;
}
function acceptSentTurn(id,response,text){
 const thread=threads().find(t=>t.id===id);if(!thread)return;
 let turn=thread.turns.find(t=>t.id===response.turn.id);
 if(!turn){turn={...response.turn,items:response.turn.items||[]};if(!turn.items.some(i=>i.type==='userMessage'))turn.items.unshift({type:'userMessage',id:'pending-'+turn.id,content:[{type:'text',text}]});thread.turns.push(turn);}
 if(turn.status==='inProgress')snapshot.active[id]=turn.id;
 selected={threadId:id,turnId:turn.id};renderTree();renderChat();
}
function refreshSubmitted(rootId){
 // Sending is already complete; history loading must not keep the composer locked.
 setTimeout(()=>{if(snapshot?.root.id!==rootId)return;syncProgress(true,true);},0);
}
async function act(fn){if(busy)return;busy=true;clearError();updateComposer();try{await fn();}catch(e){error(e);}finally{busy=false;updateComposer();}}
$('fork').onclick=()=>act(doFork);
 $('composer').onsubmit=e=>{e.preventDefault();if($('send').dataset.mode==='stop'){ $('stop').click(); return; }const text=$('prompt').value.trim();if(!text&&!quoteDraft||$('send').disabled)return;const submittedText=quoteDraft?quoteDraft.prefix+'\\n\\n'+text:text;
 if(isLeaf()&&(currentRun()||questionQueues[selected.threadId]?.items?.length)){enqueueQuestion(submittedText);return;}
 act(async()=>{
 if(pendingNew){
   if(!features.has('new-conversation'))throw new Error('新建对话需要新版服务。请双击 Restart.cmd 后重试，输入草稿会保留。');
 const response=await api('new',{text:submittedText,...modelSettings(),...(newConversationCwd?{cwd:newConversationCwd}:{}),...(newConversationShared?{shared:true}:{})});
   $('prompt').value='';persistDraft();pendingNew=false;treeStorage.removeItem('tree-new');lastRoot=response.conversation.id;
   treeStorage.setItem('tree-root',lastRoot);
   snapshot={root:{id:lastRoot,model:modelSettings().model,turns:[]},rootRecord:response.conversation,branches:[],active:{},metadata:{},usage:{}};
   $('conversation-label').textContent=response.conversation.name;$('source-kind').textContent='网页对话';
   catalog.unshift({...response.conversation,source:'web',updated_at:Date.now()/1000});
   acceptSentTurn(lastRoot,response,text);refreshSubmitted(lastRoot);return;
 }
 let id=selected.threadId;if(!canContinueInPlace())id=await doFork();
 const response=await api('send',{threadId:id,text:submittedText,...modelSettings(),contextRevision:threads().find(t=>t.id===id)?.contextRevision||0});
 followOutput=true;
 $('prompt').value='';persistDraft();selected={threadId:id,turnId:response.turn.id};
 acceptSentTurn(id,response,submittedText);refreshSubmitted(snapshot.root.id);
 });};
$('prompt').oninput=()=>{persistDraft();updateComposer();};
let composing=false,compositionEndedAt=-Infinity;
$('prompt').addEventListener('compositionstart',()=>{composing=true;});
$('prompt').addEventListener('compositionend',()=>{composing=false;compositionEndedAt=performance.now();});
$('prompt').addEventListener('keydown',e=>{
 if(e.key!=='Enter'||e.shiftKey||e.isComposing||composing||e.keyCode===229||performance.now()-compositionEndedAt<50)return;
 e.preventDefault();if(!$('send').disabled&&!busy)$('composer').requestSubmit();
});
$('stop').onclick=async()=>{
 const id=selected?.threadId,run=currentRun();if(!id||stoppingThreads.has(id))return;
 stoppingThreads.add(id);clearError();updateComposer();
 // Persist the queue brake without waiting for the dispatch lock, which may
 // currently be held by a slow request in this or another window.
 try{treeStorage.setItem(queueStopKey(id),'true');renderQuestionQueue();}catch(e){error(new Error('队列暂停状态保存失败：'+e.message));}
 try{
   const result=await api('stop',{threadId:id,...(run?{turnId:run.turn.id}:{})});
   staleWriterThreads.delete(id);if(result.stopped&&run){run.turn.status='interrupted';if(snapshot?.active?.[id]===run.turn.id)delete snapshot.active[id];if(selected?.threadId===id){renderTree();renderChat();}}
   feedback(result.stopped?'已确认本轮结束，队列已暂停':'停止请求已送达，正在等待执行结束；队列已暂停');
   syncProgress(true);
 }catch(e){error(new Error('尚未确认停止：'+e.message+'。可再次点击停止。'));}
 finally{stoppingThreads.delete(id);updateComposer();}
};
$('refresh').onclick=()=>act(async()=>{persistDraft();await loadCatalog();});
$('archived').onchange=renderHistory;
$('search').oninput=renderTree;
 $('toggle').onclick=()=>{const value=$('layout').classList.toggle('collapsed');$('toggle').replaceChildren(icon(value?'panel-left-open':'panel-left-close'));$('toggle').title=value?'打开侧边栏':'收起侧边栏';$('toggle').setAttribute('aria-label',$('toggle').title);treeStorage.setItem('tree-collapsed',String(value));icons();};
if(treeStorage.getItem('tree-collapsed')==='true')$('toggle').click();
let sidebarPreference=null,sidebarDrag=null;
try{const saved=Number(treeStorage.getItem('tree-sidebar-width'));if(Number.isFinite(saved)&&saved>=220)sidebarPreference=saved;}catch{}
function sidebarLimits(){return {min:220,max:Math.max(220,Math.min(600,Math.floor($('layout').clientWidth*.55),$('layout').clientWidth-360))};}
function updateSidebarWidth(value=sidebarPreference){
 const {min,max}=sidebarLimits();
 const width=Math.round(Math.max(min,Math.min(max,value??(innerWidth>=1100?310:280))));
 $('layout').style.setProperty('--sidebar-width',width+'px');
 const handle=$('sidebar-resizer');handle.setAttribute('aria-valuemin',min);handle.setAttribute('aria-valuemax',max);handle.setAttribute('aria-valuenow',width);handle.setAttribute('aria-valuetext',width+' 像素');
 return width;
}
function saveSidebarWidth(){try{if(sidebarPreference===null)treeStorage.removeItem('tree-sidebar-width');else treeStorage.setItem('tree-sidebar-width',String(sidebarPreference));}catch{}}
function finishSidebarDrag(){
 if(!sidebarDrag)return;
 const pointerId=sidebarDrag.pointerId;sidebarDrag=null;
 document.body.classList.remove('resizing-sidebar');
 if($('sidebar-resizer').hasPointerCapture(pointerId))$('sidebar-resizer').releasePointerCapture(pointerId);
 saveSidebarWidth();
}
$('sidebar-resizer').onpointerdown=e=>{
 if(e.button!==0||innerWidth<=680)return;
 e.preventDefault();sidebarDrag={pointerId:e.pointerId,x:e.clientX,width:$('sidebar').getBoundingClientRect().width};
 $('sidebar-resizer').setPointerCapture(e.pointerId);$('sidebar-resizer').focus();document.body.classList.add('resizing-sidebar');
};
$('sidebar-resizer').onpointermove=e=>{
 if(sidebarDrag?.pointerId!==e.pointerId)return;
 sidebarPreference=updateSidebarWidth(sidebarDrag.width+e.clientX-sidebarDrag.x);
};
for(const event of ['pointerup','pointercancel','lostpointercapture'])$('sidebar-resizer').addEventListener(event,finishSidebarDrag);
window.addEventListener('blur',finishSidebarDrag);
$('sidebar-resizer').ondblclick=()=>{finishSidebarDrag();sidebarPreference=null;updateSidebarWidth();saveSidebarWidth();};
$('sidebar-resizer').onkeydown=e=>{
 if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();
 const {min,max}=sidebarLimits(),width=$('sidebar').getBoundingClientRect().width;
 sidebarPreference=updateSidebarWidth(e.key==='Home'?min:e.key==='End'?max:width+(e.key==='ArrowLeft'?-1:1)*(e.shiftKey?40:10));saveSidebarWidth();
};
new ResizeObserver(()=>{if(innerWidth<=680)finishSidebarDrag();updateSidebarWidth();}).observe($('layout'));
updateSidebarWidth();
$('rename').onclick=()=>{$('name-input').value=record(selected.threadId).name;$('name-dialog').querySelector('h2').textContent=selected.threadId===snapshot.root.id?'重命名对话':'重命名分支';$('name-dialog').showModal();};
$('name-dialog').onclose=()=>{if($('name-dialog').returnValue==='save')act(async()=>{await api('rename',{threadId:selected.threadId,name:$('name-input').value});await loadCatalog(false);await loadTree(snapshot.root.id,true);});};
function showBranchSelection(selection){
 selected=selection;renderTree();renderChat();$('prompt').value=drafts[draftKey()]||'';updateComposer();
}
$('delete-branch').onclick=()=>{
 if(busy||$('delete-branch').disabled)return;
 if(!features.has('branch-delete')){error('删除分支需要新版服务，请双击 Restart.cmd 后重试。');return;}
 const branch=record(selected.threadId),targets=deletionScope(branch.id);
 deleteTarget={id:branch.id,name:branch.name,rootId:snapshot.root.id,parentId:branch.parentId,pivotTurnId:branch.pivotTurnId,selection:{...selected},ids:targets.map(b=>b.id)};
 $('delete-summary').textContent='将从提问树移除以下 '+targets.length+' 个分支，删除后可撤销。';
 $('delete-list').replaceChildren(...targets.map(b=>{const li=document.createElement('li');li.textContent=b.name;return li;}));
 $('delete-dialog').returnValue='';$('delete-dialog').showModal();
};
$('delete-dialog').onclose=()=>{
 const target=deleteTarget;deleteTarget=null;
 if($('delete-dialog').returnValue!=='delete'||!target)return;
 act(async()=>{
   persistDraft();const result=await api('branches/delete',{threadId:target.id,expectedIds:target.ids});
   deleteUndo={threadId:target.id,name:target.name,rootId:target.rootId,selection:target.selection,count:result.deletedIds.length,deletionId:result.deletionId};showDeleteUndo();
   await loadTree(target.rootId,true);
   showBranchSelection({threadId:target.parentId,turnId:target.pivotTurnId});
 });
};
$('undo-delete').onclick=()=>act(async()=>{
 const undo=deleteUndo;if(!undo)return;
 await api('branches/restore',{threadId:undo.threadId,deletionId:undo.deletionId});
 deleteUndo=null;showDeleteUndo();await loadTree(undo.rootId);showBranchSelection(undo.selection);
});
$('dismiss-delete').onclick=()=>{deleteUndo=null;showDeleteUndo();};
let progressPending=false,lastHistorySyncAt=0,lastLiveEventAt=0;
async function syncProgress(force=false,submitted=false){
 if(progressPending||busy||!snapshot||document.visibilityState==='hidden')return;
 const running=!record(selected?.threadId)||snapshot.root.turns.some(t=>t.status==='inProgress')||Object.keys(snapshot.active).length||snapshot.branches.some(b=>b.thread?.turns.some(t=>t.status==='inProgress'));
 if(!force&&!running)return;
 const now=Date.now();
 if(!force&&eventSource?.readyState===EventSource.OPEN){
   const interval=lastLiveEventAt&&now-lastLiveEventAt<15000?60000:15000;
   if(now-lastHistorySyncAt<interval)return;
 }
 lastHistorySyncAt=now;progressPending=true;
 try{await loadTree(snapshot.root.id,true);$('connection').textContent=connectionLabel();$('dot').className='online';}
 catch(e){const alive=eventSource?.readyState===EventSource.OPEN;$('connection').textContent=alive?'历史同步较慢':'状态同步失败';$('dot').className=alive?'online':'offline';if(submitted)error(new Error('问题已提交，但历史同步未完成。请勿重复发送；稍后刷新查看。'+e.message));}
 finally{progressPending=false;lastHistorySyncAt=Date.now();}
}
function connectEvents(){
 eventSource=new EventSource(apiBase+'events');
 eventSource.onopen=()=>{$('connection').textContent=connectionLabel();$('dot').className='online';api('session').then(async s=>{token=s.token;features=new Set(s.features||[]);await ensureExecution();if(snapshot)snapshot.active=s.active;updateComposer();return syncProgress(true);}).catch(error);};
 eventSource.onerror=()=>{$('connection').textContent='正在重连';$('dot').className='offline';};
 eventSource.onmessage=event=>{
   const msg=JSON.parse(event.data),p=msg.params||{};
   if(['item/agentMessage/delta','item/started','item/completed','turn/started'].includes(msg.method)&&threads().some(t=>t.id===p.threadId))lastLiveEventAt=Date.now();
   executionUI?.event(msg);
   if(msg.method==='tree/contextChanged'){
     pauseAffectedQueues(p.affectedIds||[]);if(snapshot?.root.id===p.rootId)loadTree(p.rootId,true).catch(error);return;
   }
   if(msg.method==='disconnected'){error(p.error);$('connection').textContent='服务断开';$('dot').className='offline';return;}
   if(msg.method==='turn/completed'&&(selected?.threadId!==p.threadId||document.visibilityState==='hidden')){unreadBranches[p.threadId]=p.turn.id;saveLocal('tree-unread',unreadBranches);}
   if(!snapshot)return;
   applyLiveEvent(msg);
   if(msg.method==='error')error((p.error?.message||'回答失败')+(p.willRetry?'（正在重试，可停止回答）':''));
 };
}
function applyLiveEvent(msg){
 if(msg.method==='thread/tokenUsage/updated'){if(snapshot){snapshot.usage||={};snapshot.usage[msg.params.threadId]=msg.params.tokenUsage;updateUsage();}return;}
 const p=msg.params||{},thread=threads().find(t=>t.id===p.threadId);
 const turnId=p.turnId||p.turn?.id;if(!thread||!turnId)return;
 let turn=thread.turns.find(t=>t.id===turnId);
 if(!turn&&p.turn){turn={...p.turn,items:p.turn.items||[]};thread.turns.push(turn);}
 if(!turn)return;
 if(turn.status!=='inProgress'&&msg.method==='item/agentMessage/delta')return;
 const key=phaseKey(thread.id,turnId);
 const state=livePhases[key]||{startedAt:turn.startedAt*1000||Date.now(),phase:'waiting',thinkingMs:0};
 livePhases[key]=state;
 state.streamObserved=true;
 const endThinking=()=>{if(state.thinkingAt){state.thinkingMs+=Date.now()-state.thinkingAt;delete state.thinkingAt;}};
 if(msg.method==='turn/started'){snapshot.active[thread.id]=turnId;turn.status='inProgress';}
 if(msg.method==='item/started'||msg.method==='item/completed'){
   if(p.item.type==='userMessage')turn.items=turn.items.filter(i=>i.id!=='pending-'+turn.id);
   const index=turn.items.findIndex(i=>i.id===p.item.id);
   if(index<0)turn.items.push(p.item);else turn.items[index]={...turn.items[index],...p.item};
   if(p.item.type==='reasoning'){
     if(msg.method==='item/started'){state.phase='thinking';state.thinkingAt??=Date.now();}
     else{endThinking();state.phase='waiting';}
   }else if(p.item.type==='agentMessage'){
     endThinking();state.phase=p.item.phase==='commentary'?'working':'answering';
   }else if(!['userMessage','contextCompaction'].includes(p.item.type)){endThinking();state.phase='working';}
 }
 if(msg.method==='item/agentMessage/delta'){
   let item=turn.items.find(i=>i.id===p.itemId);
   if(!item){item={id:p.itemId,type:'agentMessage',text:'',phase:'final_answer'};turn.items.push(item);}
   item.text+=p.delta;endThinking();state.phase=item.phase==='commentary'?'working':'answering';
   if(selected?.threadId===p.threadId&&(!selected.turnId||selected.turnId===turnId)){
     beforeOutput();
     let content=$('stream-'+p.itemId);if(!content){renderChat(true);content=$('stream-'+p.itemId);}
     updateTurnActivity(thread,turn);
     renderStream(content,item);
     afterOutput();
   }
 }
 if(msg.method==='turn/completed'){
   if(selected?.threadId!==thread.id||document.visibilityState==='hidden')unreadBranches[thread.id]=turnId;else delete unreadBranches[thread.id];saveLocal('tree-unread',unreadBranches);
   endThinking();state.phase='completed';delete snapshot.active[thread.id];
   const items=p.turn.items?.length?p.turn.items:turn.items;
   Object.assign(turn,p.turn,{items});
 }
 savePhases();
 if(msg.method!=='item/agentMessage/delta'){
   renderTree();if(selected?.threadId===thread.id)renderChat(true);
 }
 updateComposer();
 if(msg.method==='turn/completed')syncProgress(true);
}
window.addEventListener('beforeunload',()=>{persistDraft();saveReading();});
window.addEventListener('focus',()=>syncProgress(true));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')syncProgress(true);});
setInterval(updateComposer,1000);
setInterval(()=>syncProgress(),2000);
function readLocal(key,fallback){try{return JSON.parse(treeStorage.getItem(key))??fallback;}catch{return fallback;}}
function readQuestionQueues(){try{const saved=JSON.parse(treeStorage.getItem(queueStorage)||'{}');return saved&&typeof saved==='object'&&!Array.isArray(saved)?saved:{};}catch{return {};}}
function writeQuestionQueue(id,value){
 const all=readQuestionQueues();if(value)all[id]=value;else delete all[id];
 // Do not clear an input until durable browser storage accepts the question.
 treeStorage.setItem(queueStorage,JSON.stringify(all));questionQueues=all;renderQuestionQueue();
}
async function queueLock(id,fn,onlyAvailable=false){
 if(!navigator.locks)throw new Error('当前浏览器不支持安全排队，请使用新版 Edge 或 Chrome。草稿已保留。');
 return navigator.locks.request(storagePrefix+'tree-question-queue:'+id,{...(onlyAvailable?{ifAvailable:true}:{})},lock=>lock?fn():undefined);
}
async function changeQuestionQueue(id,fn){
 await queueLock(id,()=>{const q=readQuestionQueues()[id];if(!q)return;fn(q);writeQuestionQueue(id,q);});updateComposer();
}
async function enqueueQuestion(text){
 if(queueEnqueuePending)return;queueEnqueuePending=true;updateComposer();
 const selection={...selected},key=draftKey(),rootId=snapshot.root.id,settings=modelSettings();
 try{
   if(text.length>100000)throw new Error('问题最多 100000 字符。');
   await queueLock(selection.threadId,()=>{
     const q=readQuestionQueues()[selection.threadId]||{rootId,items:[],paused:false,contextRevision:current()?.contextRevision||0};
     if(q.items.length>=20)throw new Error('每个分支最多排队 20 个问题，请先处理已有队列。');
     q.items.push({id:crypto.randomUUID(),text,...settings,createdAt:Date.now(),state:'waiting'});writeQuestionQueue(selection.threadId,q);
   });
   if(drafts[key]?.trim()===text)delete drafts[key];
   if(draftKey()===key&&$('prompt').value.trim()===text){$('prompt').value='';persistDraft();}
   else saveLocal('tree-drafts',drafts);
   feedback('已加入当前分支的提问队列');updateComposer();pumpQuestionQueues();
 }catch(e){error(e);}finally{queueEnqueuePending=false;updateComposer();}
}
function renderQuestionQueue(){
 const panel=$('question-queue');if(!panel)return;
 const stored=questionQueues[selected?.threadId],q=stored&&queueStopped(selected.threadId)?{...stored,paused:true,reason:'已请求停止，队列已暂停。'}:stored,signature=JSON.stringify([selected?.threadId,q,busy]);
 if(signature===queueRenderKey)return;queueRenderKey=signature;panel.replaceChildren();panel.hidden=!q?.items?.length;if(panel.hidden)return;
 const id=selected.threadId,head=element('div','queue-head');
 const uncertain=q.items[0]?.state==='uncertain';
 head.append(icon('list-ordered'),element('strong','',q.paused?'队列已暂停 · '+q.items.length:'待发送 · '+q.items.length));
 const toggle=element('button','queue-control',q.paused?'继续队列':'暂停队列');toggle.type='button';toggle.disabled=busy||uncertain;
 toggle.onclick=()=>changeQuestionQueue(id,value=>{value.paused=!q.paused;if(!value.paused)treeStorage.removeItem(queueStopKey(id));value.reason='';value.allowFailure=true;value.contextRevision=current()?.contextRevision||0;value.waitFor=null;}).then(()=>pumpQuestionQueues()).catch(error);head.append(toggle);panel.append(head);
 const help=element('p','queue-help',q.reason||'上一轮完成后依次发送。切换分支不影响排队；关闭所有网页后暂停，重新打开后继续。');panel.append(help);
 const list=element('ol','queue-list');
 for(const [index,item] of q.items.entries()){
   const row=element('li','queue-row');row.append(element('span','queue-number',String(index+1)),element('span','queue-text',item.text));row.title=item.text;
   if(item.state==='waiting'){
     const remove=toolButton('x','移除排队问题 '+(index+1),()=>changeQuestionQueue(id,value=>{value.items=value.items.filter(i=>i.id!==item.id);}).catch(error));remove.disabled=busy;row.append(remove);
   }else row.append(element('span','queue-item-state',item.state==='uncertain'?'待确认':'发送中'));
   list.append(row);
 }
 panel.append(list);
 if(uncertain){const check=element('button','queue-control','检查发送状态');check.type='button';check.onclick=()=>pumpQuestionQueues();panel.append(check);}
 icons();
}
async function dispatchQuestionQueue(id){
 await queueLock(id,async()=>{
   let q=readQuestionQueues()[id];if(!q?.items?.length||q.paused&&q.items[0].state==='waiting')return;
   if(queueStopped(id)&&q.items[0].state==='waiting')return;
   let data;
   try{data=await api('tree?id='+encodeURIComponent(q.rootId));}catch{return;}
   if(queueStopped(id)&&q.items[0].state==='waiting')return;
   const thread=data.root.id===id?data.root:data.branches.find(b=>b.id===id)?.thread;
   if(!thread){q.paused=true;q.reason='此分支已删除或无法读取。恢复分支后可继续队列。';writeQuestionQueue(id,q);return;}
   if((q.contextRevision||0)!==(thread.contextRevision||0)){q.paused=true;q.reason='提问已删除，上下文已变化。请确认排队内容后再继续。';writeQuestionQueue(id,q);return;}
   const last=thread.turns.at(-1),item=q.items[0];
   if(item.state==='sending'||item.state==='uncertain'){
     const baseline=thread.turns.findIndex(t=>t.id===item.afterTurnId);
     // A disconnected POST may have succeeded. Only acknowledge a matching
     // new user turn; never blindly replay a request with an unknown outcome.
     const sent=baseline>=0?thread.turns.slice(baseline+1).find(t=>promptText(t)===item.text):null;
     if(sent){q.items.shift();q.waitFor=sent.id;q.reason='';writeQuestionQueue(id,q);}
     else{item.state='uncertain';q.paused=true;q.reason='未能确认上一条排队问题是否发送成功，已暂停以避免重复发送。可检查发送状态；内容会保留。';writeQuestionQueue(id,q);}
     return;
   }
   if(data.active?.[id]||last?.status==='inProgress')return;
   if(q.waitFor&&!thread.turns.some(t=>t.id===q.waitFor))return;
   if(last&&last.status!=='completed'&&!q.allowFailure){q.paused=true;q.reason='上一轮未正常完成，队列已暂停。确认后可继续发送。';writeQuestionQueue(id,q);return;}
   item.state='sending';item.afterTurnId=last?.id||null;q.allowFailure=false;writeQuestionQueue(id,q);updateComposer();
   let sentSuccessfully=false;
   try{
     const result=await api('send',{threadId:id,text:item.text,model:item.model,effort:item.effort,contextRevision:q.contextRevision||0});
     q.items.shift();q.waitFor=result.turn.id;q.reason='';writeQuestionQueue(id,q);
     sentSuccessfully=true;
   }catch(e){
     if(e.httpStatus){item.state='waiting';q.paused=true;q.reason='发送失败：'+e.message+'。问题已保留，可继续队列重试。';}
     else{item.state='uncertain';q.paused=true;q.reason='连接中断，正在确认发送结果，问题已保留。';}
     writeQuestionQueue(id,q);
   }
   if(sentSuccessfully&&snapshot?.root.id===q.rootId)await loadTree(q.rootId,true).catch(()=>{});
 },true);
}
async function pumpQuestionQueues(){
 if(queuePumpRunning||busy||!token||!navigator.locks)return;queuePumpRunning=true;
 try{questionQueues=readQuestionQueues();for(const id of Object.keys(questionQueues))await dispatchQuestionQueue(id);}
 catch(e){error(e);}finally{queuePumpRunning=false;updateComposer();}
}
window.addEventListener('storage',e=>{if(e.key===storagePrefix+queueStorage||e.key?.startsWith(storagePrefix+'tree-queue-stop:')){questionQueues=readQuestionQueues();updateComposer();}});
function saveLocal(key,value){try{treeStorage.setItem(key,JSON.stringify(value));}catch{}}
let libraryMetadata={},readingPositions=readLocal('tree-reading',{}),unreadBranches=readLocal('tree-unread',{});
let readingSettings=readLocal('tree-reading-settings',{size:14,line:1.85,width:820});
let hideInherited=readLocal('tree-hide-inherited',false),outlineOpen=false,compareId=null,compareShared=true;
let searchRequest=0,summaryJob=null,summaryTimer=null,quoteSelection=null,quoteDraft=null;
const mediaCollapsed=new Map();
function element(tag,className,text){const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;}
function toolButton(name,title,fn){const b=element('button','icon');b.type='button';b.title=title;b.setAttribute('aria-label',title);b.append(icon(name));b.onclick=fn;return b;}
function command(name,title,fn){const b=toolButton(name,title,fn);b.className='menu-command';b.append(element('span','',title));return b;}
function dialog(id,title){const d=element('dialog','work-dialog');d.id=id;const head=element('div','dialog-head'),heading=element('h2','',title);heading.id=id+'-title';d.setAttribute('aria-labelledby',heading.id);head.append(heading,toolButton('x','关闭',()=>d.close()));d.append(head);document.body.append(d);return d;}
function resizePrompt(){const input=$('prompt');if(!input)return;const value=input.value;if(input.dataset.sizedValue===value)return;input.dataset.sizedValue=value;input.style.height='auto';input.style.height=Math.min(innerWidth<=680?130:200,Math.max(innerWidth<=680?48:62,input.scrollHeight))+'px';}
let feedbackTimer;
function feedback(text){const el=$('feedback');if(!el)return;clearTimeout(feedbackTimer);el.textContent=text;el.hidden=false;feedbackTimer=setTimeout(()=>{el.hidden=true;},2400);}
function closeBranchMenu(restoreFocus=false){if(!$('branch-menu'))return;$('branch-menu').hidden=true;$('branch-menu-button').setAttribute('aria-expanded','false');if(restoreFocus)$('branch-menu-button').focus();}
function requireWorkbench(){if(!features.has('workbench'))throw new Error('这些功能需要新版服务。请双击 Restart.cmd 重启服务后刷新，草稿会保留。');}
function readingKey(){return selected?selected.threadId+':'+(selected.turnId||'leaf'):'';}
function saveReading(){if(!selected||!$('messages'))return;readingPositions[readingKey()]={top:$('messages').scrollTop,follow:followOutput};saveLocal('tree-reading',readingPositions);}
function restoreReading(){const position=readingPositions[readingKey()];if(!position)return;beforeOutput();followOutput=position.follow;afterOutput(false,position.top);}
function markRead(){if(!selected)return;delete unreadBranches[selected.threadId];saveLocal('tree-unread',unreadBranches);}
function applyReading(){
 readingSettings.size=Math.max(12,Math.min(20,Number(readingSettings.size)||14));readingSettings.line=Math.max(1.4,Math.min(2.2,Number(readingSettings.line)||1.85));readingSettings.width=Math.max(600,Math.min(1200,Number(readingSettings.width)||820));
 for(const [key,value] of Object.entries(readingSettings))document.documentElement.style.setProperty('--reading-'+key,value+(key==='line'?'':'px'));
 saveLocal('tree-reading-settings',readingSettings);
}
function updateUsage(){
 const u=snapshot?.usage?.[selected?.threadId];if(!$('context-usage'))return;
 const count=u?.last?.totalTokens,limit=u?.modelContextWindow;
 $('context-usage').textContent=count!=null?'本次 '+count.toLocaleString()+' tokens'+(limit?' / '+limit.toLocaleString():''):'上下文用量未提供';
 $('context-usage').title=count!=null?'最近一次模型请求的 token 用量；模型上下文窗口 '+(limit||'未提供'):'服务暂未上报此对话的 token 用量';
 if(record(selected?.threadId)?.imported)$('run-state').textContent='导入记录 · 可从轻量分支继续';
}
async function copyText(text,button){try{await navigator.clipboard.writeText(text);feedback('已复制到剪贴板');if(button){const old=button.title;button.title='已复制';button.setAttribute('aria-label','已复制');setTimeout(()=>{button.title=old;button.setAttribute('aria-label',old);},1500);}}catch(e){error(new Error('复制失败：'+e.message));}}
function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type}));const a=element('a');a.href=url;a.download=name.replace(/[\\/:*?"<>|]/g,'-');a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function metadata(key,patch){requireWorkbench();const value=await api('metadata',{key,...patch});libraryMetadata[key]=value;if(snapshot)snapshot.metadata=libraryMetadata;renderTree();renderWorkbench();return value;}
function nodeMeta(turn){return {rootId:snapshot.root.id,threadId:selected.threadId,turnId:turn.id,label:promptText(turn).slice(0,120)};}
function enhanceContent(content){
 for(const pre of content.querySelectorAll('pre[data-language]')){
   if(pre.previousElementSibling?.classList.contains('code-tools'))continue;
   const key=(content.id||'')+':'+[...content.querySelectorAll('pre')].indexOf(pre),tools=element('div','code-tools'),code=pre.querySelector('code').textContent;
   tools.append(element('span','',pre.dataset.language||'text'));
   const copy=toolButton('copy','复制代码',()=>copyText(code,copy));
   const collapse=toolButton('chevron-up','收起代码',()=>{pre.hidden=!pre.hidden;mediaCollapsed.set(key,pre.hidden);collapse.title=pre.hidden?'展开代码':'收起代码';collapse.setAttribute('aria-label',collapse.title);collapse.replaceChildren(icon(pre.hidden?'chevron-down':'chevron-up'));icons();});
   pre.hidden=mediaCollapsed.get(key)||false;if(pre.hidden){collapse.title='展开代码';collapse.setAttribute('aria-label',collapse.title);collapse.replaceChildren(icon('chevron-down'));}tools.append(copy,collapse);pre.before(tools);
 }
 for(const math of content.querySelectorAll('.math-display,.math-inline')){
   if(math.querySelector('.math-copy'))continue;const latex=math.dataset.latex||math.querySelector('annotation')?.textContent;if(!latex)continue;
   const copy=toolButton('copy','复制 LaTeX',()=>copyText(latex,copy));copy.classList.add('math-copy');math.append(copy);
 }
}
function decorateTree(){
 if(!snapshot)return;
 for(const node of $('tree').querySelectorAll('.node')){
   const key=node.dataset.key,[tid,turnId]=key.split(':'),t=threads().find(t=>t.id===tid),turn=turnId==='leaf'?t?.turns.at(-1):t?.turns.find(x=>x.id===turnId);
   const meta=libraryMetadata[key];
   if(meta?.favorite){const star=icon('star');star.classList.add('node-star');node.append(star);}
   if(meta?.note)node.title+='\n备注：'+meta.note;
   if(node.querySelector('.state'))continue;
   const label=unreadBranches[tid]&&(turnId==='leaf'||unreadBranches[tid]===turnId)?'未读':turn?.error||turn?.status==='failed'?'失败':turn?.status==='interrupted'?'已停止':node.classList.contains('branch-node')&&turn?.status==='inProgress'?'进行中':node.classList.contains('branch-node')&&turn?.status==='completed'?'已完成':'';
   if(label){const status=element('span','state '+(label==='失败'?'failed':label==='未读'?'unread':label==='已完成'?'complete':''),label);node.append(status);node.setAttribute('aria-description',label);}
 }
}
function locateNode(){
 if(!selected)return;const hadQuery=!!$('search').value;$('search').value='';collapsed.clear();renderTree();const node=[...$('tree').querySelectorAll('.node')].find(n=>n.dataset.key===selected.threadId+':'+(selected.turnId||'leaf'));node?.scrollIntoView({block:'nearest'});node?.focus();if(hadQuery)feedback('已清除筛选并定位当前提问');
}
async function navigateNode(rootId,threadId,turnId,itemId){
 if(busy)return;await act(async()=>{if(snapshot?.root.id!==rootId)await loadTree(rootId);saveReading();persistDraft();selected={threadId,turnId:turnId||null};markRead();renderTree();renderChat();$('prompt').value=drafts[draftKey()]||'';});
 hideInherited=false;saveLocal('tree-hide-inherited',false);$('messages').classList.remove('hide-inherited');
 const target=itemId?$('stream-'+itemId):[...$('messages').querySelectorAll('.turn-anchor')].find(n=>n.dataset.turnId===turnId);
 if(target){followOutput=false;beforeOutput();target.scrollIntoView({block:'start'});afterOutput(false,$('messages').scrollTop);}locateNode();
}
async function forkAt(turn,regenerate=false){
 requireWorkbench();persistDraft();const root=snapshot.root.id;
 const result=await api('fork',{threadId:selected.threadId,turnId:turn.id,regenerate,...modelSettings()});
 await loadTree(root,true);selected={threadId:result.id,turnId:null};renderTree();renderChat();$('prompt').value=drafts[draftKey()]||'';updateComposer();
 if(result.startError){$('prompt').value=promptText(turn);persistDraft();throw new Error('备选分支已保留，发送失败：'+result.startError);}
}
function renderWorkbench(){
 if(!$('breadcrumbs'))return;
 const crumbs=$('breadcrumbs');crumbs.replaceChildren();$('outline-list').replaceChildren();
 $('shared-history').hidden=true;
 $('branch-menu-button').disabled=!snapshot;$('outline-toggle').disabled=!snapshot;$('compare-button').disabled=!snapshot;
 if(!snapshot){$('compare-panel').hidden=true;return;}
 const route=[],seen=new Set();let id=selected?.threadId;
 while(id&&!seen.has(id)){seen.add(id);const b=record(id);route.unshift({id,name:b?.name||conversationTitle(catalog.find(t=>t.id===id)),pivot:b?.pivotTurnId,parent:b?.parentId});id=b?.parentId;}
 for(const [i,r] of route.entries()){
   if(i){crumbs.append(icon('chevron-right'));const parentThread=threads().find(t=>t.id===r.parent),pivot=parentThread?.turns.find(t=>t.id===r.pivot);if(pivot){const p=element('button','crumb-pivot',promptText(pivot).slice(0,20));p.title=promptText(pivot);p.onclick=()=>select(r.parent,r.pivot);crumbs.append(p,icon('chevron-right'));}}
   const b=element('button','',r.name||'主对话');b.title=r.name;b.onclick=()=>select(r.id,null);crumbs.append(b);
 }
 const inherited=$('messages').querySelectorAll('.turn-anchor.inherited').length;
 $('messages').classList.toggle('hide-inherited',hideInherited);
 if(inherited){$('shared-history').hidden=false;$('shared-history').textContent=(hideInherited?'展开':'收起')+'共同历史 · '+inherited+' 轮';}
 for(const article of $('messages').querySelectorAll('article[data-turn-id]')){
   const turn=current()?.turns.find(t=>t.id===article.dataset.turnId);if(!turn)continue;
   const content=article.querySelector('.content');enhanceContent(content);
   article.querySelector('.message-actions')?.remove();
   const actions=element('div','message-actions');
   if(article.classList.contains('assistant')){
     const item=turn.items.find(i=>'stream-'+i.id===content.id);
     const copy=toolButton('copy','复制回答',()=>{const clone=content.cloneNode(true);clone.querySelectorAll('button,.code-tools').forEach(n=>n.remove());copyText(clone.innerText||clone.textContent,copy);});
     const md=toolButton('file-code','复制 Markdown',()=>copyText(item?.text||'',md));actions.append(copy,md);
     if(turn.status!=='inProgress'&&!record(selected.threadId)?.imported)actions.append(toolButton('rotate-cw','重新生成备选答案',()=>act(()=>forkAt(turn,true))));
   }
   if(article.classList.contains('user')){
     const key=selected.threadId+':'+turn.id,info=nodeMeta(turn);
     const favorite=toolButton('star',libraryMetadata[key]?.favorite?'取消收藏提问':'收藏提问',()=>act(()=>metadata(key,{...info,favorite:!libraryMetadata[key]?.favorite})));
     if(libraryMetadata[key]?.favorite)favorite.classList.add('is-favorite');actions.append(favorite,toolButton('notebook-pen','提问备注',()=>editNote(key,info)));
     if(['failed','interrupted'].includes(turn.status)&&!record(selected.threadId)?.imported)actions.append(toolButton('rotate-cw','重试此问题',()=>act(()=>forkAt(turn,true))));
   }
   if(!article.classList.contains('commentary')&&turn.status!=='inProgress'){
     if(!record(selected.threadId)?.imported)actions.append(toolButton('git-fork','从此提问分叉',()=>act(()=>forkAt(turn))));
     actions.append(toolButton('quote','引用到输入框',()=>insertQuote(content.innerText,turn.id)));
   }
   article.append(actions);
 }
 for(const [index,h] of [...$('messages').querySelectorAll('.assistant h2,.assistant h3,.assistant h4')].filter(h=>!hideInherited||!h.closest('.inherited')).entries()){
   const b=element('button','outline-entry level-'+h.tagName.toLowerCase(),h.textContent);b.onclick=()=>{followOutput=false;beforeOutput();h.scrollIntoView({block:'start'});afterOutput(false,$('messages').scrollTop);};$('outline-list').append(b);
 }
 if(!$('outline-list').children.length)$('outline-list').append(element('p','muted','暂无章节标题'));
 $('outline-list').hidden=!outlineOpen;$('outline-toggle').setAttribute('aria-expanded',String(outlineOpen));
 renderComparison();icons();
}
function pauseAffectedQueues(ids){for(const id of ids)changeQuestionQueue(id,q=>{q.paused=true;q.reason='上下文已变化。请确认排队内容后再继续。';}).catch(error);}
async function openQuestionDeletion(threadId,turnId){
 if(busy)return;
 if(!features.has('question-delete')){error(new Error('删除提问需要新版服务。请双击 Restart.cmd 重启后重试。'));return;}
 await act(async()=>{
   const preview=await api('questions/preview?threadId='+encodeURIComponent(threadId)+'&turnId='+encodeURIComponent(turnId));
   questionDeleteTarget={threadId,turnId,rootId:snapshot.root.id,expectedTurnIds:preview.turns.map(t=>t.id),expectedBranchIds:preview.branches.map(b=>b.id)};
   $('question-delete-summary').textContent='将删除 '+preview.turns.length+' 轮问答和 '+preview.branches.filter(b=>!b.hidden).length+' 个子分支。后续提问只保留此轮之前的上下文；受影响的队列会暂停。';
   if(!record(threadId))$('question-delete-summary').textContent+=' 此操作只修改网页中的对话副本，Codex IDE 原记录保留。';
   $('question-delete-list').replaceChildren(...preview.turns.map(t=>element('li','',t.name)),...preview.branches.filter(b=>!b.hidden).map(b=>element('li','muted','子分支 · '+b.name)));
   $('question-delete-dialog').showModal();
 });
}
function renderQuoteDraft(){const box=$('quote-draft');if(!box)return;box.hidden=!quoteDraft;box.replaceChildren();if(!quoteDraft)return;const icon=element('span','','quote-draft-icon');icon.textContent='❝';const body=element('div','');body.append(element('strong',quoteDraft.source||'引用内容'),element('span',quoteDraft.text));const remove=element('button','×','icon');remove.type='button';remove.title='移除引用';remove.onclick=()=>{quoteDraft=null;renderQuoteDraft();updateComposer();};box.append(icon,body,remove);}
function insertQuote(text,turnId,sourceId=selected?.threadId){
 if(!$('prompt')||$('prompt').disabled){error(new Error('当前不能输入，请等待回答结束或先选择可继续的分支。'));return;}
 const source=record(sourceId)?.name||'主对话';const link=new URL(location.href);link.hash=new URLSearchParams({root:snapshot.root.id,thread:sourceId,turn:turnId}).toString();
 const prefix='引用「'+source+'」 '+link.href+'\n'+text.trim().split('\n').map(line=>'> '+line).join('\n');quoteDraft={source,text:text.trim().split('\n')[0],prefix};renderQuoteDraft();persistDraft();updateComposer();$('prompt').focus();
}function editNote(key,info){
 const d=$('note-dialog');d.dataset.key=key;d._info=info;$('note-input').value=libraryMetadata[key]?.note||'';d.showModal();$('note-input').focus();
}
function populateBranchMenu(){
 const menu=$('branch-menu');menu.replaceChildren();const t=current();if(!t)return;
 const add=(name,label,fn)=>{const b=command(name,label,()=>{closeBranchMenu();fn();});menu.append(b);return b;};
 if(record(t.id))add('pencil','重命名',()=>$('rename').click());
 add('link','复制节点链接',()=>{const url=new URL(location.href);url.hash=new URLSearchParams({root:snapshot.root.id,thread:t.id,turn:selected.turnId||''}).toString();copyText(url.href);});
 add('star',libraryMetadata[t.id]?.favorite?'取消收藏分支':'收藏分支',()=>act(()=>metadata(t.id,{favorite:!libraryMetadata[t.id]?.favorite,rootId:snapshot.root.id,threadId:t.id,label:record(t.id)?.name||$('branch-name').textContent})));
 add('archive',libraryMetadata[snapshot.root.id]?.archived?'取消归档对话':'归档对话',()=>act(async()=>{await metadata(snapshot.root.id,{archived:!libraryMetadata[snapshot.root.id]?.archived});await loadCatalog(false);}));
 add('file-down','导出当前分支 Markdown',()=>act(async()=>{requireWorkbench();const result=await api('export?id='+t.id);download(result.name+'.md',result.markdown,'text/markdown;charset=utf-8');}));
 if(canFork())add('notebook-pen','创建轻量分支',openLightweight);
 if(snapshot.branches.some(b=>b.id===t.id)){menu.append(element('hr','menu-divider'));const remove=add('trash-2','删除分支',()=>$('delete-branch').click());remove.classList.add('destructive');remove.disabled=$('delete-branch').disabled;remove.title=$('delete-branch').title;}icons();
}
function renderComparison(){
 const panel=$('compare-panel');if(!panel)return;
 panel.hidden=!compareId||!snapshot;if(panel.hidden){$('message-pane')?.classList.remove('comparing');return;}
 const t=threads().find(t=>t.id===compareId);if(!t){compareId=null;panel.hidden=true;return;}
 const scroll=$('compare-content').scrollTop;const list=$('compare-content');list.replaceChildren();
 const currentTurns=current()?.turns||[];let common=0;
 while(common<t.turns.length&&common<currentTurns.length&&t.turns[common].id===currentTurns[common].id)common++;
 $('compare-heading').textContent=record(t.id)?.name||'主对话';$('compare-common').textContent='隐藏共同历史（'+common+' 轮）';
 for(const turn of t.turns.slice(compareShared?common:0)){
   list.append(element('div','compare-question',promptText(turn)));
   for(const item of turn.items.filter(i=>i.type==='agentMessage'&&i.phase!=='commentary')){const a=element('article','markdown compare-answer');a.append(markdown(item.text));const quote=toolButton('quote','引用此答案到当前分支',()=>insertQuote(item.text,turn.id,t.id));a.append(quote);list.append(a);}
 }
 if(!list.children.length)list.append(element('p','muted','没有不同的问答内容'));list.scrollTop=scroll;icons();
}
async function openLibrary(mode='favorites'){
 const d=$('library-dialog');d.showModal();$('library-mode').value=mode;await fillLibrary();
}
let libraryRequest=0;
async function fillLibrary(){
 const seq=++libraryRequest,mode=$('library-mode').value;
 const descriptions={favorites:['收藏与备注','集中查看值得保留的问题、分支和备注。'],notes:['提问备注','记录你的判断、疑问与后续计划。'],archived:['已归档对话','归档的对话仍可搜索，也可以随时取消归档。'],trash:['回收站','这里存放已删除的分支。恢复后会回到原来的分叉位置。']};
 $('library-dialog').querySelector('h2').textContent=descriptions[mode][0];$('library-description').textContent=descriptions[mode][1];
 const list=$('library-list');list.replaceChildren(element('p','muted','正在读取…'));
 list.setAttribute('aria-busy','true');
 try{
   requireWorkbench();const data=await api('library');if(seq!==libraryRequest)return;libraryMetadata=data.metadata;list.replaceChildren();
   if(mode==='trash'){
     for(const item of data.questionTrash||[]){const row=element('div','library-row');row.append(element('strong','','提问 · '+item.name),element('span','muted',item.turnCount+' 轮问答 · '+item.branchCount+' 个子分支'),element('p','muted','恢复为独立对话，保留删除后新产生的内容。'));row.append(command('undo-2','恢复提问记录',()=>act(async()=>{const result=await api('questions/restore',{deletionId:item.id});$('library-dialog').close();await loadCatalog(false);await loadTree(result.rootId);feedback('已恢复为独立对话');})));list.append(row);}
     const groups=new Map();for(const b of data.trash){if(!groups.has(b.deletionId))groups.set(b.deletionId,[]);groups.get(b.deletionId).push(b);}
     for(const [deletionId,items] of groups){const top=items.find(b=>!items.some(p=>p.id===b.parentId))||items[0];const row=element('div','library-row');row.append(element('strong','',top.name),element('span','muted',items.length+' 个分支 · '+new Date(top.deletedAt).toLocaleDateString()));row.append(command('undo-2','恢复',()=>act(async()=>{await api('branches/restore',{threadId:top.id,deletionId});if(deleteUndo?.deletionId===deletionId){deleteUndo=null;showDeleteUndo();}await fillLibrary();if(snapshot?.root.id===top.rootId)await loadTree(top.rootId,true);})));list.append(row);}
   }else{
     for(const [key,m] of Object.entries(libraryMetadata).filter(([,m])=>mode==='notes'?m.note:mode==='archived'?m.archived:m.favorite)){
       const row=element('div','library-row');const b=element('button','library-link',m.label||catalog.find(t=>t.id===key)?.name||catalog.find(t=>t.id===key)?.title||'对话');
       const tid=m.threadId||key.split(':')[0],rootId=m.rootId||data.branches.find(x=>x.id===tid)?.rootId||tid;
       b.onclick=()=>{$('library-dialog').close();navigateNode(rootId,tid,m.turnId||null).catch(error);};row.append(b);
       if(m.note)row.append(element('p','library-note',m.note));
       if(mode==='notes')row.append(command('pencil','编辑备注',()=>editNote(key,m)));
       row.append(command(mode==='archived'?'archive-restore':mode==='notes'?'trash-2':'star',mode==='archived'?'取消归档':mode==='notes'?'删除备注':'取消收藏',()=>act(async()=>{await metadata(key,mode==='archived'?{archived:false}:mode==='notes'?{note:''}:{favorite:false});await fillLibrary();await loadCatalog(false);})));list.append(row);
     }
   }
   if(!list.children.length){const empty=element('div','library-empty');empty.append(icon(mode==='trash'?'archive-restore':'bookmark'),element('strong','',mode==='trash'?'回收站是空的':'暂无记录'),element('p','muted',mode==='trash'?'删除的分支会出现在这里，可随时恢复。':mode==='notes'?'点击提问下方的备注按钮，记录你的想法。':mode==='favorites'?'点击提问下方的星标，即可收藏。':'归档后的对话会保留在这里。'));list.append(empty);}icons();
 }catch(e){if(seq===libraryRequest)list.replaceChildren(element('p','',e.message));}
 finally{if(seq===libraryRequest)list.setAttribute('aria-busy','false');}
}
function openLightweight(){
 if(!canFork())return;try{requireWorkbench();}catch(e){error(e);return;}
 const d=$('light-dialog');d._source={threadId:selected.threadId,turnId:selected.turnId,rootId:snapshot.root.id};
 $('light-context').value='';$('light-question').value=$('prompt').value;$('light-status').textContent='仅将下方确认的摘要和新问题带入新分支，不携带工具记录或原始历史。';$('light-create').disabled=false;d.showModal();
}
async function generateSummary(){
 const d=$('light-dialog');if(summaryJob)return;
 $('summary-generate').disabled=true;$('light-status').textContent='正在生成摘要…';
 try{
   const result=await api('summary',d._source);summaryJob=result.id;$('summary-stop').hidden=false;
   const poll=async()=>{try{const result=await api('summary?id='+summaryJob);$('light-status').textContent=result.status==='inProgress'?'摘要生成中…':'摘要已生成，可编辑后创建分支。';if(result.status==='completed'){$('light-context').value=result.text;finishSummary();}else if(['failed','interrupted'].includes(result.status)){finishSummary();$('light-status').textContent=result.error?.message||'摘要已停止，可重新生成或手动填写。';}else summaryTimer=setTimeout(poll,2000);}catch(e){finishSummary();$('light-status').textContent=e.message;}};await poll();
 }catch(e){finishSummary();$('light-status').textContent=e.message;}
}
function finishSummary(){clearTimeout(summaryTimer);summaryJob=null;$('summary-generate').disabled=false;$('summary-stop').hidden=true;}
function initWorkbench(){
 $('model-select').onchange=()=>{modelChoice=$('model-select').value;treeStorage.setItem('tree-model',modelChoice);modelUI?.update();};
 import('./model-picker.js').then(({initModelPicker})=>{modelUI=initModelPicker({select:$('model-select'),storage:treeStorage,api,supported:()=>features.has('model-effort')});if(features.has('model-effort'))modelUI.load();}).catch(()=>{$('model-select').title='请用 Restart.cmd 重启以启用新版模型面板';});
 const deletion=dialog('question-delete-dialog','删除此提问及后续内容');const summaryText=element('p');summaryText.id='question-delete-summary';const deletedList=element('ul');deletedList.id='question-delete-list';const recovery=element('p','muted','内容会保存在回收站。恢复时作为独立对话打开。');const deleteActions=element('div','dialog-actions');const cancel=element('button','','取消');cancel.type='button';cancel.onclick=()=>deletion.close();const confirm=element('button','danger','确认删除');confirm.type='button';confirm.onclick=()=>act(async()=>{const target=questionDeleteTarget;if(!target)return;persistDraft();const result=await api('questions/delete',target);pauseAffectedQueues(result.affectedIds);deletion.close();await loadCatalog(false);await loadTree(target.rootId,true);showBranchSelection({threadId:target.threadId,turnId:result.remainingTurnId});feedback('已移入回收站，后续提问不再使用删除的上下文');});deleteActions.append(cancel,confirm);deletion.append(summaryText,deletedList,recovery,deleteActions);
 const queue=element('section','question-queue');queue.id='question-queue';queue.hidden=true;queue.setAttribute('aria-label','当前分支的提问队列');$('composer').before(queue);
 const hint=element('span','compose-hint','Enter 发送 · Shift + Enter 换行');hint.id='compose-hint';$('prompt').setAttribute('aria-describedby','compose-hint');document.querySelector('.compose-actions').insertBefore(hint,$('stop'));
 window.addEventListener('resize',()=>{delete $('prompt').dataset.sizedValue;resizePrompt();});
 const notification=element('div','feedback');notification.id='feedback';notification.hidden=true;notification.setAttribute('role','status');notification.setAttribute('aria-live','polite');document.body.append(notification);
 const actions=element('div','sidebar-tools');actions.setAttribute('aria-label','资料与导航');
 for(const [glyph,label,title,fn] of [['search','全文搜索','全文搜索',()=>{$('global-search-dialog').showModal();$('global-query').focus();}],['star','收藏备注','收藏与备注',()=>openLibrary().catch(error)],['archive-restore','回收站','回收站',()=>openLibrary('trash').catch(error)],['locate-fixed','定位当前','定位当前提问',locateNode]]){const b=toolButton(glyph,title,fn);b.className='sidebar-tool';b.append(element('span','',label));if(label==='回收站'){b.id='recycle-bin';b.title='回收站 · 查看和恢复已删除分支';}actions.append(b);}$('tree-footer').append(actions);
 const head=document.querySelector('.chat-head');const menuButton=toolButton('ellipsis','分支操作',()=>{const menu=$('branch-menu');const opening=menu.hidden;populateBranchMenu();menu.hidden=!opening;menuButton.setAttribute('aria-expanded',String(opening));if(opening)menu.querySelector('button:not(:disabled)')?.focus();});menuButton.id='branch-menu-button';menuButton.setAttribute('aria-controls','branch-menu');menuButton.setAttribute('aria-expanded','false');
 const outline=toolButton('list','回答目录',()=>{outlineOpen=!outlineOpen;renderWorkbench();});outline.id='outline-toggle';outline.setAttribute('aria-controls','outline-list');outline.setAttribute('aria-expanded','false');
 const compare=toolButton('columns-2','对照分支',()=>{const select=$('compare-select');select.replaceChildren(...threads().filter(t=>t.id!==selected?.threadId).map(t=>{const o=element('option','',record(t.id)?.name||'主对话');o.value=t.id;return o;}));$('compare-open').disabled=!select.options.length;$('compare-dialog').showModal();});compare.id='compare-button';head.append(outline,compare,menuButton);
 const menu=element('div','branch-menu');menu.id='branch-menu';menu.hidden=true;head.append(menu);$('rename').classList.add('legacy-action');$('delete-branch').classList.add('legacy-action');
 menu.setAttribute('role','group');menu.setAttribute('aria-label','分支操作');
 menu.addEventListener('keydown',e=>{const buttons=[...menu.querySelectorAll('button:not(:disabled)')];const index=buttons.indexOf(document.activeElement);if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}if(e.key==='Tab')closeBranchMenu();});
 document.addEventListener('click',e=>{if(!e.composedPath().includes(menu)&&!e.composedPath().includes(menuButton))closeBranchMenu();if(outlineOpen&&!e.composedPath().includes($('outline-list'))&&!e.composedPath().includes(outline)){outlineOpen=false;$('outline-list').hidden=true;outline.setAttribute('aria-expanded','false');}});document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!menu.hidden)closeBranchMenu(true);if(outlineOpen){outlineOpen=false;$('outline-list').hidden=true;outline.setAttribute('aria-expanded','false');outline.focus();}$('quote-selection').hidden=true;}});
 const crumbs=element('nav','breadcrumbs');crumbs.id='breadcrumbs';crumbs.setAttribute('aria-label','分支路径');head.after(crumbs);
 const tools=element('div','reading-tools'),shared=element('button','');shared.id='shared-history';shared.hidden=true;shared.onclick=()=>{hideInherited=!hideInherited;saveLocal('tree-hide-inherited',hideInherited);renderWorkbench();};tools.append(shared);crumbs.after(tools);
 const ol=element('nav','outline-list');ol.id='outline-list';ol.setAttribute('aria-label','回答目录');ol.hidden=true;tools.append(ol);
 const pane=document.querySelector('.message-pane');pane.id='message-pane';const panel=element('section','compare-panel');panel.id='compare-panel';panel.hidden=true;
 const compareHead=element('div','compare-head');const title=element('strong');title.id='compare-heading';const label=element('label');const check=element('input');check.type='checkbox';check.checked=true;check.onchange=()=>{compareShared=check.checked;renderComparison();};const text=element('span');text.id='compare-common';label.append(check,text);compareHead.append(title,toolButton('x','关闭对照',()=>{compareId=null;renderComparison();}));const content=element('div');content.id='compare-content';panel.append(compareHead,label,content);pane.append(panel);
 const context=element('span');context.id='context-usage';document.querySelector('.compose-meta').append(context);
 const reading=element('fieldset');reading.append(element('legend','','阅读'));for(const [key,title,min,max,step] of [['size','字号',12,20,1],['line','行距',1.4,2.2,.05],['width','正文宽度',600,1200,20]]){const label=element('label','reading-setting');label.append(element('span','',title));const input=element('input');input.type='range';input.min=min;input.max=max;input.step=step;input.value=readingSettings[key];input.setAttribute('aria-label',title);const out=element('output','',String(input.value));input.oninput=()=>{readingSettings[key]=Number(input.value);out.value=input.value;applyReading();};label.append(input,out);reading.append(label);}$('settings-dialog').append(reading);applyReading();
 const storage=element('fieldset');storage.append(element('legend','','数据'));storage.append(command('download','备份全部对话',()=>act(async()=>{requireWorkbench();persistDraft();saveReading();const result=await api('export');result.browser={drafts,readingPositions,readingSettings,appearance:preferences};download('提问树备份-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify(result),'application/json');})));
 const upload=element('input');upload.type='file';upload.accept='.json,application/json';upload.hidden=true;storage.append(upload,command('upload','导入备份',()=>upload.click()));upload.onchange=async()=>{const file=upload.files[0];if(!file)return;try{if(file.size>64*1024*1024)throw new Error('备份超过 64 MB。');const backup=JSON.parse(await file.text());$('import-dialog')._backup=backup;$('import-summary').textContent='导入 '+(backup.roots?.length||0)+' 个对话、'+(backup.branches?.length||0)+' 个分支为独立历史副本。原有对话会保留，导入后可通过轻量分支继续。';$('import-dialog').showModal();}catch(e){error(e);}finally{upload.value='';}};$('settings-dialog').append(storage);
 const imp=dialog('import-dialog','导入备份');const desc=element('p');desc.id='import-summary';imp.append(desc,command('upload','确认导入',()=>act(async()=>{requireWorkbench();const result=await api('import',imp._backup);for(const [key,value] of Object.entries(imp._backup.browser?.drafts||{})){const [id,...rest]=key.split(':');if(result.idMap?.[id]&&typeof value==='string')drafts[result.idMap[id]+':'+rest.join(':')]=value;}saveLocal('tree-drafts',drafts);for(const [key,value] of Object.entries(imp._backup.browser?.readingPositions||{})){const [id,...rest]=key.split(':');if(result.idMap?.[id])readingPositions[result.idMap[id]+':'+rest.join(':')]=value;}saveLocal('tree-reading',readingPositions);imp.close();$('settings-dialog').close();await loadCatalog(false);await loadTree(result.rootIds[0]);})));
 const compareDialog=dialog('compare-dialog','对照分支');const select=element('select');select.id='compare-select';select.setAttribute('aria-label','选择对照分支');const open=command('columns-2','开始对照',()=>{compareId=select.value;compareDialog.close();renderComparison();});open.id='compare-open';compareDialog.append(select,open);
 const notes=dialog('note-dialog','提问备注');const note=element('textarea');note.id='note-input';note.rows=7;note.maxLength=10000;note.setAttribute('aria-label','备注内容');notes.append(note,command('check','保存备注',()=>act(async()=>{await metadata(notes.dataset.key,{...notes._info,note:note.value});notes.close();})));
 const lib=dialog('library-dialog','收藏与资料');const description=element('p','muted');description.id='library-description';lib.setAttribute('aria-describedby',description.id);const mode=element('select');mode.id='library-mode';mode.setAttribute('aria-label','资料分类');for(const [value,label] of [['favorites','收藏'],['notes','备注'],['archived','归档'],['trash','回收站']]){const o=element('option','',label);o.value=value;mode.append(o);}mode.onchange=fillLibrary;const list=element('div','library-list');list.id='library-list';lib.append(description,mode,list);
 const search=dialog('global-search-dialog','全文搜索');const form=element('form','global-search-form');const q=element('input');q.id='global-query';q.type='search';q.placeholder='搜索所有问题与回答';q.setAttribute('aria-label','搜索所有问题与回答');const go=toolButton('search','搜索全文',()=>form.requestSubmit());const results=element('div','search-results');results.id='global-results';form.append(q,go);search.append(form,results);
 form.onsubmit=async e=>{e.preventDefault();const query=q.value.trim();if(!query)return;const seq=++searchRequest;results.replaceChildren(element('p','muted','正在搜索…'));try{requireWorkbench();const result=await api('search?q='+encodeURIComponent(query));if(seq!==searchRequest)return;results.replaceChildren(element('p','muted','找到 '+result.total+' 条'+(result.total>200?'，显示前 200 条':'')));for(const r of result.results){const b=element('button','search-result');b.append(element('strong','',r.name+' · '+r.role),element('span','',r.snippet));b.onclick=()=>{search.close();navigateNode(r.rootId,r.threadId,r.turnId,r.itemId).catch(error);};results.append(b);}}catch(e){if(seq===searchRequest)results.replaceChildren(element('p','',e.message));}};
 const light=dialog('light-dialog','轻量分支');const status=element('p','muted');status.id='light-status';const summary=element('textarea');summary.id='light-context';summary.rows=9;summary.maxLength=85000;summary.placeholder='确认保留的上下文摘要';summary.setAttribute('aria-label','保留的上下文摘要');const generate=command('sparkles','生成摘要',generateSummary);generate.id='summary-generate';const stop=command('square','停止摘要',async()=>{if(summaryJob)await api('stop',{threadId:summaryJob}).catch(error);});stop.id='summary-stop';stop.hidden=true;const question=element('textarea');question.id='light-question';question.rows=3;question.placeholder='新问题';question.setAttribute('aria-label','轻量分支的新问题');const create=command('git-fork','确认并创建',()=>act(async()=>{if(!summary.value.trim()||!question.value.trim())throw new Error('请填写摘要和新问题。');if(summaryJob)throw new Error('请等待摘要完成或停止生成。');const result=await api('lightweight',{...light._source,context:summary.value,text:question.value,...modelSettings()});light.close();await loadTree(light._source.rootId,true);selected={threadId:result.id,turnId:null};renderTree();renderChat();$('prompt').value='';persistDraft();}));create.id='light-create';light.append(status,generate,stop,summary,question,create);light.addEventListener('close',()=>{if(summaryJob){api('stop',{threadId:summaryJob}).catch(()=>{});finishSummary();}});
 const quote=element('div','quote-selection');quote.id='quote-selection';quote.hidden=true;quote.append(command('quote','引用',()=>{if(quoteSelection)insertQuote(quoteSelection.text,quoteSelection.turnId);quote.hidden=true;}),command('git-fork','引用并分叉',()=>act(async()=>{const saved=quoteSelection;if(!saved)return;const turn=current()?.turns.find(t=>t.id===saved.turnId);if(!turn||turn.status==='inProgress')throw new Error('请等待当前提问结束。');await forkAt(turn);$('prompt').value='> '+saved.text.split('\n').join('\n> ')+'\n\n';persistDraft();quote.hidden=true;})));document.body.append(quote);
 $('messages').addEventListener('mouseup',()=>{const selection=window.getSelection();const range=selection?.rangeCount?selection.getRangeAt(0):null;const article=selection?.anchorNode?.parentElement?.closest('article[data-turn-id]');if(!range||!article||!$('messages').contains(article)||!selection.toString().trim()){quote.hidden=true;return;}quoteSelection={text:selection.toString().slice(0,20000),turnId:article.dataset.turnId};const bounds=range.getBoundingClientRect();quote.style.left=Math.max(8,Math.min(innerWidth-240,bounds.left))+'px';quote.style.top=Math.max(8,Math.min(innerHeight-50,bounds.bottom+6))+'px';quote.hidden=false;icons();});
 document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();search.showModal();q.focus();}});
 icons();
}
initWorkbench();
let executionLoading;
async function ensureExecution(){
 if(!features.has('automatic-edit')||executionUI)return;
 executionLoading ||= import('./execution-ui.js').then(({initExecution})=>{executionUI=initExecution({api,context:()=>({pendingNew,selected,enabled:features.has('automatic-edit'),threads:threads()}),navigate:(threadId,turnId,rootId)=>navigateNode(rootId||threadId,threadId,turnId).catch(error)});executionUI.update();}).catch(e=>{executionLoading=null;throw e;});
 await executionLoading;
}
setInterval(pumpQuestionQueues,2000);
initConnections(persistDraft);
try{icons();await prepareConnection();const session=await api('session');token=session.token;features=new Set(session.features||[]);await ensureExecution();modelUI?.load();connectEvents();await loadCatalog();}catch(e){error(e);$('connection').textContent='连接失败';$('dot').className='offline';}
async function openHash(){const p=new URLSearchParams(location.hash.slice(1));if(p.get('root')&&p.get('thread'))await navigateNode(p.get('root'),p.get('thread'),p.get('turn')||null);}
window.addEventListener('hashchange',()=>openHash().catch(error));await openHash().catch(error);

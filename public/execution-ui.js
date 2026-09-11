// Render native Codex requests beside the composer. No client-side permission policy.
export function initExecution({api,context,navigate}) {
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const button=(text,fn)=>{const b=el('button',text);b.type='button';b.onclick=fn;return b;};
 const panel=el('section',undefined,'approval-panel');panel.id='approval-panel';panel.hidden=true;panel.setAttribute('aria-label','Codex 访问请求');
 const heading=el('div',undefined,'approval-heading'),title=el('strong','需要你的确认'),count=el('span',undefined,'muted');
 const compact=button('收起详情',()=>{collapsed=!collapsed;update();});compact.setAttribute('aria-controls','approval-list');
 heading.append(title,count,compact);const list=el('div',undefined,'interaction-list');list.id='approval-list';panel.append(heading,list);
 document.querySelector('#composer').before(panel);
 const announcement=el('span',undefined,'approval-announcement');announcement.setAttribute('role','status');document.body.append(announcement);
 const badge=button('其他分支待确认',()=>{showAll=!showAll;collapsed=false;update();});badge.id='interaction-inbox';badge.className='interaction-inbox';badge.hidden=true;document.querySelector('header').append(badge);
 const pending=new Map(),cards=new Map();let syncBusy=false,initialized=false,showAll=false,collapsed=false,lastThread=null,lastAnnounced='',revision=0;
 function requestedPaths(profile,card){
   if(!profile)return;
   const scopes=el('ul',undefined,'permission-scopes'),fs=profile.fileSystem,seen=new Set();
   const add=(label,path)=>{const text=label+'：'+path;if(!seen.has(text)){seen.add(text);scopes.append(el('li',text));}};
   for(const [key,label] of [['read','读取'],['write','读写']])for(const path of fs?.[key]||[])add(label,path);
   for(const entry of fs?.entries||[]){const p=entry.path;const value=p?.path||p?.pattern||(typeof p?.value==='string'?p.value:JSON.stringify(p?.value));add({read:'读取',write:'读写',none:'禁止'}[entry.access]||entry.access,value);}
   if(profile.network?.enabled)scopes.append(el('li','访问网络'));
   if(scopes.children.length)card.append(scopes);
 }
 function makeCard(request){
   const p=request.params,card=el('article',undefined,'interaction-card');card.dataset.requestId=request.id;
   const isQuestion=request.method==='item/tool/requestUserInput',isPermission=request.method==='item/permissions/requestApproval',isFile=request.method==='item/fileChange/requestApproval',isNetwork=!!p.networkApprovalContext;
   const head=el('div',undefined,'interaction-card-head');head.append(el('strong',isQuestion?'需要补充信息':isPermission?'申请访问权限':isFile?'申请修改文件':isNetwork?'申请网络访问':'申请执行命令'));
   head.append(el('span',p.threadName||'当前分支','muted'));card.append(head);
   if(p.reason)card.append(el('p',p.reason,'approval-reason'));
   if(isNetwork)card.append(el('p',p.networkApprovalContext.protocol+'://'+p.networkApprovalContext.host,'interaction-path'));
   requestedPaths(p.permissions||p.additionalPermissions,card);
   if(p.grantRoot)card.append(el('p','申请写入：'+p.grantRoot,'interaction-path'));
   if(isPermission)card.append(el('p','“本次会话允许”仅覆盖本请求列出的资源；“允许完全访问”会在本次会话内开放文件读写和网络访问。','muted'));
   if(isFile&&p.grantRoot)card.append(el('p','此请求包含目录授权，Codex 可能将授权保留到本次会话结束。','muted'));
   const item=p.reviewItem||context().threads.find(t=>t.id===p.threadId)?.turns.flatMap(t=>t.items||[]).find(i=>i.id===p.itemId);
   if(p.command||p.cwd||item?.changes?.length){
     const details=el('details',undefined,'approval-details');details.open=true;details.append(el('summary','操作详情'));
     if(p.cwd)details.append(el('p','执行位置：'+p.cwd,'interaction-path'));
     if(p.command)details.append(el('pre',p.command));
     for(const change of item?.changes||[]){details.append(el('p',change.path,'interaction-path'));if(change.diff)details.append(el('pre',change.diff));}
     card.append(details);
   }
   const answers=new Map();
   if(isQuestion)for(const q of p.questions){
     const label=el('label',q.question);let field;
     if(q.options?.length&&!q.isOther){field=el('select');const empty=el('option','请选择');empty.value='';field.append(empty);for(const o of q.options){const opt=el('option',o.label+' — '+o.description);opt.value=o.label;field.append(opt);}}
     else {field=el('input');field.type=q.isSecret?'password':'text';if(q.options?.length)label.append(el('p',q.options.map(o=>o.label+'：'+o.description).join('\n'),'muted'));}
     field.setAttribute('aria-label',q.question);field.autocomplete='off';label.append(field);card.append(label);answers.set(q.id,field);
   }
   const result=el('p',undefined,'execution-status');result.setAttribute('role','status');const actions=el('div',undefined,'approval-actions');
   async function respond(choiceId){
     actions.querySelectorAll('button').forEach(b=>b.disabled=true);result.textContent='';
     try{
       await api('interactions/respond',{id:request.id,...(isQuestion?{answers:Object.fromEntries([...answers].map(([id,field])=>[id,field.value]))}:{choiceId})});
       revision++;pending.delete(request.id);cards.delete(request.id);update();
     }catch(e){result.textContent=e.message;actions.querySelectorAll('button').forEach(b=>b.disabled=false);sync();}
   }
   if(isQuestion)actions.append(button('提交回答',()=>respond()));
   else for(const choice of request.choices||[]){
     const b=button(choice.label,()=>respond(choice.id));b.dataset.choice=choice.id;
     if(choice.fullAccess)b.classList.add('full-access');
     if(choice.detail){b.title=choice.detail;const rule=el('details',undefined,'approval-details');rule.append(el('summary',choice.label+' · 查看规则'),el('pre',choice.detail));card.append(rule);}
     actions.append(b);
   }
   const visit=button('转到此分支',()=>navigate(p.threadId,p.turnId,p.rootId));visit.className='approval-visit';visit.hidden=context().selected?.threadId===p.threadId;card.append(visit,result,actions);return card;
 }
 function update(){
   const c=context(),thread=c.pendingNew?null:c.selected?.threadId;
   if(thread!==lastThread){showAll=false;collapsed=false;lastThread=thread;}
   if(c.enabled&&!initialized){initialized=true;sync();}
   const other=[...pending.values()].filter(r=>r.params.threadId!==thread);
   badge.hidden=!other.length;badge.textContent='其他分支待确认 · '+other.length;badge.setAttribute('aria-expanded',String(showAll));
   const visible=[...pending.values()].filter(r=>showAll||r.params.threadId===thread);
   panel.hidden=!visible.length;count.textContent=visible.length>1?visible.length+' 项':'';compact.textContent=collapsed?'展开请求':'收起详情';compact.setAttribute('aria-expanded',String(!collapsed));list.hidden=collapsed;
   // Reuse cards so polling and streaming never erase typed answers or focus.
   const wanted=new Set(visible.map(r=>r.id));for(const card of [...list.children])if(!wanted.has(card.dataset.requestId))card.remove();
   for(const request of visible){let card=cards.get(request.id);if(!card){card=makeCard(request);cards.set(request.id,card);}card.querySelector('.approval-visit').hidden=request.params.threadId===thread;if(card.parentElement!==list)list.append(card);}
   for(const id of cards.keys())if(!pending.has(id))cards.delete(id);
   title.textContent=visible.some(r=>r.method==='item/tool/requestUserInput')?'Codex 正在等待你的答复':'Codex 正在等待批准';
   const announced=visible.map(r=>r.id).join(',');if(announced!==lastAnnounced){lastAnnounced=announced;announcement.textContent=visible.length?'有 '+visible.length+' 个请求需要你处理。':'';}
 }
 async function sync(){
   if(syncBusy||!context().enabled)return;syncBusy=true;const before=revision;
   try{const result=await api('interactions');if(before!==revision)return;const ids=new Set(result.requests.map(r=>r.id));for(const id of pending.keys())if(!ids.has(id))pending.delete(id);for(const r of result.requests)if(!pending.has(r.id))pending.set(r.id,r);update();}catch{}finally{syncBusy=false;}
 }
 function event(msg){
   if(msg.method==='tree/interaction'){revision++;pending.set(msg.params.request.id,msg.params.request);collapsed=false;update();}
   if(msg.method==='tree/interactionResolved'){revision++;pending.delete(msg.params.id);update();}
   if(msg.method==='disconnected'){revision++;pending.clear();update();}
 }
 setInterval(sync,3000);window.addEventListener('focus',sync);return {update,event};
}

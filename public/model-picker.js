const labels={none:'关闭',minimal:'最低',low:'轻度',medium:'标准',high:'高',xhigh:'极高',max:'最高',ultra:'超高'};
const el=(tag,cls,text)=>{const node=document.createElement(tag);node.className=cls;if(text)node.textContent=text;return node;};
export function initModelPicker({select,storage,api,supported}){
 const host=select.closest('.model-picker');host.classList.add('has-panel');select.hidden=true;
 const trigger=el('button','model-trigger');trigger.type='button';trigger.id='model-trigger';trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');
 const name=el('span','model-trigger-name'),level=el('span','model-trigger-effort'),chevron=el('span','model-chevron');trigger.append(name,level,chevron);host.append(trigger);
 const panel=el('div','model-panel');panel.id='model-panel';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-label','模型与推理强度');trigger.setAttribute('aria-controls',panel.id);document.body.append(panel);
 const heading=el('div','model-panel-heading','模型'),list=el('div','model-options');list.setAttribute('role','group');list.setAttribute('aria-label','可用模型');
 const section=el('section','effort-section'),title=el('div','effort-heading'),output=el('output','effort-value');title.append(el('span','','推理强度'),output);
 const slider=el('input','effort-slider');slider.type='range';slider.id='model-effort';slider.min='0';slider.step='1';slider.setAttribute('aria-label','推理强度');
 const ticks=el('div','effort-ticks'),hint=el('p','effort-hint','较高强度适合复杂任务，可能需要更长时间。'),status=el('p','model-panel-status');status.setAttribute('role','status');
 section.append(title,slider,ticks,hint);panel.append(heading,list,section,status);
 let models=[],loaded=false,loading=false,efforts={};try{efforts=JSON.parse(storage.getItem('tree-model-efforts')||'{}')||{};}catch{}
 const selectedModel=()=>models.find(m=>m.model===select.value);
 const levels=()=>selectedModel()?.supportedReasoningEfforts?.map(e=>e.reasoningEffort)||[];
 const effort=()=>{const options=levels();return options.includes(efforts[select.value])?efforts[select.value]:options.includes(selectedModel()?.defaultReasoningEffort)?selectedModel().defaultReasoningEffort:options[0];};
 function position(){if(panel.hidden)return;const box=trigger.getBoundingClientRect();panel.style.width=Math.min(340,innerWidth-24)+'px';panel.style.maxHeight=Math.max(120,innerHeight-24)+'px';const height=panel.getBoundingClientRect().height;panel.style.left=Math.max(12,Math.min(innerWidth-panel.offsetWidth-12,box.right-panel.offsetWidth))+'px';panel.style.top=Math.max(12,box.top-height-8)+'px';}
 function update(){
   name.textContent=select.selectedOptions[0]?.textContent||select.value||'选择模型';const value=effort();level.textContent=labels[value]||value||'';level.hidden=!value;
   trigger.setAttribute('aria-label','选择模型与推理强度：'+name.textContent+(value?'，'+level.textContent:''));
   for(const b of list.children){const active=b.dataset.model===select.value;b.setAttribute('aria-pressed',String(active));b.querySelector('.model-check').textContent=active?'✓':'';}
   const options=levels();section.hidden=!options.length;slider.max=String(Math.max(0,options.length-1));slider.value=String(Math.max(0,options.indexOf(value)));slider.disabled=options.length<2;slider.setAttribute('aria-valuetext',labels[value]||value||'');output.textContent=labels[value]||value||'';
   slider.style.setProperty('--range-fill',(options.length>1?Number(slider.value)/(options.length-1)*100:0)+'%');
   if(ticks.dataset.levels!==options.join(',')){ticks.replaceChildren();for(const [i,v] of options.entries()){const b=el('button','',labels[v]||v);b.type='button';b.onclick=()=>{slider.value=String(i);slider.dispatchEvent(new Event('input'));};ticks.append(b);}ticks.dataset.levels=options.join(',');}
   for(const [i,b] of [...ticks.children].entries())b.setAttribute('aria-pressed',String(i===Number(slider.value)));
   position();
 }
 function render(){list.replaceChildren();for(const m of models){const button=el('button','model-option');button.type='button';button.dataset.model=m.model;button.append(el('span','',m.displayName||m.model),el('span','model-check'));button.onclick=()=>{select.value=m.model;select.dispatchEvent(new Event('change',{bubbles:true}));update();};list.append(button);}update();}
 async function load(){if(loaded||loading)return;loading=true;status.textContent='正在读取可用模型…';try{
   if(!supported())throw new Error('请用 Restart.cmd 重启服务，以启用模型与推理强度设置。');
   const result=await api('models');models=result.data.filter(m=>!m.hidden);if(!models.length)throw new Error('当前连接未提供可用模型。');
   const previous=select.value;select.replaceChildren();for(const m of models){const option=el('option','',m.displayName||m.model);option.value=m.model;select.append(option);}if(models.some(m=>m.model===previous))select.value=previous;else select.value=(models.find(m=>m.isDefault)||models[0]).model;
   loaded=true;select.dispatchEvent(new Event('change',{bubbles:true}));status.textContent='用于接下来发送的提问；正在运行的回答保持原设置。';render();
 }catch(e){status.textContent=e.message;list.replaceChildren();}finally{loading=false;position();}}
 function close(focus=false){panel.hidden=true;trigger.setAttribute('aria-expanded','false');if(focus)trigger.focus();}
 trigger.onclick=()=>{if(!panel.hidden){close();return;}panel.hidden=false;trigger.setAttribute('aria-expanded','true');update();load();};
 slider.oninput=()=>{const value=levels()[Number(slider.value)];if(!value)return;efforts[select.value]=value;try{storage.setItem('tree-model-efforts',JSON.stringify(efforts));}catch{}update();};
 document.addEventListener('pointerdown',e=>{if(!panel.contains(e.target)&&!trigger.contains(e.target))close();});
 document.addEventListener('keydown',e=>{if(!panel.hidden&&e.key==='Escape'){e.preventDefault();close(true);}});
 document.addEventListener('focusin',e=>{if(!panel.hidden&&!panel.contains(e.target)&&!host.contains(e.target))close();});
 trigger.addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();if(panel.hidden)trigger.click();list.querySelector('button')?.focus();}});
 panel.addEventListener('keydown',e=>{if(e.key!=='Tab')return;const nodes=[...panel.querySelectorAll('button,input')].filter(n=>!n.disabled&&n.getClientRects().length);if(e.shiftKey&&e.target===nodes[0]){e.preventDefault();trigger.focus();}else if(!e.shiftKey&&e.target===nodes.at(-1)){e.preventDefault();close(true);}});
 window.addEventListener('resize',position);update();
 return {update,load,settings:()=>({model:select.value,...(effort()?{effort:effort()}:{})})};
}

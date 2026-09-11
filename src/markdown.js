import {Marked} from './marked.js';
import {highlightedCode} from './code-highlight.js';
import katex from 'katex';
import splitAtDelimiters from 'katex/contrib/auto-render/splitAtDelimiters.ts';

const delimiters=[
 {left:'$$',right:'$$',display:true},
 {left:'\\[',right:'\\]',display:true},
 {left:'\\(',right:'\\)',display:false},
 {left:'$',right:'$',display:false},
];
function mathToken(source,block=false){
 const leading=block?(source.match(/^ {0,3}/)?.[0]||''):'';
 const text=source.slice(leading.length);
 const delimiter=delimiters.find(d=>text.startsWith(d.left)&&(!block||d.display));
 if(!delimiter)return;
 const part=splitAtDelimiters(text,[delimiter])[0];
 if(part?.type!=='math'||!part.data.trim())return;
 if(delimiter.left==='$'&&(/^\s|\s$|\n/.test(part.data)||/^\d/.test(text.slice(part.rawData.length))))return;
 return {type:'math',raw:leading+part.rawData,text:part.data,display:part.display,block};
}
// Recognize math before Markdown consumes backslash escapes or emphasis markers.
const parser=new Marked({extensions:[
 {name:'math',level:'block',start:source=>source.search(/(?:^|\n) {0,3}(?:\$\$|\\\[)/),tokenizer:source=>mathToken(source,true)},
 {name:'math',level:'inline',start:source=>source.search(/\$|\\[([]/),tokenizer:source=>mathToken(source)},
]});
const mathCache=new Map();
function formula(token){
 const key=String(token.display)+':'+token.text;
 let content=mathCache.get(key);
 if(!content){
   content=document.createElement('span');
   try{
     if(token.text.length>10000)throw new Error('Formula exceeds size limit');
     katex.render(token.text,content,{output:'mathml',displayMode:token.display,trust:false,strict:'ignore',throwOnError:true,maxExpand:500,maxSize:20,macros:{}});
   }catch{
     content.className='math-fallback';content.textContent=token.raw;
   }
   if(mathCache.size>=256)mathCache.delete(mathCache.keys().next().value);
   mathCache.set(key,content);
 }
 const wrapper=document.createElement(token.block?'div':'span');
 wrapper.className=token.display?'math-display':'math-inline';
 wrapper.dataset.latex=token.text;
 if(token.display){wrapper.tabIndex=0;wrapper.setAttribute('aria-label','公式');}
 wrapper.append(content.cloneNode(true));return wrapper;
}

// Raw history HTML is always text. Only KaTeX generates formula markup, with
// external resources and HTML-extension commands disabled by trust:false.
export function markdown(text){
 const fragment=document.createDocumentFragment();
 const render=(tokens,parent,inline=false)=>{
  for(const token of tokens||[]){
   let el;
   const append=(tag,children=token.tokens)=>{el=document.createElement(tag);render(children,el,true);parent.append(el);return el;};
   switch(token.type){
    case 'math':parent.append(formula(token));break;
    case 'space':break;
    case 'paragraph':append('p');break;
    case 'heading':append('h'+Math.min(4,token.depth+1));break;
    case 'strong':append('strong');break;
    case 'em':append('em');break;
    case 'del':append('s');break;
    case 'blockquote':el=document.createElement('blockquote');render(token.tokens,el);parent.append(el);break;
    case 'code':el=document.createElement('pre');el.dataset.language=(token.lang||'text').split(/\s/)[0];el.append(highlightedCode(token.text,el.dataset.language));parent.append(el);break;
    case 'codespan':el=document.createElement('code');el.textContent=token.text;parent.append(el);break;
    case 'br':parent.append(document.createElement('br'));break;
    case 'hr':parent.append(document.createElement('hr'));break;
    case 'list':el=document.createElement(token.ordered?'ol':'ul');if(token.ordered)el.start=token.start||1;for(const item of token.items){const li=document.createElement('li');render(item.tokens,li);el.append(li);}parent.append(el);break;
    case 'link':{
     let url;try{url=new URL(token.href)}catch{}
     el=append(url&&['https:','http:','mailto:'].includes(url.protocol)?'a':'span');
     if(el.tagName==='A'){el.href=url.href;el.target='_blank';el.rel='noopener noreferrer';}break;
    }
    case 'table':{
     el=document.createElement('table');const head=document.createElement('tr');for(const cell of token.header){const th=document.createElement('th');render(cell.tokens,th,true);head.append(th);}el.append(head);
     for(const row of token.rows){const tr=document.createElement('tr');for(const cell of row){const td=document.createElement('td');render(cell.tokens,td,true);tr.append(td);}el.append(tr);}const wrapper=document.createElement('div');wrapper.className='table-scroll';wrapper.append(el);parent.append(wrapper);break;
    }
    case 'text':if(token.tokens)render(token.tokens,parent,inline);else parent.append(document.createTextNode(token.text||''));break;
    case 'html':parent.append(document.createTextNode(token.text||token.raw||''));break;
    case 'image':parent.append(document.createTextNode('[图片：'+token.text+']'));break;
    case 'escape':parent.append(document.createTextNode(token.text||''));break;
    default:parent.append(document.createTextNode(token.raw||token.text||''));
   }
  }
 };
 render(parser.lexer(text),fragment);return fragment;
}

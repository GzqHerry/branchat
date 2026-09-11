import hljs from 'highlight.js/lib/core';
import python from 'highlight.js/lib/languages/python';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import bash from 'highlight.js/lib/languages/bash';
import powershell from 'highlight.js/lib/languages/powershell';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import cpp from 'highlight.js/lib/languages/cpp';
import c from 'highlight.js/lib/languages/c';
import java from 'highlight.js/lib/languages/java';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import ini from 'highlight.js/lib/languages/ini';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import diff from 'highlight.js/lib/languages/diff';

for(const [name,grammar] of Object.entries({python,javascript,typescript,bash,powershell,json,yaml,xml,css,cpp,c,java,go,rust,sql,ini,dockerfile,diff}))hljs.registerLanguage(name,grammar);
const aliases={jsx:'javascript',tsx:'typescript',zsh:'bash',shell:'bash',console:'bash',toml:'ini'};
const cache=new Map();
export function highlightedCode(text,language){
 const code=document.createElement('code');code.textContent=text;
 const name=String(language||'text').toLowerCase(),resolved=aliases[name]||name;
 // Keep long outputs, unknown languages and unlabelled text cheap and literal.
 if(text.length>50000||!hljs.getLanguage(resolved))return code;
 try{
   const key=resolved+'\0'+text;let html=cache.get(key);
   if(html===undefined){html=hljs.highlight(text,{language:resolved,ignoreIllegals:true}).value;if(cache.size>=64)cache.delete(cache.keys().next().value);cache.set(key,html);}
   // Highlight.js escapes source characters; only its generated span markup
   // is parsed. Never interpolate raw code into HTML.
   const template=document.createElement('template');template.innerHTML=html;
   if(template.content.textContent!==text)return code;
   code.replaceChildren(template.content);code.className='hljs';
 }catch{ /* Incomplete streamed code remains readable if parsing fails. */ }
 return code;
}

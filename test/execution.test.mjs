import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, realpath, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {resolveWorkspace, turnExecution, threadExecution, InteractionBridge} from '../execution.mjs';

test('default editing allocates workspace automatically and migrates old chat/edit tasks',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'tree-auto-work-')),id='80000000-0000-0000-0000-000000000001';
 const cwd=await resolveWorkspace({id,execution:{mode:'chat'}},root);assert.ok((await stat(cwd)).isDirectory());
 assert.equal(await resolveWorkspace({id,workspaceCwd:cwd},root),cwd);
 assert.equal(await resolveWorkspace({id,execution:{mode:'edit',cwd:process.cwd()}},root),await realpath(process.cwd()));
 assert.equal(await resolveWorkspace({id},root,process.cwd()),await realpath(process.cwd()));
 await assert.rejects(()=>resolveWorkspace({id:'../escape'},root));
 assert.equal(threadExecution(cwd).approvalPolicy,'on-request');assert.equal(threadExecution(cwd).sandbox,'workspace-write');
 assert.deepEqual(turnExecution(cwd),{environments:[{environmentId:'local',cwd}]});
});
test('approval requires explicit answer; duplicate or unknown grants rejected; exact turn-scoped permissions',()=>{
 const sent=[],events=[];const b=new InteractionBridge({send:x=>sent.push(x)},id=>id==='known'?id:null,(...e)=>events.push(e));
 b.receive({id:7,method:'item/permissions/requestApproval',params:{threadId:'known',turnId:'one',permissions:{network:{enabled:true},fileSystem:null}}});
 assert.equal(sent.length,0);assert.equal(b.list().length,1);assert.throws(()=>b.answer({id:'7',decision:'acceptForSession'}));
 b.answer({id:'7',decision:'accept',permissions:{fileSystem:{write:['C:/']}}});assert.deepEqual(sent[0],{id:7,result:{permissions:{network:{enabled:true}},scope:'turn'}});assert.throws(()=>b.answer({id:'7',decision:'accept'}));
 b.receive({id:'denied',method:'item/permissions/requestApproval',params:{threadId:'known',permissions:{network:{enabled:true}}}});b.answer({id:'"denied"',decision:'decline'});assert.deepEqual(sent.at(-1).result,{permissions:{},scope:'turn'});
 b.receive({id:9,method:'item/fileChange/requestApproval',params:{threadId:'other'}});assert.equal(sent.at(-1).error.code,-32601);
 b.receive({id:10,method:'item/tool/call',params:{threadId:'known'}});assert.equal(sent.at(-1).error.code,-32601);
});
test('session grants and native decision choices preserve requested scope; client cannot invent rules',()=>{
 const sent=[];const b=new InteractionBridge({send:x=>sent.push(x)},id=>id,()=>{});
 const permissions={fileSystem:{read:null,write:['C:/projects/large']},network:null};
 b.receive({id:20,method:'item/permissions/requestApproval',params:{threadId:'t',permissions}});
 b.answer({id:'20',choiceId:'session',permissions:{fileSystem:{write:['C:/']}}});
 assert.deepEqual(sent.at(-1).result,{permissions:{fileSystem:permissions.fileSystem},scope:'session'});
 b.receive({id:201,method:'item/permissions/requestApproval',params:{threadId:'t',permissions:{fileSystem:{write:['C:/limited']}}}});
 b.answer({id:'201',choiceId:'full-session'});
 assert.deepEqual(sent.at(-1).result,{permissions:{fileSystem:{read:null,write:null},network:{enabled:true}},scope:'session'});
 const rule={acceptWithExecpolicyAmendment:{execpolicy_amendment:['git','status']}};
 b.receive({id:21,method:'item/commandExecution/requestApproval',params:{threadId:'t',availableDecisions:['decline',rule]}});
 assert.throws(()=>b.answer({id:'21',choiceId:'acceptForSession'}));
 b.answer({id:'21',choiceId:'rule-1',decision:{acceptWithExecpolicyAmendment:{execpolicy_amendment:['powershell']}}});assert.deepEqual(sent.at(-1).result,{decision:rule});
 b.receive({id:23,method:'item/commandExecution/requestApproval',params:{threadId:'t',availableDecisions:[rule]}});
 b.answer({id:'23',decision:rule});assert.deepEqual(sent.at(-1).result,{decision:rule});
 b.receive({id:22,method:'item/fileChange/requestApproval',params:{threadId:'t'}});b.answer({id:'22',choiceId:'acceptForSession'});assert.equal(sent.at(-1).result.decision,'acceptForSession');
});
test('questions preserve IDs and validate options; stale turn requests clear',()=>{
 const sent=[];const b=new InteractionBridge({send:x=>sent.push(x)},id=>id,()=>{});
 b.receive({id:1,method:'item/tool/requestUserInput',params:{threadId:'t',turnId:'a',questions:[{id:'choice',options:[{label:'yes'}],isOther:false}]}});
 assert.throws(()=>b.answer({id:'1',answers:{choice:'invented'}}));b.answer({id:'1',answers:{choice:'yes'}});assert.deepEqual(sent[0].result,{answers:{choice:{answers:['yes']}}});
 b.receive({id:2,method:'item/commandExecution/requestApproval',params:{threadId:'t',turnId:'b'}});b.clear('t','a');assert.equal(b.list().length,1);b.clear('t','b');assert.equal(b.list().length,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {restoreSnapshot, metadataPatch, transcript} from '../library.mjs';
import {nextBranchName} from '../branch-name.mjs';
const turn={id:'t1',status:'inProgress',items:[{type:'userMessage',content:[{type:'text',text:'Question'}]},{type:'agentMessage',text:'Answer'},{type:'reasoning',text:'private'}]};
const backup=()=>({format:'conversation-tree',version:1,roots:[{id:'r',name:'Root',thread:{turns:[turn]}}],branches:[{id:'b',rootId:'r',parentId:'r',prefixCount:1,pivotTurnId:'t1',thread:{turns:[turn]}}],metadata:{'b:t1':{favorite:true,note:'Keep',rootId:'r',threadId:'b',turnId:'t1'}}});
test('portable restore remaps IDs, graph and bookmarks without preserving running state or private reasoning',()=>{
 const result=restoreSnapshot(backup());const root=result.rootIds[0],branch=Object.values(result.branches)[0];
 assert.notEqual(root,'r');assert.equal(branch.parentId,root);assert.equal(branch.rootId,root);
 assert.equal(result.imports[root].turns[0].status,'interrupted');assert.equal(result.imports[root].turns[0].items.length,2);
 assert.equal(result.metadata[branch.id+':t1'].threadId,branch.id);assert.equal(result.metadata[branch.id+':t1'].rootId,root);
 assert.notEqual(restoreSnapshot(backup()).rootIds[0],root);
});
test('reject invalid backups and cycles before import',()=>{
 assert.throws(()=>restoreSnapshot({}),/有效/);
 const value=backup();value.branches[0].parentId='b';assert.throws(()=>restoreSnapshot(value),/循环/);
 value.branches[0].parentId='missing';assert.throws(()=>restoreSnapshot(value),/关系/);
 value.branches[0].parentId='r';value.branches[0].prefixCount=-1;assert.throws(()=>restoreSnapshot(value),/关系/);
});
test('repeated imports keep independent recycle-bin batches',()=>{
 const data=backup();Object.assign(data.branches[0],{hidden:true,deletionId:'same-source-batch'});
 const a=Object.values(restoreSnapshot(data).branches)[0],b=Object.values(restoreSnapshot(data).branches)[0];
 assert.notEqual(a.deletionId,b.deletionId);
});
test('metadata allows known fields only and export contains public Q&A',()=>{
 assert.deepEqual(metadataPatch({}, {favorite:true,hidden:true,note:'A'}),{favorite:true,note:'A'});
 const text=transcript({turns:[turn]});assert.match(text,/Question/);assert.match(text,/Answer/);assert.doesNotMatch(text,/private/);
 assert.equal(nextBranchName({b:{rootId:'r',name:'Automatic title',numberLabel:'分支 1'}},'r'),'分支 2');
});

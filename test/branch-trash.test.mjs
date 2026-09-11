import {test} from 'node:test';
import assert from 'node:assert/strict';
import {branchSubtree,deletionChanges,restorationChanges} from '../branch-trash.mjs';
const fixture=()=>({a:{id:'a',parentId:'root',name:'A'},b:{id:'b',parentId:'a',name:'B'},c:{id:'c',parentId:'root',name:'C'},old:{id:'old',parentId:'a',name:'Old',hidden:true,deletionId:'earlier'}});
const apply=(branches,changes)=>{for(const b of changes)branches[b.id]=b;};
test('delete and restore only the confirmed subtree; preserve previously deleted branches',()=>{
 const branches=fixture();assert.deepEqual(branchSubtree(branches,'a').map(b=>b.id),['a','b']);
 apply(branches,deletionChanges(branches,'a',['a','b'],new Set(),'batch'));
 assert.equal(branches.a.hidden,true);assert.equal(branches.b.hidden,true);assert.equal(branches.c.hidden,undefined);
 const restarted=JSON.parse(JSON.stringify(branches));
 apply(restarted,restorationChanges(restarted,'a','batch'));
 assert.equal(restarted.a.hidden,false);assert.equal(restarted.b.hidden,false);assert.equal(restarted.old.hidden,true);
});
test('reject roots, stale confirmation and active descendants without mutation',()=>{
 const branches=fixture(),before=JSON.stringify(branches);
 assert.throws(()=>deletionChanges(branches,'root',[],new Set(),'batch'),/不存在/);
 assert.throws(()=>deletionChanges(branches,'a',['a'],new Set(),'batch'),/结构已变化/);
 assert.throws(()=>deletionChanges(branches,'a',['a','b'],new Set(['b']),'batch'),/正在回答/);
 assert.equal(JSON.stringify(branches),before);
});
test('restoration cannot orphan a branch or reuse an expired delete receipt',()=>{
 const branches=fixture();apply(branches,deletionChanges(branches,'b',['b'],new Set(),'child'));
 apply(branches,deletionChanges(branches,'a',['a'],new Set(),'parent'));
 assert.throws(()=>restorationChanges(branches,'b','child'),/父分支/);
 apply(branches,restorationChanges(branches,'a','parent'));apply(branches,restorationChanges(branches,'b','child'));
 assert.throws(()=>restorationChanges(branches,'b','child'),/已变化/);
});

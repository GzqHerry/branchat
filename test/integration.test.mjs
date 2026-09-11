import {test} from 'node:test';
import assert from 'node:assert/strict';
const base=process.env.TREE_TEST_URL||'http://127.0.0.1:47831';
const root='01a07fa3-268a-7650-bbda-e531ac7f5a54';
test('real historical forks exclude later turns and keep separate continuation',async()=>{
 const response=await fetch(base+'/api/tree?id='+root);assert.equal(response.status,200);
 const data=await response.json();assert.ok(data.root.turns.length>=3);
 const a=data.branches.find(b=>b.name==='验证分支 A');const b=data.branches.find(b=>b.name==='验证分支 B');
 assert.ok(a&&b);assert.notEqual(a.id,b.id);
 assert.equal(a.thread.turns[0].id,data.root.turns[0].id);
 assert.equal(b.thread.turns.length,1);assert.ok(a.thread.turns.length>1);
 assert.equal(b.thread.turns.some(t=>t.id===a.thread.turns[1].id),false);
 assert.equal(data.root.turns.some(t=>t.id===a.thread.turns[1].id),false);
});
test('source thread rejects direct send',async()=>{
 const {token}=await fetch(base+'/api/session').then(r=>r.json());
 const response=await fetch(base+'/api/send',{method:'POST',headers:{'Content-Type':'application/json','X-Tree-Token':token},body:JSON.stringify({threadId:root,text:'test'})});
 assert.equal(response.status,400);assert.match((await response.json()).error,/只读/);
});
test('cross-origin and unauthenticated mutations are rejected',async()=>{
 assert.equal((await fetch(base+'/api/threads',{headers:{Origin:'https://example.com'}})).status,403);
 assert.equal((await fetch(base+'/api/fork',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
 assert.equal((await fetch(base+'/auth.json')).status,404);
});

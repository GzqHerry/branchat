import test from 'node:test';
import assert from 'node:assert/strict';
import {questionDeletionScope,validateDeletionPreview} from '../question-trash.mjs';
const thread={id:'root',turns:['A','B','C'].map(id=>({id,status:'completed'}))};
const branches={early:{id:'early',parentId:'root',pivotTurnId:'A'},affected:{id:'affected',parentId:'root',pivotTurnId:'B'},child:{id:'child',parentId:'affected',pivotTurnId:'X'},hidden:{id:'hidden',parentId:'root',pivotTurnId:'C',hidden:true}};
test('delete suffix and derived descendants, retaining earlier sibling paths',()=>{const scope=questionDeletionScope(thread,branches,'B');assert.deepEqual(scope.turns.map(t=>t.id),['B','C']);assert.deepEqual(scope.branchIds,['affected','child','hidden']);assert.equal(scope.index,1);});
test('reject changed scope and active descendants before mutation',()=>{const scope=questionDeletionScope(thread,branches,'B');const input={expectedTurnIds:['B','C'],expectedBranchIds:scope.branchIds};assert.doesNotThrow(()=>validateDeletionPreview(scope,input,new Set(),'root'));assert.throws(()=>validateDeletionPreview(scope,{...input,expectedTurnIds:['B']},new Set(),'root'),/变化/);assert.throws(()=>validateDeletionPreview(scope,input,new Set(['child']),'root'),/停止/);});
test('a later deletion does not absorb records already held by another question deletion',()=>{const scope=questionDeletionScope(thread,{...branches,archived:{id:'archived',parentId:'root',pivotTurnId:'B',cutDeletionId:'earlier-deletion'}},'B');assert.equal(scope.branchIds.includes('archived'),false);});

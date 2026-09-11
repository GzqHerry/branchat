import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nextBranchName} from '../branch-name.mjs';
test('numbering is local to the root conversation, including nested forks',()=>{
 const branches={a:{rootId:'other',name:'分支 1'},b:{rootId:'other',name:'分支 6'}};
 assert.equal(nextBranchName(branches,'new'),'分支 1');
 branches.c={rootId:'new',parentId:'nested',name:'分支 1'};
 assert.equal(nextBranchName(branches,'new'),'分支 2');
});
test('reserve deleted names for undo while ignoring legacy global-number gaps',()=>{
 const branches={a:{rootId:'root',name:'分支 5',hidden:true},b:{rootId:'root',name:'自定义名称'}};
 assert.equal(nextBranchName(branches,'root'),'分支 1');
 branches.c={rootId:'root',name:'分支 1',hidden:true};
 assert.equal(nextBranchName(branches,'root'),'分支 2');
});

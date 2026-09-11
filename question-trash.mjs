export function questionDeletionScope(thread, branches, turnId) {
  const index = thread.turns.findIndex(t => t.id === turnId);
  if (index < 0) throw new Error('该提问不存在，请刷新。');
  const turns = thread.turns.slice(index), removed = new Set(turns.map(t => t.id));
  const ids = new Set(Object.values(branches).filter(b => !b.cutDeletionId && b.parentId === thread.id && removed.has(b.pivotTurnId)).map(b => b.id));
  for (const parent of ids) for (const b of Object.values(branches)) if (!b.cutDeletionId && b.parentId === parent) ids.add(b.id);
  return {index, turns, branchIds: [...ids].sort()};
}
export function validateDeletionPreview(scope, input, activeIds, threadId) {
  if (JSON.stringify(scope.turns.map(t => t.id)) !== JSON.stringify(input.expectedTurnIds) || JSON.stringify(scope.branchIds) !== JSON.stringify([...(input.expectedBranchIds || [])].sort())) throw new Error('提问或分支结构已变化，请重新确认删除范围。');
  if (activeIds.has(threadId) || scope.turns.some(t => t.status === 'inProgress') || scope.branchIds.some(id => activeIds.has(id))) throw new Error('相关对话正在回答，请先停止后再删除。');
}

export function branchSubtree(branches, id) {
  if (!branches[id] || branches[id].hidden) throw new Error('分支不存在或已经删除。');
  const ids = new Set([id]);
  for (const parent of ids) for (const branch of Object.values(branches)) {
    if (!branch.hidden && branch.parentId === parent) ids.add(branch.id);
  }
  return [...ids].map(key => branches[key]);
}

export function deletionChanges(branches, id, expectedIds, activeIds, deletionId, now = Date.now()) {
  const targets = branchSubtree(branches, id);
  const expected = new Set(expectedIds || []);
  if (expected.size !== targets.length || targets.some(b => !expected.has(b.id))) throw new Error('分支结构已变化，请重新确认删除范围。');
  const running = targets.find(b => activeIds.has(b.id));
  if (running) throw new Error('“' + running.name + '”正在回答，请先停止后再删除。');
  return targets.map(b => ({...b, hidden: true, deletedAt: now, deletionId}));
}

export function restorationChanges(branches, id, deletionId) {
  const branch = branches[id];
  if (!branch?.hidden || !deletionId || branch.deletionId !== deletionId) throw new Error('该删除记录已变化或已经恢复。');
  const targets = Object.values(branches).filter(b => b.hidden && b.deletionId === deletionId);
  const ids = new Set(targets.map(b => b.id));
  if (targets.some(b => branches[b.parentId]?.hidden && !ids.has(b.parentId))) throw new Error('父分支已被删除，请先恢复父分支。');
  return targets.map(b => {const restored = {...b, hidden: false}; delete restored.deletedAt; delete restored.deletionId; return restored;});
}

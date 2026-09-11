import {randomUUID} from 'node:crypto';

export function question(turn) {
  return turn.items.filter(i => i.type === 'userMessage').flatMap(i => (i.content || []).filter(c => c.type === 'text').map(c => c.text)).join('\n').trim();
}
export function transcript(thread, end = thread.turns.length) {
  return thread.turns.slice(0, end).map(t => '## 你\n\n' + question(t) + '\n\n' + t.items.filter(i => i.type === 'agentMessage' && i.phase !== 'commentary').map(i => '## Codex\n\n' + i.text).join('\n\n')).join('\n\n---\n\n');
}
export function shortTitle(text) {
  const clean = text.includes('## My request:') ? text.split('## My request:').at(-1) : text;
  return clean.trim().replace(/\s+/g, ' ').slice(0, 28);
}
export function metadataPatch(previous, input) {
  const value = {...previous};
  for (const key of ['favorite', 'archived']) if (typeof input[key] === 'boolean') value[key] = input[key];
  if (typeof input.note === 'string') value.note = input.note.slice(0, 10000);
  for (const key of ['label', 'rootId', 'threadId', 'turnId']) if (typeof input[key] === 'string') value[key] = input[key].slice(0, 200);
  return value;
}
// Backups are portable conversation snapshots. Import uses new IDs so existing
// conversations and their live runtime state are never overwritten.
export function restoreSnapshot(backup, now = Date.now()) {
  if (backup?.format !== 'conversation-tree' || backup.version !== 1 || !Array.isArray(backup.roots) || !Array.isArray(backup.branches)) throw new Error('不是有效的提问树备份。');
  const all = [...backup.roots, ...backup.branches];
  if (!all.length || all.length > 2000) throw new Error('备份对话数量无效。');
  const ids = new Map();
  for (const r of all) {
    if (!r || typeof r.id !== 'string' || ids.has(r.id) || !r.thread || !Array.isArray(r.thread.turns)) throw new Error('备份节点无效或重复。');
    for (const turn of r.thread.turns) if (typeof turn.id !== 'string' || !Array.isArray(turn.items)) throw new Error('备份提问无效。');
    ids.set(r.id, randomUUID());
  }
  const rootIds = new Set(backup.roots.map(r => r.id)), records = new Map(all.map(r => [r.id, r]));
  for (const r of backup.branches) {
    if (!ids.has(r.parentId) || !rootIds.has(r.rootId) || !Number.isInteger(r.prefixCount) || r.prefixCount < 0 || r.prefixCount > r.thread.turns.length) throw new Error('备份分支关系无效。');
    const visited = new Set([r.id]); let p = r.parentId;
    while (!rootIds.has(p)) { if (visited.has(p) || !records.has(p)) throw new Error('备份存在循环关系。'); visited.add(p); p = records.get(p).parentId; }
    if (p !== r.rootId) throw new Error('备份分支根节点不一致。');
  }
  const imports = {}, conversations = {}, branches = {}, metadata = {}, deletionBatches = new Map();
  for (const r of all) {
    const id = ids.get(r.id);
    imports[id] = {...r.thread, id, turns: r.thread.turns.map(t => ({...t, status: t.status === 'inProgress' ? 'interrupted' : t.status, items: t.items.filter(i => i.type !== 'reasoning')}))};
    const record = {id, name: String(r.name || r.thread.name || '导入对话').slice(0, 80), imported: true, createdAt: now, updatedAt: now};
    if (rootIds.has(r.id)) conversations[id] = record;
    else {
      const batchKey = r.deletionId || r.id;
      if (!deletionBatches.has(batchKey)) deletionBatches.set(batchKey, randomUUID());
      branches[id] = {...record, rootId: ids.get(r.rootId), parentId: ids.get(r.parentId), pivotTurnId: r.pivotTurnId, prefixCount: r.prefixCount, hidden: !!r.hidden, ...(r.hidden ? {deletedAt: now, deletionId: deletionBatches.get(batchKey)} : {})};
    }
  }
  for (const [key, value] of Object.entries(backup.metadata || {})) {
    const [tid, ...suffix] = key.split(':');
    if (ids.has(tid)) metadata[ids.get(tid) + (suffix.length ? ':' + suffix.join(':') : '')] = metadataPatch({}, {...value, rootId: ids.get(value.rootId), threadId: ids.get(value.threadId)});
  }
  return {imports, conversations, branches, metadata, rootIds: [...rootIds].map(id => ids.get(id)), idMap: Object.fromEntries(ids)};
}

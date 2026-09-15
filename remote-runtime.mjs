import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {CodexRpc} from './rpc.mjs';
import {question} from './library.mjs';

const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
function transport(channel) {
  const child = new EventEmitter();child.stdin = channel;child.stdout = channel;child.stderr = channel.stderr;
  child.kill = () => {channel.end();channel.close();};
  channel.on('error', error => child.emit('error', error));channel.on('close', () => child.emit('exit'));
  return child;
}
export class RemoteRuntime {
  constructor(client, rpc, home, exec) {this.client = client;this.rpc = rpc;this.home = home;this.exec = exec;this.projectsRoot = home + '/CodexProjects';}
  resolveWorkspace = async (record, projectsRoot, inheritedCwd) => {
    for (const candidate of [record.workspaceCwd, record.execution?.cwd, inheritedCwd]) {
      if (typeof candidate !== 'string' || !path.posix.isAbsolute(candidate) || /[\r\n\0]/.test(candidate)) continue;
      const output = await this.exec(this.client, 'if [ -d ' + quote(candidate) + ' ]; then cd ' + quote(candidate) + ' && pwd -P; fi');
      if (output.trim().startsWith('/')) return output.trim();
    }
    if (!/^[\da-f-]{36}$/i.test(record.id)) throw new Error('无效的远程任务标识。');
    const cwd = projectsRoot + '/' + record.id;
    const output = await this.exec(this.client, 'mkdir -p ' + quote(cwd) + ' && cd ' + quote(cwd) + ' && pwd -P');
    if (!output.trim().startsWith('/')) throw new Error('未能创建远程任务目录。');return output.trim();
  };
  async list() {
    // Archived and active indexes are independent RPC streams. Fetch them in
    // parallel so a large archived history cannot block the visible list.
    const batches = await Promise.all([false,true].map(async archived => {
      const rows = []; let cursor;
      do {
        const page = await this.rpc.request('thread/list', {limit: 100,archived,sourceKinds: ['cli','vscode','appServer','exec','unknown'],...(cursor ? {cursor} : {})});
        rows.push(...page.data.map(t=>({...t,archived}))); cursor = page.nextCursor;
      } while (cursor);
      return rows;
    }));
    const threads = batches.flat();
    return threads.map(t => ({...t,name: t.name || t.preview || '对话',title: t.name || t.preview || '对话',updated_at: t.updatedAt || t.createdAt || 0,source: 'remote',archived: !!t.archived}));
  }
  async history(id) {
    const {thread} = await this.rpc.request('thread/read', {threadId: id,includeTurns: false});let cursor;const turns = [];
    try {do {const page = await this.rpc.request('thread/turns/list', {threadId: id,limit: 100,sortDirection: 'asc',itemsView: 'full',...(cursor ? {cursor} : {})});turns.push(...page.data);cursor = page.nextCursor;} while (cursor);}
    catch (error) {if (!/not supported|unknown method|method not found/i.test(error.message)) throw error;return (await this.rpc.request('thread/read',{threadId:id,includeTurns:true})).thread;}
    return {...thread,turns};
  }
  async source(action, value) {
    if (action === 'prepare' || action === 'import') return null;
    if (action === 'list') return this.list();
    if (action === 'snapshot' || action === 'search') {
      const histories = {}, results = [], needle = String(value || '').toLocaleLowerCase();
      for (const row of await this.list()) {
        const thread = await this.history(row.id);
        thread.turns = thread.turns.map(turn => ({...turn,items: turn.items.filter(i => i.type !== 'reasoning')}));histories[row.id] = thread;
        if (action === 'search') for (const turn of thread.turns) for (const item of turn.items) {
          if (!['userMessage','agentMessage'].includes(item.type) || item.phase === 'commentary') continue;
          const text = item.type === 'userMessage' ? question(turn) : item.text || '', pos = text.toLocaleLowerCase().indexOf(needle);
          if (pos >= 0) results.push({threadId: row.id,turnId: turn.id,itemId: item.id,role: item.type === 'userMessage' ? '你' : 'Codex',snippet: text.slice(Math.max(0,pos-65),pos+180)});
        }
      }
      return action === 'snapshot' ? histories : results;
    }
    throw new Error('不支持的远程历史操作。');
  }
}
export async function connectRemoteRuntime(client, base, exec, report) {
  report('SSH 已连接，正在查找远程 Codex');
  const output = await exec(client, 'bash -lc ' + quote(await readFile(path.join(base,'remote-codex.sh'),'utf8')));
  const home = output.split('\n').find(x => x.startsWith('TREE_HOME='))?.slice(10).trim();
  const codex = output.split('\n').find(x => x.startsWith('TREE_CODEX='))?.slice(11).trim();
  if (!home?.startsWith('/') || !codex?.startsWith('/') || /[\r\n\0]/.test(home+codex)) throw new Error('没有识别到有效的远程 Codex 路径。');
  report('正在通过 SSH 启动 Codex');
  const channel = await new Promise((resolve,reject) => client.exec('bash -lc ' + quote('exec ' + quote(codex) + ' app-server --stdio -c features.request_permissions_tool=true'), (error,stream) => error ? reject(error) : resolve(stream)));
  const rpc = new CodexRpc(null,null,transport(channel));
  try {await rpc.initialize();return new RemoteRuntime(client,rpc,home,exec);} catch (error) {rpc.close();throw error;}
}

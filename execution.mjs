import path from 'node:path';
import {realpath, stat, mkdir} from 'node:fs/promises';

export async function resolveWorkspace(record, projectsRoot, inheritedCwd) {
  // Existing user-selected locations and source-task locations remain useful,
  // but nobody has to choose a folder to start working.
  for (const candidate of [record.workspaceCwd, record.execution?.cwd, inheritedCwd]) {
    if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) continue;
    try {const cwd = await realpath(candidate); if ((await stat(cwd)).isDirectory()) return cwd;} catch (e) {if (!['ENOENT', 'ENOTDIR'].includes(e.code)) throw e;}
  }
  if (!/^[\da-f-]{36}$/i.test(record.id)) throw new Error('无效的任务标识。');
  const cwd = path.join(projectsRoot, record.id);
  await mkdir(cwd, {recursive: true}); return realpath(cwd);
}
export function threadExecution(cwd) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) throw new Error('任务运行位置不可用。');
  return {cwd, runtimeWorkspaceRoots: [cwd], sandbox: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'user'};
}
export function turnExecution(cwd) {
  // Activate tools inherited from older chat-only threads once. Do not reset
  // sandbox settings between turns: the runtime owns session-scoped grants.
  return {environments: [{environmentId: 'local', cwd}]};
}

export function approvalChoices(method, params) {
  if (method === 'item/tool/requestUserInput') return [];
  if (method === 'item/permissions/requestApproval') return [
    {id: 'decline', label: '拒绝', decision: 'decline'},
    {id: 'accept', label: '允许本轮', decision: 'accept', scope: 'turn'},
    {id: 'session', label: '本次会话允许', decision: 'accept', scope: 'session'},
    {id: 'full-session', label: '允许完全访问', decision: 'accept', scope: 'session', fullAccess: true},
  ];
  const decisions = params.availableDecisions ?? ['accept', 'acceptForSession', 'decline', 'cancel'];
  const labels = {accept: '允许一次', acceptForSession: '本次会话允许', decline: '拒绝', cancel: '取消本次操作'};
  const choices = decisions.flatMap((decision, index) => {
    if (typeof decision === 'string' && labels[decision]) return [{id: decision, label: labels[decision], decision}];
    if (decision?.acceptWithExecpolicyAmendment) return [{id: 'rule-' + index, label: '允许并记住命令规则', detail: JSON.stringify(decision.acceptWithExecpolicyAmendment.execpolicy_amendment), decision}];
    if (decision?.applyNetworkPolicyAmendment) return [{id: 'rule-' + index, label: '应用网络访问规则', detail: JSON.stringify(decision.applyNetworkPolicyAmendment.network_policy_amendment), decision}];
    return [];
  });
  // The remote app-server may omit acceptForSession from availableDecisions
  // while still accepting it. Keep a visible full-access action for every
  // command/file approval so the web client does not silently fall back to
  // one-off approval.
  if (!choices.some(c => c.id === 'full-access')) {
    const at = Math.max(0, choices.findIndex(c => c.id === 'acceptForSession'));
    choices.splice(at, 0, {id: 'full-access', label: '允许完全访问', decision: 'acceptForSession', scope: 'session', fullAccess: true});
  }
  return choices;
}

const supported = new Set(['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval', 'item/tool/requestUserInput']);
export class InteractionBridge {
  constructor(rpc, resolveThread, broadcast) {this.rpc = rpc; this.resolveThread = resolveThread; this.broadcast = broadcast; this.pending = new Map();}
  receive(msg) {
    if (msg.method === 'currentTime/read') {this.rpc.send({id: msg.id, result: {currentTimeAt: Math.floor(Date.now()/1000)}}); return;}
    const threadId = this.resolveThread(msg.params?.threadId);
    if (!supported.has(msg.method) || !threadId) {
      this.rpc.send({id: msg.id, error: {code: -32601, message: '网页暂不支持此交互，请使用可用的本机命令或文件工具。'}}); return;
    }
    const request = {id: JSON.stringify(msg.id), method: msg.method, params: {...msg.params, threadId}, choices: approvalChoices(msg.method, msg.params), createdAt: Date.now()};
    this.pending.set(request.id, {request, rpcId: msg.id}); this.broadcast('tree/interaction', {request});
  }
  list() {return [...this.pending.values()].map(x => x.request);}
  resolve(key) {if (this.pending.delete(key)) this.broadcast('tree/interactionResolved', {id: key});}
  clear(threadId, turnId) {
    for (const [id, {request}] of this.pending) if ((!threadId || request.params.threadId === threadId) && (!turnId || request.params.turnId === turnId)) this.resolve(id);
  }
  answer(input) {
    const entry = this.pending.get(input.id);
    if (!entry) throw new Error('此请求已经处理或失效，请刷新状态。');
    const {request, rpcId} = entry;
    let result;
    if (request.method === 'item/tool/requestUserInput') {
      const answers = {};
      for (const q of request.params.questions) {
        const value = input.answers?.[q.id];
        if (typeof value !== 'string' || !value.trim() || value.length > 10000) throw new Error('请回答每一个问题。');
        if (q.options?.length && !q.isOther && !q.options.some(o => o.label === value)) throw new Error('请选择提供的选项。');
        answers[q.id] = {answers: [value]};
      }
      result = {answers};
    } else {
      const selector = input.choiceId ?? input.decision;
      const choice = request.choices.find(c => c.id === selector) ||
        (selector && typeof selector === 'object' ? request.choices.find(c => JSON.stringify(c.decision) === JSON.stringify(selector)) : null);
      if (!choice) throw new Error('请选择此请求提供的授权选项。');
      if (request.method === 'item/permissions/requestApproval') {
        const permissions = {};
        if (choice.decision === 'accept') {
          if (choice.fullAccess) {
            // Null read/write scopes are the protocol's unrestricted filesystem
            // form; keep network enabled for a true session-wide grant.
            permissions.fileSystem = {read: null, write: null};
            permissions.network = {enabled: true};
          } else {
            for (const [key, value] of Object.entries(request.params.permissions || {})) if (value != null) permissions[key] = value;
          }
        }
        result = {permissions, scope: choice.scope || 'turn'};
      } else {
        result = {decision: choice.decision};
      }
    }
    this.rpc.send({id: rpcId, result}); this.resolve(input.id); return {answered: true};
  }
}

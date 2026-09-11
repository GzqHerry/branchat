import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {EventEmitter} from 'node:events';

export class CodexRpc extends EventEmitter {
  constructor(executable, home, transport) {
    super(); this.seq = 0; this.pending = new Map(); this.dead = false;
    this.child = transport || spawn(executable, ['app-server', '--stdio'], {
      windowsHide: true, env: {...process.env, CODEX_HOME: home}, stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stderr.on('data', () => {});
    this.child.on('error', e => this.fail(e));
    this.child.on('exit', () => this.fail(new Error('Codex 服务已断开，请重新连接。')));
    createInterface({input: this.child.stdout}).on('line', line => {
      let msg; try { msg = JSON.parse(line); } catch { return; }
      if (msg.id !== undefined && !msg.method) {
        const request = this.pending.get(msg.id);
        if (!request) return;
        clearTimeout(request.timer); this.pending.delete(msg.id);
        msg.error ? request.reject(new Error(msg.error.message)) : request.resolve(msg.result);
      } else if (msg.method && msg.id !== undefined) {
        if (this.listenerCount('request')) this.emit('request', msg);
        else this.send({id: msg.id, error: {code: -32601, message: '没有可用的交互处理器。'}});
      } else this.emit('notification', msg);
    });
  }
  send(message) { if (!this.dead) this.child.stdin.write(JSON.stringify(message) + '\n'); }
  request(method, params = {}, timeout = 60000) {
    if (this.dead) return Promise.reject(new Error('Codex 服务已断开。'));
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(method + ' 请求超时，请刷新检查状态。')); }, timeout);
      this.pending.set(id, {resolve, reject, timer}); this.send({id, method, params});
    });
  }
  async initialize() {
    const info = await this.request('initialize', {clientInfo: {name: 'conversation_tree', title: 'Conversation Tree', version: '1.0.0'}, capabilities: {experimentalApi: true}});
    this.send({method: 'initialized', params: {}}); return info;
  }
  fail(error) {
    if (this.dead) return;
    this.dead = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear(); this.emit('disconnected', error.message);
  }
  close() { this.child.kill(); }
}

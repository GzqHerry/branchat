import {connectRemoteRuntime} from './remote-runtime.mjs';
import ssh2 from 'ssh2';
const {Client} = ssh2;
import {readFile, writeFile, rename} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import path from 'node:path';
import http from 'node:http';

export const shellQuote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
export const fingerprint = key => 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
export function profileInput(input) {
  const host = String(input.host || '').trim(), username = String(input.username || '').trim(), port = Number(input.port || 22);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.:-]{0,252}$/.test(host)) throw new Error('请填写主机 IP 或域名，不包含 ssh、用户名或网址前缀。');
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,63}$/.test(username)) throw new Error('请填写有效的 SSH 用户名。');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SSH 端口必须为 1–65535。');
  const keyFile = String(input.keyFile || '').trim();
  if (keyFile && (!path.isAbsolute(keyFile) || keyFile.includes('\0'))) throw new Error('私钥文件需要填写本机绝对路径。');
  return {name: String(input.name || host).trim().slice(0, 80), host, username, port, keyFile};
}
function sshError(error) {
  const text = error.message || String(error);
  if (/authentication|auth methods/i.test(text)) return 'SSH 认证失败，请检查用户名、密码、私钥或本机 SSH Agent。';
  if (/timed out|timeout/i.test(text)) return 'SSH 连接超时，请检查主机是否在线，以及本机是否连接了对应局域网或 VPN。';
  return 'SSH 连接失败：' + text;
}
export async function openSSH(profile, secrets = {}, trustedFingerprint, onFingerprint = () => {}) {
  const client = new Client(); let observed;
  const config = {host: profile.host, port: profile.port, username: profile.username, readyTimeout: 15000,
    keepaliveInterval: 10000, keepaliveCountMax: 3,
    hostVerifier: key => {observed = fingerprint(key); onFingerprint(observed); return observed === trustedFingerprint;}};
  if (secrets.password) config.password = secrets.password;
  else if (profile.keyFile) {config.privateKey = await readFile(profile.keyFile); if (secrets.passphrase) config.passphrase = secrets.passphrase;}
  else config.agent = process.env.SSH_AUTH_SOCK || (process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : undefined);
  client.on('error', () => {});
  try {
    await new Promise((resolve, reject) => {
      const closed = () => reject(new Error('服务器在 SSH 登录完成前关闭了连接。'));
      client.once('close', closed); client.once('error', reject);
      client.once('ready', () => {client.removeListener('close', closed); client.removeListener('error', reject); resolve();});
      client.connect(config);
    });
    return client;
  } catch (error) {
    client.destroy();
    if (observed && observed !== trustedFingerprint) {
      const failure = new Error(trustedFingerprint ? '远程主机指纹发生变化，请核实后再连接。' : '首次连接，请核实并确认远程主机指纹。');
      failure.hostKey = {fingerprint: observed, previous: trustedFingerprint || null}; throw failure;
    }
    throw new Error(sshError(error));
  } finally {delete config.password; delete config.passphrase; delete config.privateKey;}
}
export function sshExec(client, command, timeout = 20000) {
  return new Promise((resolve, reject) => {
    let stream, output = '', errors = '', done = false;
    const finish = (error, value) => {if (done) return; done = true; clearTimeout(timer); error ? reject(error) : resolve(value);};
    const timer = setTimeout(() => {stream?.close(); finish(new Error('远程环境检查超时。'));}, timeout);
    client.exec(command, (error, channel) => {
      if (error) return finish(error); stream = channel;
      const collect = (chunk, stderr) => {if (output.length + errors.length > 256 * 1024) {stream.close(); return finish(new Error('远程输出过大。'));} if (stderr) errors += chunk; else output += chunk;};
      stream.on('data', chunk => collect(chunk, false)); stream.stderr.on('data', chunk => collect(chunk, true));
      stream.on('error', finish); stream.on('close', code => finish(code ? new Error((errors || output || '远程命令失败').slice(-3000)) : null, output));
    });
  });
}
function localRequest(port, requestPath, options) {
  return new Promise((resolve,reject) => {
    const req = http.request({host: '127.0.0.1',port,path: requestPath,method: options.method,headers: options.headers},response => {clearTimeout(timer);resolve({req,response});});
    const timer = setTimeout(() => req.destroy(new Error('远程 Codex 请求超时。')),120000);
    req.on('error',error=>{clearTimeout(timer);reject(error);});options.input.pipe(req);
  });
}

export class SshConnections {
  constructor(data, base, {connectRuntime = connectRemoteRuntime} = {}) {this.data = data;this.file = path.join(data, 'ssh-connections.json'); this.base = base; this.connectRuntime = connectRuntime; this.profiles = []; this.live = new Map(); this.jobs = new Map(); this.saving = Promise.resolve();}
  async init() {try {this.profiles = JSON.parse(await readFile(this.file, 'utf8'));} catch (e) {if (e.code !== 'ENOENT') throw e;} return this;}
  async save() {const text = JSON.stringify(this.profiles, null, 2); this.saving = this.saving.catch(() => {}).then(async () => {await writeFile(this.file + '.tmp', text, {mode: 0o600}); await rename(this.file + '.tmp', this.file);}); await this.saving;}
  list() {return this.profiles.map(profile => ({...profile, connected: !!this.live.get(profile.id), ...(this.jobs.get(profile.id) || {})}));}
  async add(input) {const profile = {...profileInput(input), id: randomUUID()};if (this.profiles.some(p => p.host === profile.host && p.username === profile.username && p.port === profile.port)) throw new Error('此 SSH 主机已保存，请使用已有条目连接。');this.profiles.push(profile); await this.save(); return profile;}
  async remove(id) {if (this.jobs.get(id)?.connecting) throw new Error('连接正在进行，请先取消。');this.disconnect(id);this.profiles = this.profiles.filter(p => p.id !== id);await this.save();}
  connect(id, secrets = {}) {
    const profile = this.profiles.find(p => p.id === id); if (!profile) throw new Error('SSH 主机不存在。');
    if (this.jobs.get(id)?.connecting || this.live.has(id)) return;
    const job = {connecting: true, stage: '正在建立 SSH 连接'};this.jobs.set(id, job);
    const report = stage => {job.stage = stage;};
    // The HTTP request returns immediately; progress has a bounded lifetime.
    const run = async () => {
      let client, runtime, backend;
      const timer = setTimeout(() => {job.cancelled = true; client?.destroy();}, 90000);
      try {
        client = await openSSH(profile, secrets, secrets.trustedFingerprint || profile.fingerprint);
        job.client = client;
        if (job.cancelled) throw new Error('连接已取消。');
        profile.fingerprint = secrets.trustedFingerprint || profile.fingerprint;
        await this.save();
        runtime = await this.connectRuntime(client,this.base,sshExec,report);
        const {createBackend} = await import('./server.mjs');
        const isolatedUser = String(profile.username).replace(/[^a-zA-Z0-9_.-]/g, '_');
        backend = await createBackend({remoteRuntime: runtime,dataDirectory: path.join(this.data,'ssh-hosts',isolatedUser),listenPort: 0,writeState: false,enableSSH: false,
          // A browser can disappear without calling an explicit disconnect. Keep a
          // short grace period for EventSource reconnects, then tear down the SSH
          // runtime so its app-server cannot retain an active writer indefinitely.
          onClientsEmpty: () => {
            const current = this.live.get(id);
            if (current?.client !== client || current.emptyTimer) return;
            current.emptyTimer = setTimeout(() => {
              if (this.live.get(id)?.client !== client) return;
              this.disconnect(id);
            }, 30000);
            current.emptyTimer.unref?.();
          },
          onClientConnected: () => {
            const current = this.live.get(id);
            if (current?.emptyTimer) { clearTimeout(current.emptyTimer); delete current.emptyTimer; }
          }});
        if (job.cancelled) throw new Error('连接已取消。');
        if (runtime.rpc.dead) throw new Error('远程 Codex 在启动期间断开，请检查远程 Codex 是否能正常运行。');
        this.live.set(id, {client,backend,runtime,port: backend.port}); job.stage = '远程 Codex 已连接';
        runtime.rpc.once('disconnected', () => client.destroy());
        client.once('close', () => {if (this.live.get(id)?.client === client) {this.live.delete(id);backend.close();job.stage = 'SSH 已断开';}});
      } catch (error) {backend?.close();runtime?.rpc.close();client?.destroy();job.error = job.cancelled ? '连接已取消或超时。' : error.message;if (error.hostKey) job.hostKey = error.hostKey;job.stage = '连接未完成';}
      finally {clearTimeout(timer);delete job.client;delete job.cancelled;job.connecting = false;secrets.password = '';secrets.passphrase = '';}
    };
    run();
  }
  disconnect(id) {const job = this.jobs.get(id);if (job?.connecting) {job.cancelled = true;job.client?.destroy();}const live = this.live.get(id);this.live.delete(id);if(live?.emptyTimer)clearTimeout(live.emptyTimer);live?.backend.close();live?.runtime?.rpc?.close();live?.client.end();if (job && !job.connecting) job.stage = 'SSH 已断开';}
  status() {return this.list().map(({client, cancelled, ...profile}) => profile);}
  async proxy(id, req, res, route) {
    const live = this.live.get(id);if (!live) {res.writeHead(503, {'Content-Type': 'application/json'});res.end(JSON.stringify({error: 'SSH 尚未连接，请点击顶部连接入口重新连接。'}));return;}
    const pathname = new URL(route, 'http://127.0.0.1').pathname;
    if (!pathname.startsWith('/api/') || pathname.startsWith('/api/ssh') || pathname === '/api/shutdown') throw new Error('不允许的远程接口。');
    const headers = {'Host': '127.0.0.1:' + live.port, 'Origin': 'http://127.0.0.1:' + live.port};
    for (const key of ['content-type', 'content-length', 'x-tree-token', 'last-event-id']) if (req.headers[key]) headers[key] = req.headers[key];
    const {req: outgoing, response} = await localRequest(live.port, route, {method: req.method, headers, input: req, timeout: 120000});
    res.writeHead(response.statusCode, {'Content-Type': response.headers['content-type'] || 'application/json', 'Cache-Control': 'no-store'});
    response.on('error', () => res.destroy());response.pipe(res);res.on('close', () => {response.destroy();outgoing.destroy();});
  }
  close() {for (const id of new Set([...this.live.keys(), ...this.jobs.keys()])) this.disconnect(id);}
}

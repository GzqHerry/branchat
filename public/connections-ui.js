const selectedHost = new URL(location.href).searchParams.get('host');
export const remoteId = /^[\da-f-]{36}$/i.test(selectedHost || '') ? selectedHost : '';
export const apiBase = remoteId ? '/remote/' + remoteId + '/api/' : '/api/';
export const storagePrefix = remoteId ? 'ssh:' + remoteId + ':' : '';
export const scopedStorage = storage => ({getItem: key => storage.getItem(storagePrefix + key),setItem: (key, value) => storage.setItem(storagePrefix + key, value),removeItem: key => storage.removeItem(storagePrefix + key)});
let gatewayToken = '', activeName = '远程主机';
export const connectionLabel = () => remoteId ? 'SSH · ' + activeName : '本地连接';
export const gatewayHeaders = () => remoteId ? {'X-Tree-Gateway': gatewayToken} : {};
const el = (tag, text, className) => {const node = document.createElement(tag);if (text) node.textContent = text;if (className) node.className = className;return node;};
async function localApi(route, input) {
  if (!gatewayToken) {const response = await fetch('/api/session', {signal: AbortSignal.timeout(8000)});const session = await response.json();if (!session.features?.includes('ssh-connections')) throw new Error('SSH 功能需要新版后端。请双击 Restart.cmd 重启一次服务。');gatewayToken = session.token;}
  const response = await fetch('/api/' + route, {method: input ? 'POST' : 'GET',headers: {'Content-Type': 'application/json','X-Tree-Token': gatewayToken},...(input ? {body: JSON.stringify(input)} : {}),signal: AbortSignal.timeout(12000)});
  const data = await response.json();if (!response.ok) {if (response.status === 403) gatewayToken = '';throw new Error(data.error || '连接操作失败。');}return data;
}
export async function prepareConnection() {
  if (!remoteId) return;
  const {profiles} = await localApi('ssh');activeName = profiles.find(p => p.id === remoteId)?.name || '远程主机';
}
export function initConnections(beforeSwitch = () => {}) {
  const trigger = document.getElementById('connection-open');if (!trigger) return;
  const dialog = el('dialog', null, 'ssh-dialog');dialog.id = 'ssh-dialog';dialog.setAttribute('aria-labelledby', 'ssh-title');
  const head = el('div', null, 'dialog-head'), title = el('h2', '连接');title.id = 'ssh-title';
  const close = el('button', '×', 'icon');close.type = 'button';close.setAttribute('aria-label', '关闭连接设置');close.onclick = () => dialog.close();head.append(title, close);
  const description = el('p', '通过 SSH 使用远程电脑的 Codex。对话、代码和访问审批在所选电脑上处理。', 'muted');
  const local = el('button', remoteId ? '切回本机' : '本机 · 当前连接', 'ssh-local');local.type = 'button';
  const switchTo = id => {beforeSwitch();const url = new URL(location.href);id ? url.searchParams.set('host', id) : url.searchParams.delete('host');location.assign(url.href);};
  local.onclick = () => {if (remoteId) switchTo('');else dialog.close();};
  const list = el('div', null, 'ssh-hosts');list.setAttribute('aria-label', '已保存的 SSH 主机');
  const addHost = el('details', null, 'ssh-add');addHost.append(el('summary', '添加 SSH 主机'));
  const form = el('form', null, 'ssh-form');addHost.append(form);
  const fields = {};
  const field = (key, name, placeholder, type = 'text', required = false) => {const label = el('label', name);const input = el('input');input.name = key;input.type = type;input.placeholder = placeholder;input.required = required;input.autocomplete = 'off';input.setAttribute('aria-label', name);label.append(input);fields[key] = input;return label;};
  form.append(field('name', '名称', '例如：机器人开发机'),field('host', '主机', 'IP 或域名', 'text', true));
  const pair = el('div', null, 'ssh-pair');pair.append(field('username', '用户名', 'SSH 用户名', 'text', true),field('port', '端口', '22', 'number'));fields.port.value = '22';fields.port.min = '1';fields.port.max = '65535';form.append(pair);
  const advanced = el('details');advanced.append(el('summary', '密钥文件（可选）'),field('keyFile', '本机私钥路径', '留空使用密码或 SSH Agent'));form.append(advanced);
  const save = el('button', '保存主机', 'primary');save.type = 'submit';form.append(save);
  const auth = el('form', null, 'ssh-auth');auth.hidden = true;
  const authTitle = el('h3'), authHint = el('p', '密码仅用于本次连接，不保存。留空使用已配置的密钥或 SSH Agent。', 'muted');
  const passwordLabel = el('label', 'SSH 密码'), password = el('input');password.type = 'password';password.autocomplete = 'off';password.setAttribute('aria-label', 'SSH 密码');passwordLabel.append(password);
  const passLabel = el('label', '私钥口令（仅加密私钥需要）'), passphrase = el('input');passphrase.type = 'password';passphrase.autocomplete = 'off';passphrase.setAttribute('aria-label', '私钥口令');passLabel.append(passphrase);
  const connect = el('button', '连接', 'primary');connect.type = 'submit';auth.append(authTitle,authHint,passwordLabel,passLabel,connect);
  const status = el('p', '', 'ssh-status');status.setAttribute('role', 'status');status.setAttribute('aria-live', 'polite');
  const trust = el('div', null, 'ssh-trust');trust.hidden = true;const trustTitle = el('strong', '确认远程主机身份'), fingerprint = el('code'), trustDescription = el('p', '', 'muted'), approve = el('button', '信任此指纹并连接');approve.type = 'button';trust.append(trustTitle,fingerprint,trustDescription,approve);
  const requirements = el('p', '多个窗口可同时使用同一 SSH 主机，关闭页面不会断开其他窗口。网页后端运行在本机，通过 SSH 直接使用远程 Codex。远程只需可运行且已登录的 Codex；会自动查找 VS Code 远程扩展附带的可执行文件。无需为网页安装远程 Node.js、Python 或网页服务。', 'muted ssh-requirements');
  dialog.append(head,description,local,list,auth,status,trust,addHost,requirements);document.body.append(dialog);
  let profiles = [], currentId = '', polling = false, operation = false, pendingFingerprint = '', listSignature = '', loaded = false;
  const showError = error => {status.textContent = error.message;status.classList.add('error');};
  const run = async fn => {try {status.classList.remove('error');await fn();} catch (error) {showError(error);}};
  const button = (text, fn) => {const b = el('button', text);b.type = 'button';b.onclick = () => run(fn);return b;};
  const render = () => {
    const signature = JSON.stringify(profiles);if (signature === listSignature) return;listSignature = signature;
    list.replaceChildren();
    for (const p of profiles) {
      const row = el('section', null, 'ssh-host');if (p.id === remoteId) row.classList.add('selected');
      row.append(el('strong', p.name),el('span', p.username + '@' + p.host + ':' + p.port, 'muted'),el('span', p.connected ? '远程 Codex 已连接' : p.stage || '未连接', 'ssh-host-state'));
      if (p.error && !p.hostKey) row.append(el('p', p.error, 'ssh-host-error'));
      const actions = el('div', null, 'ssh-actions');
      if (p.connected) actions.append(button(p.id === remoteId ? '返回对话' : '进入', () => switchTo(p.id)),button('断开此主机', async () => {if (!confirm('同一主机的所有网页窗口共用此 SSH 连接。确认断开所有窗口与此主机的连接？正在执行的任务可能中断。仅关闭页面或切回本机不会断开其他窗口。')) return;await localApi('ssh/disconnect', {id: p.id});await refresh();}));
      else if (p.connecting) actions.append(button('取消连接', async () => {await localApi('ssh/disconnect', {id: p.id});await refresh();}));
      else actions.append(button('连接', () => {currentId = p.id;password.value = '';passphrase.value = '';authTitle.textContent = '连接到 ' + p.name;auth.hidden = false;passLabel.hidden = !p.keyFile;trust.hidden = true;status.textContent = '';auth.scrollIntoView({block: 'nearest'});password.focus();}),button('移除', async () => {if (!confirm('移除保存的 SSH 主机？远程对话和文件不会删除。')) return;await localApi('ssh/remove', {id: p.id});await refresh();}));
      row.append(actions);list.append(row);
    }
  };
  const refresh = async () => {
    const data = await localApi('ssh');profiles = data.profiles;if (!loaded) {addHost.open = !profiles.length;loaded = true;}render();
    const current = profiles.find(p => p.id === currentId);
    if (current && operation) {
      status.textContent = current.error || current.stage || '';connect.disabled = !!current.connecting;
      if (current.hostKey) {pendingFingerprint = current.hostKey.fingerprint;fingerprint.textContent = pendingFingerprint;trustDescription.textContent = current.hostKey.previous ? '与之前记录不同：' + current.hostKey.previous + '。请向主机管理员核实变更后再信任。' : '请与远程主机管理员提供的 SHA256 指纹核对。确认后会保存此指纹。';trust.hidden = false;trust.scrollIntoView({block: 'nearest'});}
      if (!current.connecting) {operation = false;if (current.connected) {password.value = '';passphrase.value = '';switchTo(current.id);} else if (!current.hostKey) {password.value = '';passphrase.value = '';}}
    }
  };
  const start = async trustedFingerprint => {
    trust.hidden = true;status.textContent = '正在连接…';connect.disabled = true;operation = true;
    try {await localApi('ssh/connect', {id: currentId,password: password.value,passphrase: passphrase.value,...(trustedFingerprint ? {trustedFingerprint} : {})});await refresh();}
    catch (error) {operation = false;connect.disabled = false;password.value = '';passphrase.value = '';throw error;}
  };
  auth.onsubmit = e => {e.preventDefault();run(() => start());};approve.onclick = () => run(() => start(pendingFingerprint));
  form.onsubmit = e => {e.preventDefault();run(async () => {save.disabled = true;try {const p = await localApi('ssh/save', Object.fromEntries(Object.entries(fields).map(([k,v]) => [k,v.value])));await refresh();addHost.open = false;form.reset();currentId = p.id;authTitle.textContent = '连接到 ' + p.name;auth.hidden = false;passLabel.hidden = !p.keyFile;password.focus();} finally {save.disabled = false;}});};
  trigger.onclick = () => {dialog.showModal();run(refresh);};
  dialog.addEventListener('close', () => {password.value = '';passphrase.value = '';trust.hidden = true;});
  setInterval(async () => {if (!dialog.open || polling) return;polling = true;try {await refresh();} catch (error) {showError(error);} finally {polling = false;}}, 1200);
}

import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require = createRequire(import.meta.url), {chromium} = require(process.env.TREE_PLAYWRIGHT || 'playwright');
const id = '30000000-0000-0000-0000-000000000001', root = '30000000-0000-0000-0000-000000000002';
let profile, connectionAttempts = 0, lastRequest;const streams = new Set();
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');const json = data => {res.writeHead(200, {'Content-Type': 'application/json'});res.end(JSON.stringify(data));};
  let text = '';if (req.method === 'POST') for await (const chunk of req) text += chunk;
  const body = text ? JSON.parse(text) : {};
  if (url.pathname === '/api/ssh') return json({profiles: profile ? [profile] : []});
  if (url.pathname === '/api/ssh/save') {profile = {...body,id,connected: false};return json(profile);}
  if (url.pathname === '/api/ssh/connect') {
    connectionAttempts++;lastRequest = body;
    if (!body.trustedFingerprint && !profile.fingerprint) Object.assign(profile, {connecting: false,hostKey: {fingerprint: 'SHA256:TEST_FINGERPRINT'},stage: '等待确认'});
    else {delete profile.hostKey;delete profile.setup;delete profile.error;profile.connected = true;profile.stage = '已连接';}
    return json({connecting: true});
  }
  if (url.pathname === '/api/ssh/disconnect') {profile.connected = false;return json({});}
  const remote = url.pathname.startsWith('/remote/');const route = remote ? url.pathname.slice(('/remote/' + id).length) : url.pathname;
  if (route === '/api/session') return json({app: 'conversation-tree',token: remote ? 'remote-token' : 'gateway-token',features: ['ssh-connections','new-conversation','utf8-body','automatic-edit'],active: {}});
  if (route === '/api/threads') return json({threads: [{id: root,title: remote ? '远程对话' : '本机对话'}],branches: []});
  if (route === '/api/tree') return json({root: {id: root,turns: []},rootRecord: {id: root,name: remote ? '远程对话' : '本机对话'},branches: [],active: {}});
  if (route === '/api/events') {res.writeHead(200, {'Content-Type': 'text/event-stream'});res.write(': connected\n\n');streams.add(res);res.on('close', () => streams.delete(res));return;}
  if (route.startsWith('/api/')) return json({});
  const file = route === '/' ? 'index.html' : route.slice(1);
  if (!/^[\w.-]+$/.test(file)) {res.writeHead(404);res.end();return;}
  try {const bytes = await readFile(new URL('../public/' + file, import.meta.url));res.writeHead(200, {'Content-Type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'});res.end(bytes);} catch {res.writeHead(404);res.end();}
});
server.listen(0, '127.0.0.1');await once(server, 'listening');let browser;
try {
  browser = await chromium.launch({headless: true,...(process.env.TREE_BROWSER_EXE ? {executablePath: process.env.TREE_BROWSER_EXE} : {})});
  const page = await browser.newPage({viewport: {width: 1200,height: 900}}), errors = [];
  page.on('pageerror', e => errors.push(e.message));await page.goto('http://127.0.0.1:' + server.address().port);
  await page.getByRole('button', {name: '管理本机与 SSH 连接'}).click();
  await page.getByLabel('名称', {exact: true}).fill('Cobot Magic 2.0');await page.getByLabel('主机', {exact: true}).fill('172.30.1.34');await page.getByLabel('用户名', {exact: true}).fill('agilex');
  await page.getByRole('button', {name: '保存主机',exact: true}).click();await page.getByLabel('SSH 密码', {exact: true}).fill('TEST_PASSWORD_ONLY');
  await page.locator('.ssh-auth').getByRole('button', {name: '连接',exact: true}).click();await page.locator('.ssh-trust').first().waitFor({state: 'visible'});
  assert.equal(connectionAttempts, 1);assert.equal(profile.password, undefined);
  await page.screenshot({path: fileURLToPath(new URL('../../../work/ssh-connect-desktop.png', import.meta.url))});
  await page.evaluate(() => {const prompt = document.getElementById('prompt');prompt.value = '本机草稿';prompt.dispatchEvent(new Event('input', {bubbles: true}));localStorage.setItem('tree-question-queues', JSON.stringify({local: {items: []}}));});
  await page.getByRole('button', {name: '信任此指纹并连接'}).click();
  await page.waitForURL('**/?host=' + id);
  await page.waitForFunction(() => document.getElementById('connection').textContent === 'SSH · Cobot Magic 2.0');
  assert.equal(lastRequest.trustedFingerprint, 'SHA256:TEST_FINGERPRINT');assert.equal(lastRequest.prepareNode, undefined);
  const storage = await page.evaluate(async () => {const m = await import('/connections-ui.js');const s = m.scopedStorage(localStorage);const before = s.getItem('tree-drafts');s.setItem('tree-drafts', 'remote-draft');return {before,local: localStorage.getItem('tree-drafts'),remote: s.getItem('tree-drafts'),headers: m.gatewayHeaders(),prefix: m.storagePrefix};});
  assert.equal(storage.before, null);assert.equal(storage.remote, 'remote-draft');assert.match(storage.local, /本机草稿/);assert.equal(storage.headers['X-Tree-Gateway'], 'gateway-token');assert.equal(storage.prefix, 'ssh:' + id + ':');
  await page.getByRole('button', {name: '管理本机与 SSH 连接'}).click();assert.equal(await page.getByRole('button',{name:'准备 Node.js 并重试'}).count(),0);await page.setViewportSize({width: 390,height: 844});
  await page.screenshot({path: fileURLToPath(new URL('../../../work/ssh-connect-mobile.png', import.meta.url))});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole('button', {name: '切回本机',exact: true}).click();await page.waitForURL(url => !url.searchParams.has('host'));
  await page.waitForFunction(() => document.getElementById('connection').textContent === '本地连接');
  assert.equal(await page.evaluate(() => localStorage.getItem('tree-drafts').includes('本机草稿')), true);
  assert.deepEqual(errors, []);console.log('PASS: SSH form, explicit fingerprint confirmation, direct Codex with no runtime install UI, remote routing, scoped drafts/queues, gateway auth, local return, responsive layout');
} finally {await browser?.close();for (const res of streams) res.end();server.closeAllConnections();server.close();}

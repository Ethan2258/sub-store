import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'substore-check-'));
const password = crypto.randomBytes(24).toString('hex');
const salt = crypto.randomBytes(16);
let child;
async function start(trustProxy) {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const origin = 'http://127.0.0.1:' + port;
  child = spawn(process.execPath, ['auth-gateway/server.mjs'], {
    cwd: root, windowsHide: true, stdio: 'ignore',
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), ORIGIN: origin,
      TRUST_PROXY: String(trustProxy), STATE_FILE: path.join(temporary, 'state.json'),
      PASSWORD_SALT: salt.toString('base64url'), PASSWORD_HASH: crypto.scryptSync(password, salt, 32).toString('base64url'),
      SESSION_SECRET: crypto.randomBytes(32).toString('base64url') },
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await fetch(origin + '/check'); return origin; } catch { await new Promise(resolve => setTimeout(resolve, 50)); }
  }
  throw new Error('Gateway failed to start');
}
async function stop() {
  if (child && child.exitCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped; }
}
try {
  let origin = await start(true);
  const request = (endpoint, body, ip = '198.51.100.1', cookie, customOrigin = origin) => fetch(origin + endpoint, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', origin: customOrigin, 'x-client-ip': ip, ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal((await request('/check')).status, 401);
  const login = await request('/login', { password });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.match(login.headers.get('set-cookie'), /Max-Age=86400/);
  assert.equal((await request('/check', undefined, '198.51.100.1', cookie)).status, 204);
  assert.equal((await request('/check', undefined, '198.51.100.8', cookie)).status, 401);
  assert.equal((await request('/logout', {}, '198.51.100.1', cookie, 'https://invalid.example')).status, 403);
  assert.equal((await request('/logout', {}, '198.51.100.1', cookie)).status, 200);
  assert.equal((await request('/check', undefined, '198.51.100.1', cookie)).status, 401);
  for (let attempt = 0; attempt < 5; attempt++) assert.equal((await request('/login', { password: 'wrong' }, '198.51.100.2')).status, 401);
  assert.equal((await request('/login', { password: 'wrong' }, '198.51.100.2')).status, 429);
  const senders = [];
  const pending = Array.from({ length: 8 }, () => new Promise((resolve, reject) => {
    const req = http.request(origin + '/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-client-ip': '198.51.100.3', origin } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject); req.write('{"password":'); senders.push(() => req.end('"wrong"}'));
  }));
  await new Promise(resolve => setTimeout(resolve, 100));
  senders.forEach(send => send());
  const statuses = await Promise.all(pending);
  assert.ok(statuses.filter(status => status === 401).length <= 5);
  assert.ok(statuses.includes(429));
  assert.ok(statuses.every(status => status === 401 || status === 429));
  for (let attempt = 0; attempt < 5; attempt++) assert.equal((await request('/passkey/auth/verify', { credential: {} }, '198.51.100.9')).status, 400);
  assert.equal((await request('/passkey/auth/verify', { credential: {} }, '198.51.100.9')).status, 429);
  const newLogin = await request('/login', { password, return: '//invalid.example' }, '198.51.100.1');
  assert.equal((await newLogin.json()).redirect, '/');
  const restartCookie = newLogin.headers.get('set-cookie').split(';')[0];
  await stop();
  origin = await start(false);
  assert.equal((await request('/check', undefined, '198.51.100.1', restartCookie)).status, 401);
  for (let attempt = 0; attempt < 5; attempt++) assert.equal((await request('/login', { password: 'wrong' }, '198.51.100.' + (attempt + 10))).status, 401);
  assert.equal((await request('/login', { password: 'wrong' }, '198.51.100.99')).status, 429);
  console.log('Gateway checks passed: logout revocation, origin protection, sequential/concurrent limits, untrusted proxy headers.');
} finally {
  await stop();
  await fs.rm(temporary, { recursive: true, force: true });
}

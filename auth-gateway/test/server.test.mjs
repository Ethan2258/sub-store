// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 ZHENG YI HENG

// Starts the gateway on a free port with a known password and checks the
// password login, the session check nginx relies on, and the lockout.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

const PASSWORD = 'correct horse battery staple';
let base;
let child;
let dir;

const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.listen(0, '127.0.0.1', () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
  srv.on('error', reject);
});

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'substore-auth-'));
  const salt = crypto.randomBytes(16);
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [new URL('../server.mjs', import.meta.url).pathname], {
    env: {
      ...process.env,
      ORIGIN: base,
      PORT: String(port),
      PASSWORD_SALT: salt.toString('base64url'),
      PASSWORD_HASH: crypto.scryptSync(PASSWORD, salt, 32).toString('base64url'),
      SESSION_SECRET: crypto.randomBytes(32).toString('base64url'),
      STATE_FILE: path.join(dir, 'state.json'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { if (String(d).includes('listening')) resolve(); });
    child.on('exit', (code) => reject(new Error(`gateway exited with ${code}`)));
  });
});

after(() => {
  child?.kill();
  fs.rmSync(dir, { recursive: true, force: true });
});

const login = (password, ip) => fetch(`${base}/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: base, 'X-Client-IP': ip },
  body: JSON.stringify({ password, return: '/subs' }),
});

test('pages and the browser bundle are served', async () => {
  assert.equal((await fetch(`${base}/login`)).status, 200);
  const js = await fetch(`${base}/webauthn-browser.js`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
});

test('without a session /check rejects the request', async () => {
  assert.equal((await fetch(`${base}/check`)).status, 401);
});

const check = (cookie, ip) => fetch(`${base}/check`, { headers: { Cookie: cookie, 'X-Client-IP': ip } });

test('the right password gives a session that /check accepts', async () => {
  const res = await login(PASSWORD, '203.0.113.1');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { redirect: '/subs' });
  const cookie = res.headers.get('set-cookie').split(';')[0];
  assert.equal((await check(cookie, '203.0.113.1')).status, 204);
});

test('a session only works from the address that logged in', async () => {
  const res = await login(PASSWORD, '203.0.113.3');
  const cookie = res.headers.get('set-cookie').split(';')[0];
  assert.equal((await check(cookie, '198.51.100.7')).status, 401);
});

test('a tampered session cookie is rejected', async () => {
  const res = await login(PASSWORD, '203.0.113.2');
  const [name, value] = res.headers.get('set-cookie').split(';')[0].split('=');
  const forged = `${name}=${value.slice(0, -2)}${value.endsWith('AA') ? 'BB' : 'AA'}`;
  assert.equal((await check(forged, '203.0.113.2')).status, 401);
});

test('five wrong passwords lock the address out', async () => {
  const ip = '203.0.113.9';
  for (let i = 0; i < 5; i += 1) assert.equal((await login('wrong', ip)).status, 401);
  assert.equal((await login(PASSWORD, ip)).status, 429);
  assert.equal((await login(PASSWORD, '203.0.113.10')).status, 200);
});

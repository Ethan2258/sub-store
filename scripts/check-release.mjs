import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
assert.equal(JSON.parse(read('package.json')).license, 'GPL-3.0-only');
assert.equal(JSON.parse(read('auth-gateway/package.json')).license, 'GPL-3.0-only');
assert.match(read('LICENSE'), /GNU GENERAL PUBLIC LICENSE/);
assert.match(read('NOTICE'), /webauthn-browser.LICENSE.txt/);
const license = read('auth-gateway/public/webauthn-browser.LICENSE.txt').trim();
const upstream = read('auth-gateway/node_modules/@simplewebauthn/browser/LICENSE.md').trim();
assert.ok(license.endsWith(upstream), 'Bundled third-party license must match its installed source');
assert.ok(read('auth-gateway/nginx.conf.example').includes('proxy_set_header X-Client-IP $remote_addr'));
console.log('Release checks passed: GPL metadata, original MIT text, proxy header override.');

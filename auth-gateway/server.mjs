import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 3102;
// Public address of the Sub-Store site, e.g. https://sub.example.com
const ORIGIN = new URL(requiredEnv('ORIGIN')).origin;
const RP_ID = process.env.RP_ID || new URL(ORIGIN).hostname;
const COOKIE_SECURE = ORIGIN.startsWith('https:') ? '; Secure' : '';
const COOKIE = 'substore_admin';
const YEAR = 365 * 24 * 60 * 60;
const STATE_FILE = process.env.STATE_FILE || '/var/lib/substore-auth/state.json';
const BROWSER_BUNDLE = fileURLToPath(new URL('./public/webauthn-browser.js', import.meta.url));
const PASSWORD_SALT = Buffer.from(requiredEnv('PASSWORD_SALT'), 'base64url');
const PASSWORD_HASH = Buffer.from(requiredEnv('PASSWORD_HASH'), 'base64url');
const SESSION_SECRET = Buffer.from(requiredEnv('SESSION_SECRET'), 'base64url');

const challenges = new Map();
const failures = new Map();
let state = loadState();

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return {
      sessionVersion: Number(parsed.sessionVersion) || 1,
      credentials: Array.isArray(parsed.credentials) ? parsed.credentials : [],
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { sessionVersion: 1, credentials: [] };
  }
}

function saveState() {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true, mode: 0o700 });
  const temp = `${STATE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, STATE_FILE);
}

function clientIp(req) {
  return String(req.headers['x-client-ip'] || req.socket.remoteAddress || '').trim();
}

function cookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || '')
      .split(';')
      .map((part) => part.trim().split('='))
      .filter(([key, value]) => key && value)
      .map(([key, ...rest]) => [key, rest.join('=')]),
  );
}

function b64(value) {
  return Buffer.from(value).toString('base64url');
}

function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
}

function createSession(ip) {
  const payload = b64(JSON.stringify({ ip, exp: Math.floor(Date.now() / 1000) + YEAR, v: state.sessionVersion }));
  return `${payload}.${sign(payload)}`;
}

function validSession(req) {
  const token = cookies(req)[COOKIE];
  if (!token) return false;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return false;
  const expected = sign(payload);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.ip === clientIp(req) && data.exp > Date.now() / 1000 && data.v === state.sessionVersion;
  } catch {
    return false;
  }
}

function sessionCookie(token) {
  return `${COOKIE}=${token}; Path=/; Max-Age=${YEAR}; HttpOnly${COOKIE_SECURE}; SameSite=Lax`;
}

function clearCookie(name) {
  return `${name}=; Path=/; Max-Age=0; HttpOnly${COOKIE_SECURE}; SameSite=Lax`;
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function redirect(res, location, headers = {}) {
  res.writeHead(303, { Location: location, 'Cache-Control': 'no-store', ...headers });
  res.end();
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 128 * 1024) throw new Error('Request too large');
  }
  return raw;
}

async function readJson(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return Object.fromEntries(new URLSearchParams(raw));
  }
}

function safeReturn(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  if (/[\u0000-\u001F\u007F]/.test(value)) return '/';
  return value;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function rateStatus(ip) {
  const now = Date.now();
  const entry = failures.get(ip);
  if (!entry) return { blocked: false, retry: 0 };
  if (entry.blockedUntil > now) return { blocked: true, retry: Math.ceil((entry.blockedUntil - now) / 1000) };
  if (now - entry.first > 10 * 60 * 1000) failures.delete(ip);
  return { blocked: false, retry: 0 };
}

function recordFailure(ip) {
  const now = Date.now();
  let entry = failures.get(ip);
  if (!entry || now - entry.first > 10 * 60 * 1000) entry = { count: 0, first: now, blockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= 5) entry.blockedUntil = now + 30 * 60 * 1000;
  failures.set(ip, entry);
  console.warn(`AUTH_FAIL ip=${ip} count=${entry.count} blocked=${entry.blockedUntil > now}`);
}

function checkPassword(password) {
  const candidate = crypto.scryptSync(String(password), PASSWORD_SALT, PASSWORD_HASH.length);
  return crypto.timingSafeEqual(candidate, PASSWORD_HASH);
}

// Challenges are looked up by the value the authenticator signed, so an
// autofill request and a button press on the same page can both be open.
function issueChallenge(req, type, challenge) {
  const now = Date.now();
  for (const [key, item] of challenges) if (item.expires < now || challenges.size > 500) challenges.delete(key);
  challenges.set(challenge, { type, ip: clientIp(req), expires: now + 5 * 60 * 1000 });
}

function takeChallenge(req, type, response) {
  let challenge = '';
  try {
    challenge = String(JSON.parse(Buffer.from(String(response?.response?.clientDataJSON || ''), 'base64url').toString('utf8')).challenge || '');
  } catch {
    return null;
  }
  const item = challenge && challenges.get(challenge);
  if (!item || item.type !== type) return null;
  challenges.delete(challenge);
  if (item.ip !== clientIp(req) || item.expires < Date.now()) return null;
  return challenge;
}

const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

// Same black / white / grey liquid glass as the Sub-Store front end
// (Ethan2258/sub-store src/themes/*.ts, liquid-glass.scss, App.vue).
const PAGE_CSS = `
:root{color-scheme:light;--bg:#f5f5f7;--text:#1d1d1f;--text-2:#3a3a3c;--muted:#6e6e73;--placeholder:#8e8e93;--glass-stroke:#ffffffc7;--glass-highlight:#ffffffeb;--glass-fill:#ffffff99;--glass-sheen:#ffffffcc;--card:#ffffff8f;--group:#ffffffa8;--divider:#00000014;--btn-from:#1d1d1f;--btn-to:#3a3a3c;--btn-text:#fff;--ring:#0000001f;--shadow:0 24px 64px #00000014,0 2px 10px #0000000a;--orb-1:#ffffffe6;--orb-2:#0000000f;--orb-3:#00000009;--glow:radial-gradient(ellipse 90% 42% at 8% -10%,#ffffffb3,transparent 58%),radial-gradient(ellipse 70% 36% at 100% 0%,#ffffff47,transparent 52%),radial-gradient(ellipse 50% 32% at 78% 110%,#0000000d,transparent 50%);--font:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display","Helvetica Neue","PingFang SC","Noto Sans SC","Source Han Sans SC",sans-serif}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#000;--text:#fff;--text-2:#f2f2f7;--muted:#aeaeb2;--placeholder:#8e8e93;--glass-stroke:#ffffff47;--glass-highlight:#ffffff1a;--glass-fill:#ffffff17;--glass-sheen:#ffffff12;--card:#16161899;--group:#ffffff0d;--divider:#ffffff2e;--btn-from:#f5f5f7;--btn-to:#d1d1d6;--btn-text:#000;--ring:#ffffff2e;--shadow:0 24px 64px #00000080,0 2px 10px #0000004d;--orb-1:#ffffff1f;--orb-2:#ffffff12;--orb-3:#ffffff0d;--glow:radial-gradient(ellipse 80% 36% at 12% -12%,#ffffff14,transparent 58%),radial-gradient(ellipse 60% 30% at 100% 38%,#ffffff0b,transparent 60%),radial-gradient(ellipse 70% 34% at 0% 92%,#ffffff0a,transparent 60%)}}
*{box-sizing:border-box}
html{height:100%;background:var(--bg)}
body{margin:0;min-height:100%;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:max(24px,env(safe-area-inset-top)) 16px max(24px,env(safe-area-inset-bottom));background:var(--glow),var(--bg);color:var(--text);font-family:var(--font);-webkit-font-smoothing:antialiased;-webkit-tap-highlight-color:transparent;overflow-x:hidden}
.orbs{position:fixed;inset:0;pointer-events:none;overflow:hidden}
.orbs i{position:absolute;border-radius:50%;filter:blur(56px);will-change:transform}
.orbs i:nth-child(1){width:340px;height:340px;left:calc(50% - 300px);top:calc(50% - 330px);background:var(--orb-1);animation:drift 26s ease-in-out infinite alternate}
.orbs i:nth-child(2){width:300px;height:300px;left:calc(50% + 10px);top:calc(50% + 20px);background:var(--orb-2);animation:drift 32s ease-in-out -9s infinite alternate-reverse}
.orbs i:nth-child(3){width:220px;height:220px;left:calc(50% - 250px);top:calc(50% + 120px);background:var(--orb-3);animation:drift 38s ease-in-out -17s infinite alternate}
@keyframes drift{from{transform:translate3d(-18px,-12px,0) scale(1)}to{transform:translate3d(22px,16px,0) scale(1.08)}}
main{position:relative;width:min(100%,384px);padding:36px 24px 22px;border-radius:28px;background-color:var(--card);background-image:linear-gradient(165deg,var(--glass-sheen) 0%,transparent 46%);border:1px solid var(--glass-stroke);box-shadow:var(--shadow),inset 0 1px 0 var(--glass-highlight);-webkit-backdrop-filter:blur(24px) saturate(180%);backdrop-filter:blur(24px) saturate(180%);animation:enter .6s cubic-bezier(.2,.8,.2,1) both;transition:opacity .26s ease,transform .26s ease}
@keyframes enter{from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:none}}
main.shake{animation:shake .42s cubic-bezier(.36,.07,.19,.97) both}
@keyframes shake{10%,90%{transform:translateX(-1px)}20%,80%{transform:translateX(3px)}30%,50%,70%{transform:translateX(-6px)}40%,60%{transform:translateX(6px)}}
body.leaving main{opacity:0;transform:scale(.97)}
.brand{display:flex;flex-direction:column;align-items:center;text-align:center;margin-bottom:28px}
.icon{display:grid;place-items:center;width:68px;height:68px;border-radius:18px;background:linear-gradient(145deg,var(--btn-from),var(--btn-to));color:var(--btn-text);box-shadow:0 10px 24px #00000024,inset 0 1px 0 #ffffff59}
.icon svg{width:60px;height:60px;display:block}
h1{margin:18px 0 0;font-size:26px;line-height:1.15;font-weight:700;letter-spacing:-.02em}
.sub{margin:6px 0 0;font-size:15px;line-height:1.4;color:var(--muted)}
.group{position:relative;border-radius:16px;background:var(--group);border:1px solid var(--glass-stroke);box-shadow:0 4px 14px #0000000a,inset 0 1px 0 var(--glass-highlight);transition:box-shadow .2s ease,border-color .2s ease}
.group:focus-within{box-shadow:0 0 0 4px var(--ring),0 4px 14px #0000000a,inset 0 1px 0 var(--glass-highlight)}
.field{position:relative;display:flex;align-items:center;min-height:52px;padding:0 0 0 16px;gap:12px;cursor:text}
.field+.field::before{content:"";position:absolute;left:16px;right:0;top:0;height:1px;background:var(--divider);transform:scaleY(.5);transform-origin:top}
.field span{flex:0 0 auto;min-width:3.2em;font-size:16px;color:var(--text-2)}
input{flex:1;width:100%;min-width:0;height:52px;margin:0;padding:0 44px 0 0;border:0;outline:none;border-radius:0;background:transparent;color:var(--text);font:inherit;font-size:17px;-webkit-appearance:none;appearance:none}
input::placeholder{color:var(--placeholder)}
input:-webkit-autofill,input:-webkit-autofill:focus{-webkit-text-fill-color:var(--text);caret-color:var(--text);transition:background-color 99999s ease 0s}
.btn{position:relative;display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:52px;margin:0;padding:0 20px;border-radius:999px;font:inherit;font-size:17px;font-weight:600;letter-spacing:-.01em;text-decoration:none;cursor:pointer;-webkit-appearance:none;appearance:none;transition:transform .18s ease,opacity .18s ease,box-shadow .18s ease}
.btn:active:not(:disabled){transform:scale(.98);opacity:.84}
.btn:disabled{cursor:default}
.btn:focus-visible{outline:none;box-shadow:0 0 0 4px var(--ring)}
.primary{margin-top:16px;border:0;color:var(--btn-text);background:linear-gradient(135deg,var(--btn-from),var(--btn-to));box-shadow:0 6px 18px #00000024,inset 0 1px 0 #ffffff59}
.glass{border:1px solid var(--glass-stroke);color:var(--text);font-weight:500;background:var(--glass-fill);-webkit-backdrop-filter:blur(16px) saturate(160%);backdrop-filter:blur(16px) saturate(160%);box-shadow:0 4px 14px #0000000f,inset 0 1px 0 var(--glass-highlight)}
.glass+.glass,.primary+.glass{margin-top:12px}
.plain{height:44px;margin-top:8px;border:0;background:transparent;color:var(--muted);font-size:15px;font-weight:400}
.btn svg{width:20px;height:20px;flex:none}
.btn .label,.btn .icon-ok{transition:opacity .18s ease,transform .18s ease}
.btn .spin,.btn .icon-ok{position:absolute;left:50%;top:50%;opacity:0;pointer-events:none}
.btn .spin{width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;border:2px solid currentColor;border-right-color:transparent;transition:opacity .18s ease}
.btn .icon-ok{width:22px;height:22px;margin:-11px 0 0 -11px;transform:scale(.6)}
.btn[data-state=loading] .spin{opacity:.9;animation:spin .7s linear infinite}
.btn[data-state=loading] .label,.btn[data-state=done] .label{opacity:0}
.btn[data-state=done] .icon-ok{opacity:1;transform:none}
@keyframes spin{to{transform:rotate(360deg)}}
.or{display:flex;align-items:center;gap:12px;margin:20px 4px;color:var(--muted);font-size:13px}
.or::before,.or::after{content:"";flex:1;height:1px;background:var(--divider)}
.status{display:flex;align-items:center;justify-content:center;gap:6px;min-height:20px;margin:16px 0 0;font-size:14px;line-height:20px;text-align:center;color:var(--muted)}
.status.error{color:var(--text);font-weight:500}
.status.error::before{content:"!";display:inline-grid;place-items:center;flex:none;width:18px;height:18px;border-radius:50%;background:var(--text);color:var(--bg);font-size:12px;font-weight:700;line-height:1}
.status:empty::before{display:none}
[hidden]{display:none!important}
@media (max-width:380px){main{padding:32px 18px 18px;border-radius:24px}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
`;

// Sub-Store's own logo, drawn in one colour so it follows the theme.
const LOGO = `<svg viewBox="0 0 108 108" aria-hidden="true"><path d="M57.7183124,39.2119247 C61.1183124,28.9119247 51.2183124,18.6119247 40.9183124,21.7119247 C38.3183124,22.5119247 34.5183124,25.5119247 29.1183124,30.9119247 L21.2183124,38.9119247 L23.4183124,41.1119247 L25.6183124,43.3119247 L33.4183124,35.6119247 C39.8183124,29.2119247 41.7183124,27.9119247 44.4183124,27.9119247 C51.6183124,27.9119247 54.1183124,36.1119247 48.6183124,41.4119247 L45.6183124,44.3119247 L47.8183124,46.6119247 L50.0183124,48.9119247 L53.3183124,45.7119247 C55.1183124,44.0119247 57.1183124,41.0119247 57.7183124,39.2119247 Z" fill="currentColor" transform="translate(39.809156, 35.031598) scale(-1, 1) rotate(-360.000000) translate(-39.809156, -35.031598) "/><path d="M49.4,60.392072 L43.6,54.5 L46.5,51.5 L49.4,48.5 L47.2,46.3 L45,44 L39.8,49.3 L34.5,54.5 L39.5,59.5 C42.2,62.2 44.7,64.5 45.1,64.5 C45.3,64.5 46.7333333,63.1306907 49.4,60.392072 Z" fill="currentColor" transform="translate(41.950000, 54.250000) scale(-1, 1) rotate(-180.000000) translate(-41.950000, -54.250000) "/><path d="M73.3,60.392072 L67.5,54.5 L70.4,51.5 L73.3,48.5 L71.1,46.3 L68.9,44 L63.7,49.3 L58.4,54.5 L63.4,59.5 C66.1,62.2 68.6,64.5 69,64.5 C69.2,64.5 70.6333333,63.1306907 73.3,60.392072 Z" fill="currentColor" transform="translate(65.850000, 54.250000) rotate(-180.000000) translate(-65.850000, -54.250000) "/><path d="M31,79.0608814 C27.5,75.0608814 27.1,70.6608814 30,67.7608814 C33.1,64.6608814 38,65.1608814 41.5,68.7608814 L44.4,71.7608814 L46.7,69.5608814 L49,67.3608814 L45.8,64.0608814 C39.6,57.6608814 31.5,57.2608814 25.6,63.2608814 C19.6,69.1608814 19.9,76.8608814 26.3,83.4608814 L29.4,86.7608814 L31.7,84.5608814 L33.9,82.4608814 L31,79.0608814 Z" fill="currentColor" transform="translate(35.146221, 72.880441) scale(-1, 1) rotate(-180.000000) translate(-35.146221, -72.880441) "/><path d="M68.7075588,41.2119247 C65.2075588,37.2119247 64.8075588,32.8119247 67.7075588,29.9119247 C70.8075588,26.8119247 75.7075588,27.3119247 79.2075588,30.9119247 L82.1075588,33.9119247 L84.4075588,31.7119247 L86.7075588,29.5119247 L83.5075588,26.2119247 C77.3075588,19.8119247 69.2075588,19.4119247 63.3075588,25.4119247 C57.3075588,31.3119247 57.6075588,39.0119247 64.0075588,45.6119247 L67.1075588,48.9119247 L69.4075588,46.7119247 L71.6075588,44.6119247 L68.7075588,41.2119247 Z" fill="currentColor" transform="translate(72.853779, 35.031484) scale(-1, 1) rotate(-360.000000) translate(-72.853779, -35.031484) "/><path d="M86.1,77.0606524 C89.5,66.7606524 79.6,56.4606524 69.3,59.5606524 C66.7,60.3606524 62.9,63.3606524 57.5,68.7606524 L49.6,76.7606524 L51.8,78.9606524 L54,81.1606524 L61.8,73.4606524 C68.2,67.0606524 70.1,65.7606524 72.8,65.7606524 C80,65.7606524 82.5,73.9606524 77,79.2606524 L74,82.1606524 L76.2,84.4606524 L78.4,86.7606524 L81.7,83.5606524 C83.5,81.8606524 85.5,78.8606524 86.1,77.0606524 Z" fill="currentColor" transform="translate(68.190844, 72.880326) scale(-1, 1) rotate(-180.000000) translate(-68.190844, -72.880326) "/></svg>`;
const ICON_PASSKEY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="7.5" r="3.5"/><path d="M2.5 20v-1a5.5 5.5 0 0 1 9.2-4.1"/><circle cx="18" cy="11.5" r="2.5"/><path d="M18 14v6.5m0-2.5h2m-2-2h1.5"/></svg>';
const BUTTON_PARTS = '<span class="spin" aria-hidden="true"></span><svg class="icon-ok" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function page(title, content, script = '') {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f5f5f7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">
<meta name="robots" content="noindex,nofollow">
<title>${title}</title>
<link rel="icon" href="/favicon.ico">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style>${PAGE_CSS}</style>
</head>
<body>
<div class="orbs" aria-hidden="true"><i></i><i></i><i></i></div>
<main>${content}</main>
<script src="/_auth/webauthn-browser.js"></script>
<script>${script}</script>
</body>
</html>`;
}

function brand(title, subtitle) {
  return `<div class="brand"><div class="icon">${LOGO}</div><h1>${title}</h1><p class="sub">${subtitle}</p></div>`;
}

// Client helpers shared by both pages. No backticks or template
// placeholders in here: it is embedded in a server-side template literal.
const CLIENT_COMMON = `
var SWA=window.SimpleWebAuthnBrowser,card=document.querySelector('main'),statusEl=document.getElementById('status');
function say(msg,kind){statusEl.textContent=msg||'';statusEl.className='status'+(kind?' '+kind:'')}
function fail(msg){say(msg,'error');card.classList.remove('shake');void card.offsetWidth;card.classList.add('shake')}
function setState(btn,state){if(btn)btn.dataset.state=state||''}
function isAbort(e){return !e||e.name==='AbortError'||e.code==='ERROR_CEREMONY_ABORTED'}
function report(flow,e){fetch('/_auth/client-error',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({flow:flow,name:e&&e.name,message:e&&e.message})}).catch(function(){})}
async function post(url,body){
  var r;
  try{r=await fetch(url,{method:'POST',credentials:'same-origin',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined})}
  catch(e){var n=new Error('网络异常，请检查网络后重试');n.name='NetworkError';throw n}
  var d={};try{d=await r.json()}catch(e){}
  if(!r.ok){var err=new Error(d.error||('请求失败 ('+r.status+')'));err.name='ServerError';err.status=r.status;throw err}
  return d;
}
function leave(to){setTimeout(function(){document.body.classList.add('leaving');setTimeout(function(){location.replace(to)},260)},360)}
card.addEventListener('animationend',function(){card.classList.remove('shake')});
`;

function renderLogin({ error = '', returnTo = '/', username = 'admin' } = {}) {
  const safeUser = escapeHtml(String(username).slice(0, 128));
  const hasPasskey = state.credentials.length > 0;
  const webauthn = hasPasskey ? ' webauthn' : '';
  return page('登录 · Sub-Store', `
  ${brand('Sub-Store', '登录后管理你的订阅')}
  <form id="login" method="post" action="/_auth/login" autocomplete="on" novalidate>
    <input type="hidden" name="return" value="${escapeHtml(returnTo)}">
    <div class="group">
      <label class="field" for="username"><span>用户名</span>
        <input id="username" name="username" type="text" autocomplete="username${webauthn}" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="next" placeholder="admin" value="${safeUser}" required>
      </label>
      <label class="field" for="password"><span>密码</span>
        <input id="password" name="password" type="password" autocomplete="current-password${webauthn}" enterkeyhint="go" placeholder="管理密码" required>
      </label>
    </div>
    <button id="submit" class="btn primary" type="submit"><span class="label">登录</span>${BUTTON_PARTS}</button>
  </form>
  ${hasPasskey ? `<div class="or" id="or">或</div>
  <button id="passkey" class="btn glass" type="button">${ICON_PASSKEY}<span class="label">使用通行密钥登录</span>${BUTTON_PARTS}</button>` : ''}
  <p id="status" class="status${error ? ' error' : ''}" role="status" aria-live="polite">${escapeHtml(error)}</p>
`, `(function(){
${CLIENT_COMMON}
var form=document.getElementById('login'),user=document.getElementById('username'),pass=document.getElementById('password'),
  submitBtn=document.getElementById('submit'),passkeyBtn=document.getElementById('passkey'),
  ret=form.elements['return'].value||'/',busy=false,modal=false,conditional=false,armedAt=0,queue=Promise.resolve();
var fine=window.matchMedia&&matchMedia('(pointer: fine)').matches;
if(passkeyBtn&&!(window.PublicKeyCredential&&SWA)){passkeyBtn.hidden=true;document.getElementById('or').hidden=true;passkeyBtn=null}
function lock(on){busy=on;submitBtn.disabled=on;if(passkeyBtn)passkeyBtn.disabled=on}
function done(btn,to){setState(btn,'done');say('登录成功，正在进入 Sub-Store');leave(to||ret)}
function focusField(){if(!fine||busy)return;var el=user.value?pass:user;if(document.activeElement!==el)el.focus({preventScroll:true})}
// Challenge requests go out one at a time so answers arrive in order.
function options(autofill){var p=queue.then(function(){return post('/_auth/passkey/auth/options'+(autofill?'?autofill=1':''))});queue=p.catch(function(){});return p}

form.addEventListener('submit',async function(ev){
  ev.preventDefault();
  if(busy)return;
  if(!pass.value){fail('请输入密码');pass.focus();return}
  lock(true);setState(submitBtn,'loading');say('');
  try{
    var d=await post('/_auth/login',{username:user.value,password:pass.value,return:ret});
    done(submitBtn,d.redirect);
  }catch(e){
    lock(false);setState(submitBtn,'');
    fail(e.message||'登录失败');
    pass.focus();pass.select();
    arm();
  }
});

async function verify(credential,btn){
  lock(true);setState(btn,'loading');say('正在验证通行密钥');
  var d=await post('/_auth/passkey/auth/verify',{credential:credential,return:ret});
  done(btn,d.redirect);
}

// Passkey suggestions in the username / password autofill menu
// (1Password inline menu, iCloud Keychain, Chrome). The challenge is
// refreshed before the server's 5 minute limit so a page left open
// still signs in on the first try.
async function arm(){
  if(!conditional||busy||modal)return;
  armedAt=Date.now();
  var o,c;
  try{o=await options(true)}catch(e){return} // retried by keepFresh
  if(busy||modal)return;
  setTimeout(focusField,120);
  try{c=await SWA.startAuthentication({optionsJSON:o,useBrowserAutofill:true})}
  catch(e){if(!isAbort(e)&&e.name!=='NotAllowedError')report('autofill',e);return}
  try{await verify(c,submitBtn)}
  catch(e){
    lock(false);setState(submitBtn,'');
    report('autofill',e);fail(e.message||'通行密钥验证失败');
    setTimeout(arm,800);
  }
}
function keepFresh(){if(document.visibilityState==='visible'&&conditional&&!busy&&!modal&&Date.now()-armedAt>240000)arm()}
setInterval(keepFresh,30000);
document.addEventListener('visibilitychange',keepFresh);

if(passkeyBtn)passkeyBtn.addEventListener('click',async function(){
  if(busy)return;
  modal=true;lock(true);setState(passkeyBtn,'loading');say('');
  try{
    var o=await options(false);
    var c=await SWA.startAuthentication({optionsJSON:o});
    modal=false;
    await verify(c,passkeyBtn);
  }catch(e){
    modal=false;lock(false);setState(passkeyBtn,'');
    if(e.name==='NotAllowedError'||isAbort(e))say('已取消通行密钥验证');
    else{report('authenticate',e);fail(e.message||'通行密钥验证失败')}
    arm();
  }
});

window.addEventListener('pageshow',function(ev){
  if(!ev.persisted)return;
  document.body.classList.remove('leaving');lock(false);setState(submitBtn,'');setState(passkeyBtn,'');say('');armedAt=0;keepFresh();
});

(async function(){
  try{conditional=!!(passkeyBtn&&SWA&&await SWA.browserSupportsWebAuthnAutofill())}catch(e){conditional=false}
  if(conditional)arm();else focusField();
})();
})();`);
}

function sendLogin(res, status, options) {
  res.writeHead(status, PAGE_HEADERS);
  res.end(renderLogin(options));
}

function renderSettings() {
  const count = state.credentials.length;
  return page('安全设置 · Sub-Store', `
  ${brand('安全设置', `<span id="count">${count ? `已添加 ${count} 个通行密钥` : '尚未添加通行密钥'}</span>`)}
  <a class="btn primary" href="/"><span class="label">进入 Sub-Store</span></a>
  <button id="register" class="btn glass" type="button">${ICON_PASSKEY}<span class="label">添加通行密钥</span>${BUTTON_PARTS}</button>
  <button id="logout" class="btn plain" type="button">退出登录</button>
  <p id="status" class="status" role="status" aria-live="polite"></p>
`, `(function(){
${CLIENT_COMMON}
var reg=document.getElementById('register'),count=document.getElementById('count'),n=${count};
document.documentElement.dataset.passkeyReady=SWA?'true':'false';
if(!(window.PublicKeyCredential&&SWA))reg.hidden=true;
reg.addEventListener('click',async function(){
  if(reg.disabled)return;
  reg.disabled=true;setState(reg,'loading');say('');
  try{
    var o=await post('/_auth/passkey/register/options');
    var c=await SWA.startRegistration({optionsJSON:o});
    await post('/_auth/passkey/register/verify',c);
    n+=1;count.textContent='已添加 '+n+' 个通行密钥';
    setState(reg,'done');say('通行密钥已添加，下次可直接用它登录');
    setTimeout(function(){setState(reg,'');reg.disabled=false},1600);
  }catch(e){
    reg.disabled=false;setState(reg,'');
    if(e.name==='NotAllowedError'||isAbort(e))say('已取消添加');
    else{report('register',e);fail(e.name==='InvalidStateError'?'这个设备上的通行密钥已经添加过了':(e.message||'添加失败'))}
  }
});
document.getElementById('logout').addEventListener('click',async function(){
  try{await post('/_auth/logout')}catch(e){}
  location.replace('/_auth/login');
});
})();`);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, ORIGIN);
    if (req.method === 'GET' && url.pathname === '/check') {
      res.writeHead(validSession(req) ? 204 : 401, { 'Cache-Control': 'no-store' });
      return res.end();
    }
    if (req.method === 'GET' && url.pathname === '/login') {
      if (validSession(req)) return redirect(res, safeReturn(url.searchParams.get('return')));
      return sendLogin(res, 200, { returnTo: safeReturn(url.searchParams.get('return')) });
    }
    if (req.method === 'GET' && url.pathname === '/settings') {
      if (!validSession(req)) return redirect(res, '/_auth/login?return=/_auth/settings');
      res.writeHead(200, PAGE_HEADERS);
      return res.end(renderSettings());
    }
    if (req.method === 'GET' && url.pathname === '/webauthn-browser.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
      return fs.createReadStream(BROWSER_BUNDLE).pipe(res);
    }
    if (req.method === 'POST' && url.pathname === '/client-error') {
      const body = await readJson(req);
      console.warn(`CLIENT_ERROR ip=${clientIp(req)} flow=${String(body.flow).slice(0,32)} name=${String(body.name).slice(0,64)} message=${String(body.message).slice(0,400)}`);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/login') {
      const ip = clientIp(req);
      const rate = rateStatus(ip);
      const contentType = String(req.headers['content-type'] || '');
      const form = contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data');
      let password = '';
      let username = 'admin';
      let ret = '/';
      if (form) {
        const params = new URLSearchParams(await readBody(req));
        password = params.get('password') || '';
        username = params.get('username') || 'admin';
        ret = params.get('return') || '/';
      } else {
        const body = await readJson(req);
        password = body.password;
        username = body.username || 'admin';
        ret = body.return;
      }
      const destination = safeReturn(ret);
      const fail = (status, error, extraHeaders) => {
        if (form) return sendLogin(res, status, { error, returnTo: destination, username });
        return json(res, status, { error }, extraHeaders);
      };
      if (rate.blocked) return fail(429, `尝试次数过多，请在 ${Math.ceil(rate.retry / 60)} 分钟后重试`, { 'Retry-After': String(rate.retry) });
      if (!checkPassword(password)) {
        recordFailure(ip);
        return fail(401, '密码错误');
      }
      failures.delete(ip);
      console.log(`AUTH_SUCCESS ip=${ip} method=password`);
      if (form) return redirect(res, destination, { 'Set-Cookie': sessionCookie(createSession(ip)) });
      return json(res, 200, { redirect: destination }, { 'Set-Cookie': sessionCookie(createSession(ip)) });
    }
    if (req.method === 'POST' && url.pathname === '/logout') {
      return json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie(COOKIE) });
    }
    if (req.method === 'POST' && url.pathname === '/passkey/register/options') {
      if (!validSession(req)) return json(res, 401, { error: '请先使用管理密码登录' });
      const options = await generateRegistrationOptions({
        rpName: 'Sub-Store', rpID: RP_ID, userID: new Uint8Array(Buffer.from('substore-admin')), userName: 'admin', userDisplayName: 'Sub-Store 管理员', attestationType: 'none',
        excludeCredentials: state.credentials.map((c) => ({ id: c.id, transports: c.transports })),
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
      });
      issueChallenge(req, 'register', options.challenge);
      return json(res, 200, options);
    }
    if (req.method === 'POST' && url.pathname === '/passkey/register/verify') {
      if (!validSession(req)) return json(res, 401, { error: '请先使用管理密码登录' });
      const body = await readJson(req);
      const expectedChallenge = takeChallenge(req, 'register', body);
      if (!expectedChallenge) return json(res, 400, { error: '验证请求已过期，请重试' });
      const result = await verifyRegistrationResponse({ response: body, expectedChallenge, expectedOrigin: ORIGIN, expectedRPID: RP_ID, requireUserVerification: false });
      if (!result.verified || !result.registrationInfo) return json(res, 400, { error: '通行密钥验证失败' });
      const credential = result.registrationInfo.credential;
      state.credentials = state.credentials.filter((c) => c.id !== credential.id);
      state.credentials.push({ id: credential.id, publicKey: Buffer.from(credential.publicKey).toString('base64url'), counter: credential.counter, transports: credential.transports || body.response?.transports || [] });
      saveState();
      console.log(`PASSKEY_REGISTERED ip=${clientIp(req)} id=${credential.id}`);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/passkey/auth/options') {
      if (!state.credentials.length) return json(res, 400, { error: '尚未添加通行密钥，请先使用管理密码登录' });
      const ip = clientIp(req);
      const rate = rateStatus(ip);
      if (rate.blocked) return json(res, 429, { error: '尝试次数过多，请稍后重试' }, { 'Retry-After': String(rate.retry) });
      const autofill = url.searchParams.get('autofill') === '1';
      const options = await generateAuthenticationOptions({
        rpID: RP_ID,
        userVerification: 'preferred',
        ...(autofill ? {} : { allowCredentials: state.credentials.map((c) => ({ id: c.id, transports: c.transports })) }),
      });
      issueChallenge(req, 'authenticate', options.challenge);
      return json(res, 200, options);
    }
    if (req.method === 'POST' && url.pathname === '/passkey/auth/verify') {
      const ip = clientIp(req);
      const body = await readJson(req);
      const expectedChallenge = takeChallenge(req, 'authenticate', body.credential);
      if (!expectedChallenge) return json(res, 400, { error: '验证请求已过期，请刷新页面后重试' });
      const stored = state.credentials.find((c) => c.id === body.credential?.id);
      if (!stored) { recordFailure(ip); return json(res, 401, { error: '未识别的通行密钥' }); }
      const result = await verifyAuthenticationResponse({
        response: body.credential, expectedChallenge, expectedOrigin: ORIGIN, expectedRPID: RP_ID, requireUserVerification: false,
        credential: { id: stored.id, publicKey: Buffer.from(stored.publicKey, 'base64url'), counter: stored.counter, transports: stored.transports },
      });
      if (!result.verified) { recordFailure(ip); return json(res, 401, { error: '通行密钥验证失败' }); }
      stored.counter = result.authenticationInfo.newCounter;
      saveState(); failures.delete(ip);
      console.log(`AUTH_SUCCESS ip=${ip} method=passkey`);
      return json(res, 200, { redirect: safeReturn(body.return) }, { 'Set-Cookie': sessionCookie(createSession(ip)) });
    }
    json(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    json(res, 400, { error: '请求无效' });
  }
});

server.listen(PORT, HOST, () => console.log(`Sub-Store auth listening on ${HOST}:${PORT}`));

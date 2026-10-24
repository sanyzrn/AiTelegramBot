import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash } from 'node:crypto';
import { createAdminSession, verifyAdminSession, verifyTelegramLogin } from '../supabase/functions/_shared/nexa-admin-auth.ts';
import { readFileSync } from 'node:fs';

const secret='123456:TELEGRAM_TEST_BOT_TOKEN';
const uid='781234567';
const now=1761300000000;

function signedLogin(fields) {
  const check=Object.entries(fields).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+'='+v).join('\n');
  const hash=createHmac('sha256',createHash('sha256').update(secret).digest()).update(check).digest('hex');
  return { ...fields, hash };
}

test('accepts valid Telegram login only for the configured administrator',async()=>{
  const auth=signedLogin({ id:uid, first_name:'Nexa Admin', auth_date:Math.floor(now/1000) });
  assert.equal(await verifyTelegramLogin(auth,secret,uid,now),true);
  assert.equal(await verifyTelegramLogin(auth,secret,'99999999',now),false);
  assert.equal(await verifyTelegramLogin({...auth,id:'123456'},secret,uid,now),false);
  assert.equal(await verifyTelegramLogin(auth,secret,uid,now+181000),false);
  assert.equal(await verifyTelegramLogin(auth,'wrong',uid,now),false);
});

test('admin session is short lived and cryptographically protected',async()=>{
  const token=await createAdminSession(uid,secret,now);
  assert.equal(await verifyAdminSession(token,secret,uid,now),true);
  assert.equal(await verifyAdminSession(token,secret,'somebody-else',now),false);
  assert.equal(await verifyAdminSession(token,secret,uid,now+901000),false);
  assert.equal(await verifyAdminSession(token,'other-bot',uid,now),false);
  const changed=token.slice(0,-2)+(token.endsWith('AA')?'BB':'AA');
  assert.equal(await verifyAdminSession(changed,secret,uid,now),false);
  assert.equal(await verifyAdminSession('bad.token',secret,uid,now),false);
});

test('admin API is origin restricted and never exposes server secrets to browser',()=>{
  const api=readFileSync(new URL('../supabase/functions/nexa-admin/index.ts',import.meta.url),'utf8');
  const html=readFileSync(new URL('../admin-web/index.html',import.meta.url),'utf8');
  const js=readFileSync(new URL('../admin-web/app.js',import.meta.url),'utf8');
  assert.match(api,/req\.headers\.get\("Origin"\)!==ORIGIN/);
  assert.match(api,/verifyAdminSession\(token,TOKEN,ACCESS\.adminId\)/);
  assert.match(api,/nexa_user_api_remove/);
  assert.doesNotMatch(js,/SUPABASE_SERVICE_ROLE_KEY|CUSTOM_API_KEY|GEMINI_API_KEY|OPENROUTER_API_KEY/);
  assert.match(html,/id="tgLogin"/);
});

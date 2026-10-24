import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBotAi } from '../supabase/functions/_shared/admin-api-pool.ts';
import { userAiContext } from '../supabase/functions/_shared/user-ai.ts';
import { readFileSync } from 'node:fs';

const base={provider:'gemini',gemini:'gemini-env',openrouter:'router-env',
  custom:'custom-env',customBaseUrl:'https://legacy.example/v1',search:'gemini-env',
  daily:40,chatSearch:true};
const env={gemini:'global-google-secret',openrouter:'global-router-secret',custom:'global-custom-secret'};

test('selected Gemini credential replaces the legacy key and model',async()=>{
 const db={async rpc(name){assert.equal(name,'nexa_admin_api_active');return {data:[
  {provider:'gemini',model:'gemini-new-model',api_key:'pool-key-g',base_url:null}
 ],error:null}}};
 const ai=await resolveBotAi(db,base,env);
 assert.equal(ai.config.provider,'gemini');
 assert.equal(ai.config.gemini,'gemini-new-model');
 assert.equal(ai.keys.gemini,'pool-key-g');
 assert.equal(ai.keys.openrouter,'');
 assert.equal(ai.keys.custom,'');
});

test('OpenRouter and custom selections never leak other provider keys',async()=>{
 const make=(row)=>({async rpc(){return {data:[row],error:null}}});
 const router=await resolveBotAi(make({provider:'openrouter',model:'a/b',api_key:'pool-or'}),base,env);
 assert.equal(router.config.provider,'openrouter');
 assert.equal(router.config.openrouter,'a/b');
 assert.equal(router.keys.gemini,'');
 assert.equal(router.keys.openrouter,'pool-or');
 const custom=await resolveBotAi(make({provider:'custom',model:'my-model',base_url:'https://example.com/v1',api_key:'pool-custom'}),base,env);
 assert.equal(custom.config.custom,'my-model');
 assert.equal(custom.config.customBaseUrl,'https://example.com/v1');
 assert.equal(custom.keys.custom,'pool-custom');
 assert.equal(custom.keys.gemini,'');
});

test('personal BYOK takes priority over active bot-owned credential',async()=>{
 const calls=[];
 const db={async rpc(name){
  calls.push(name);
  if(name==='nexa_user_api_get') return {data:[{provider:'gemini',api_key:'personal-key'}],error:null};
  throw Error('must not read admin pool for personal BYOK');
 }};
 const ai=await userAiContext(db,55,base,env);
 assert.equal(ai.personal,true);
 assert.equal(ai.keys.gemini,'personal-key');
 assert.deepEqual(calls,['nexa_user_api_get']);
});

test('legacy Supabase Secrets remain selectable when no pool key is active',async()=>{
 const db={async rpc(name){return {data:[],error:null}}};
 const ai=await resolveBotAi(db,base,env);
 assert.deepEqual(ai.keys,env);
 assert.equal(ai.config.provider,'gemini');
});

test('a broken Vault query must fail closed, not leak legacy provider keys',async()=>{
 const db={async rpc(name){
  if(name==='nexa_user_api_get')return {data:[],error:null};
  return {data:null,error:{code:'PGRST999'}};
 }};
 await assert.rejects(userAiContext(db,55,base,env),/BOT_API_POOL_READ/);
});

test('admin API never includes decrypted secrets in the credential list',()=>{
 const server=readFileSync(new URL('../supabase/functions/nexa-admin/index.ts',import.meta.url),'utf8');
 const client=readFileSync(new URL('../admin-web/app.js',import.meta.url),'utf8');
 const sql=readFileSync(new URL('../supabase/migrations/20261024180000_nexa_admin_api_pool.sql',import.meta.url),'utf8');
 assert.match(server,/nexa_admin_api_keys"\)\.select\("id,provider,label,model,base_url,enabled,is_active/);
 assert.match(server,/verifyAdminSession/);
 assert.doesNotMatch(client,/SUPABASE_SERVICE_ROLE_KEY|vault\.decrypted_secrets/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.nexa_admin_api_active\(\) FROM PUBLIC, anon, authenticated/);
});

// Run inside the current app container with recent app logs on stdin.
// Only allowlisted facts/counters leave the container; credentials/PII stay in memory.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const base=process.env.NEXT_PUBLIC_SUPABASE_URL;
assert.equal(new URL(base).hostname,'awganmhowivedfocwzjy.supabase.co');
const names=['supabase_service_role','encryption_key','automation_cron_secret','meta_app_secret'];
const secrets=names.map(name=>{
  const file='/run/secrets/wacrm_staging_'+name;
  return {name,present:fs.existsSync(file),value:fs.existsSync(file)?fs.readFileSync(file,'utf8').trim():''};
});
const key=secrets.find(x=>x.name==='supabase_service_role').value;
assert.ok(key);
const get=async(route,admin=true)=>{
  const r=await fetch(base+route,{headers:admin?{apikey:key,Authorization:'Bearer '+key}
    :{apikey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY},redirect:'error',signal:AbortSignal.timeout(15000)});
  assert.equal(r.status,200); return r.json();
};
const settings=await get('/auth/v1/settings',false);
const contacts=await get('/rest/v1/contacts?select=phone,email,name');
const attributions=await get('/rest/v1/meta_ad_attributions?select=ctwa_clid');
const logs=fs.readFileSync(0,'utf8');
const pii=contacts.flatMap(x=>[x.phone,x.email,x.name]).filter(x=>typeof x==='string'&&x.length>=4);
const leaked=values=>values.filter(x=>x&&logs.includes(x)).length;
const safeSite=process.env.NEXT_PUBLIC_SITE_URL;
const site=safeSite?new URL(safeSite):null;
const result={project:'awganmhowivedfocwzjy',node_env:process.env.NODE_ENV,
  site_url:site?.origin,site_url_correct:site?.origin==='https://crm.luizangelo.com.br',
  docker_secrets:secrets.map(({name,present,value})=>({name,present,nonempty:!!value})),
  auth_public_settings:{
    external_providers:Object.entries(settings.external??{}).filter(([,v])=>v===true).map(([k])=>k),
    disable_signup:settings.disable_signup,mailer_autoconfirm:settings.mailer_autoconfirm,
    phone_autoconfirm:settings.phone_autoconfirm,sms_provider:settings.sms_provider,
  },
  logs:{bytes:Buffer.byteLength(logs),lines:logs.split('\n').filter(Boolean).length,
    current_contact_plaintext_matches:leaked(pii),current_secret_matches:leaked(secrets.map(x=>x.value)),
    ctwa_clid_matches:leaked(attributions.map(x=>x.ctwa_clid)),
    bearer_pattern: /Bearer\s+[A-Za-z0-9_.-]{20,}/i.test(logs),
    password_uri_pattern:/postgres(?:ql)?:\/\/[^\s:@]+:[^\s@]+@/i.test(logs),
    raw_message_body_pattern:/"(?:body|text)"\s*:\s*"/.test(logs),
  },
  management_auth_settings:'Not exposed by this connector/public Auth settings: Site URL, redirects, SMTP, password policy, rate limits, MFA',
};
console.log(JSON.stringify(result));

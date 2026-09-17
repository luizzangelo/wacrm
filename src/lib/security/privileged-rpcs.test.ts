import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';

const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const OWNER = '10000000-0000-4000-8000-000000000001';
const MEMBER = '10000000-0000-4000-8000-000000000002';
const OTHER = '10000000-0000-4000-8000-000000000003';
const RESOURCE = '20000000-0000-4000-8000-000000000001';
const CONTACT = '30000000-0000-4000-8000-000000000001';
const privateCalls = [
  'merge_duplicate_contacts()', 'merge_duplicate_conversations()',
  `claim_ai_reply_slot('${RESOURCE}',2)`, `record_webhook_failure('${RESOURCE}',2)`,
  `recompute_broadcast_counts('${RESOURCE}')`, `_bcast_bump('${RESOURCE}','sent_count',1)`,
];
const names = new Set([
  '_bcast_bump', '_bcast_cols_for_status', 'broadcast_recipient_aggregate_trigger',
  'recompute_broadcast_counts', 'increment_flow_execution_count', 'claim_ai_reply_slot',
  'increment_automation_execution_count', 'is_account_member', 'handle_new_user',
  'set_member_role', 'remove_account_member', 'transfer_account_ownership',
  'peek_invitation', 'redeem_invitation', 'merge_duplicate_contacts', 'touch_presence',
  'notify_conversation_assigned', 'record_webhook_failure', 'merge_duplicate_conversations',
  'bump_conversation_on_inbound', 'create_broadcast_with_recipients',
]);
let db: PGlite;
async function caller(role: 'anon' | 'authenticated' | 'service_role', uid = '') {
  await db.query("SELECT set_config('test.uid',$1,false)", [uid]);
  await db.exec(`SET ROLE ${role}`);
}
async function snapshot() {
  await db.exec('RESET ROLE');
  return (await db.query(`SELECT (SELECT jsonb_agg(to_jsonb(p) ORDER BY user_id) FROM profiles p) AS profiles,
    (SELECT jsonb_agg(to_jsonb(w)) FROM webhook_endpoints w) AS webhook,
    (SELECT jsonb_agg(to_jsonb(c)) FROM conversations c) AS conversations`)).rows;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync(resolve('src/lib/security/rpc-schema.fixture.sql'), 'utf8'));
  // Replay ACTUAL function definitions, not simulated authorization bodies.
  // Latest definition per name (038 replaces a broadcast overload).
  const definitions = new Map<string, string>();
  for (const file of readdirSync(resolve('supabase/migrations')).sort()) {
    if (file.includes('security_hardening')) continue;
    const sql = readFileSync(resolve('supabase/migrations', file), 'utf8');
    const pattern = /CREATE OR REPLACE FUNCTION\s+(?:public\.)?(\w+)\s*\([\s\S]*?AS\s+(\$\w*\$)[\s\S]*?\2[^;]*;/gi;
    for (const match of sql.matchAll(pattern)) {
      if (names.has(match[1])) definitions.set(match[1], match[0]);
    }
  }
  expect(definitions.size).toBe(names.size);
  for (const definition of definitions.values()) await db.exec(definition);
  // These PostgreSQL defaults reproduce the legacy PUBLIC execution leak.
  expect((await db.query<{ allowed: boolean }>(
    "SELECT has_function_privilege('anon','public.claim_ai_reply_slot(uuid,integer)','EXECUTE') AS allowed"
  )).rows[0].allowed).toBe(true);
  await db.exec('CREATE TRIGGER aggregate_recipient AFTER INSERT OR UPDATE OR DELETE ON broadcast_recipients FOR EACH ROW EXECUTE FUNCTION broadcast_recipient_aggregate_trigger()');
  await db.exec('CREATE TRIGGER signup AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user()');
  await db.exec('CREATE TRIGGER assigned AFTER INSERT OR UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION notify_conversation_assigned()');
  await db.exec(readFileSync(resolve('supabase/migrations/20260917161334_security_hardening_privileged_rpcs.sql'), 'utf8'));
}, 30000);
beforeEach(async () => {
  await db.exec(`BEGIN;
    INSERT INTO accounts(id,name,owner_user_id) VALUES ('${A}','Fixture A','${OWNER}'),('${B}','Fixture B','${OTHER}');
    INSERT INTO profiles(user_id,account_id,account_role,full_name,email) VALUES
      ('${OWNER}','${A}','owner','Fixture Owner','owner@example.invalid'),
      ('${MEMBER}','${A}','agent','Fixture Member','member@example.invalid'),
      ('${OTHER}','${B}','owner','Fixture Other','other@example.invalid');
    INSERT INTO contacts(id,account_id,phone_normalized) VALUES('${CONTACT}','${A}','15550000001');
    INSERT INTO conversations(id,account_id,contact_id) VALUES('${RESOURCE}','${A}','${CONTACT}');
    INSERT INTO webhook_endpoints(id,account_id) VALUES('${RESOURCE}','${A}');
    INSERT INTO broadcasts(id,account_id) VALUES('${RESOURCE}','${A}');`);
});
afterEach(async () => { await db.exec('RESET ROLE; ROLLBACK'); });
afterAll(async () => { await db?.close(); });

describe('privileged RPC hardening in isolated PostgreSQL', () => {
  it('user mutations lock authorization rows and recheck target account at write time', async () => {
    for(const name of ['set_member_role','remove_account_member','transfer_account_ownership','touch_presence','redeem_invitation']) {
      const definition=(await db.query<{definition:string}>(
        'SELECT pg_get_functiondef(oid) AS definition FROM pg_proc WHERE proname=$1',[name])).rows[0].definition;
      expect(definition).toContain('FOR UPDATE');
      if(['set_member_role','remove_account_member','transfer_account_ownership'].includes(name))
        expect(definition).toContain('AND account_id = v_caller_account_id');
    }
  });
  it('anon and authenticated in both accounts cannot call any internal RPC; no mutation', async () => {
    const before = await snapshot();
    for (const [role, uid] of [['anon',''],['authenticated',OWNER],['authenticated',OTHER]] as const) {
      for (const call of privateCalls) {
        await caller(role,uid);
        await db.exec('SAVEPOINT denied');
        await expect(db.query(`SELECT ${call}`)).rejects.toMatchObject({ code: '42501' });
        await db.exec('ROLLBACK TO SAVEPOINT denied; RELEASE SAVEPOINT denied; RESET ROLE');
      }
    }
    expect(await snapshot()).toEqual(before);
  });
  it('guarded user RPCs reject cross-account resources, missing auth and insufficient role', async () => {
    const before = await snapshot();
    for (const call of [`set_member_role('${OTHER}','agent')`, `remove_account_member('${OTHER}')`,
      `transfer_account_ownership('${OTHER}')`]) {
      await caller('authenticated',OWNER);
      await db.exec('SAVEPOINT denied');
      await expect(db.query(`SELECT ${call}`)).rejects.toMatchObject({ code:'42501' });
      await db.exec('ROLLBACK TO SAVEPOINT denied; RELEASE SAVEPOINT denied; RESET ROLE');
    }
    for (const uid of ['',MEMBER]) {
      await caller('authenticated',uid);
      await db.exec('SAVEPOINT denied');
      await expect(db.query(`SELECT set_member_role('${MEMBER}','admin')`)).rejects.toMatchObject({code:'42501'});
      await db.exec('ROLLBACK TO SAVEPOINT denied; RELEASE SAVEPOINT denied; RESET ROLE');
    }
    expect(await snapshot()).toEqual(before);
  });
  it('same-account authorized role management and presence continue working', async () => {
    await caller('authenticated',OWNER);
    await db.query(`SELECT set_member_role('${MEMBER}','admin')`);
    await db.query("SELECT touch_presence('online')");
    await db.exec('RESET ROLE');
    expect((await db.query<{account_role:string}>(`SELECT account_role FROM profiles WHERE user_id='${MEMBER}'`)).rows[0].account_role).toBe('admin');
    expect((await db.query<{account_id:string,user_id:string}>('SELECT * FROM member_presence')).rows[0]).toMatchObject({account_id:A,user_id:OWNER});
  });
  it('authorized ownership transfer and member removal preserve legitimate behavior', async () => {
    await caller('authenticated',OWNER);
    await db.query(`SELECT transfer_account_ownership('${MEMBER}')`);
    await db.exec('RESET ROLE');
    expect((await db.query<{owner_user_id:string}>(`SELECT owner_user_id FROM accounts WHERE id='${A}'`)).rows[0].owner_user_id).toBe(MEMBER);
    await caller('authenticated',MEMBER);
    const removed=(await db.query<{personal:string}>(`SELECT remove_account_member('${OWNER}') AS personal`)).rows[0].personal;
    expect(removed).not.toBe(A);
    await db.exec('RESET ROLE');
    expect((await db.query<{account_id:string,account_role:string}>(`SELECT account_id,account_role FROM profiles WHERE user_id='${OWNER}'`)).rows[0])
      .toEqual({account_id:removed,account_role:'owner'});
  });
  it('a sole owner of an empty account can still redeem a valid invitation', async () => {
    await db.exec(`INSERT INTO account_invitations(account_id,role,token_hash,expires_at)
      VALUES('${A}','agent','fixture-valid-invite',now()+interval '1 hour')`);
    await caller('authenticated',OTHER);
    expect((await db.query<{joined:string}>("SELECT redeem_invitation('fixture-valid-invite') AS joined")).rows[0].joined).toBe(A);
    await db.exec('RESET ROLE');
    expect((await db.query<{account_id:string,account_role:string}>(`SELECT account_id,account_role FROM profiles WHERE user_id='${OTHER}'`)).rows[0])
      .toEqual({account_id:A,account_role:'agent'});
    expect((await db.query(`SELECT id FROM accounts WHERE id='${B}'`)).rows).toHaveLength(0);
    expect((await db.query<{accepted:boolean}>("SELECT accepted_at IS NOT NULL AS accepted FROM account_invitations")).rows[0].accepted).toBe(true);
  });
  it('service role retains AI claim, webhook failure, unread and broadcast helpers', async () => {
    await caller('service_role');
    expect((await db.query<{claimed:boolean}>(`SELECT claim_ai_reply_slot('${RESOURCE}',1) AS claimed`)).rows[0].claimed).toBe(true);
    expect((await db.query<{claimed:boolean}>(`SELECT claim_ai_reply_slot('${RESOURCE}',1) AS claimed`)).rows[0].claimed).toBe(false);
    await db.query(`SELECT record_webhook_failure('${RESOURCE}',1)`);
    await db.query(`SELECT bump_conversation_on_inbound('${RESOURCE}','Fixture')`);
    await db.query(`INSERT INTO broadcast_recipients(broadcast_id,contact_id,status) VALUES('${RESOURCE}','${CONTACT}','delivered')`);
    await db.query(`SELECT recompute_broadcast_counts('${RESOURCE}')`);
    await db.exec('RESET ROLE');
    expect((await db.query('SELECT failure_count,is_active FROM webhook_endpoints')).rows[0]).toEqual({failure_count:1,is_active:false});
    expect((await db.query('SELECT ai_reply_count,unread_count FROM conversations')).rows[0]).toEqual({ai_reply_count:1,unread_count:1});
    expect((await db.query('SELECT sent_count,delivered_count FROM broadcasts')).rows[0]).toEqual({sent_count:1,delivered_count:1});
  });
  it('service-role merges preserve children and keep distinct account groups separate', async () => {
    await db.exec(`INSERT INTO contacts(id,account_id,phone_normalized,created_at) VALUES
      ('${MEMBER}','${A}','15550000001',now()+interval '1 minute'),
      ('${OTHER}','${B}','15550000001',now());
      INSERT INTO conversations(id,account_id,contact_id,created_at,unread_count) VALUES('${MEMBER}','${A}','${MEMBER}',now()+interval '1 minute',2);
      INSERT INTO messages(conversation_id,content_text) VALUES('${MEMBER}','Fixture child');`);
    await caller('service_role');
    expect((await db.query<{merged:number}>('SELECT merge_duplicate_contacts() AS merged')).rows[0].merged).toBe(1);
    expect((await db.query<{merged:number}>('SELECT merge_duplicate_conversations() AS merged')).rows[0].merged).toBe(1);
    await db.exec('RESET ROLE');
    expect((await db.query('SELECT conversation_id FROM messages')).rows[0]).toEqual({conversation_id:RESOURCE});
    expect((await db.query('SELECT id FROM contacts ORDER BY id')).rows).toEqual([{id:OTHER},{id:CONTACT}]);
  });
  it('fixed search_path prevents privileged temporary relation and function shadowing', async () => {
    await db.exec(`CREATE TEMP TABLE profiles(user_id UUID,account_id UUID,account_role account_role_enum);
      INSERT INTO pg_temp.profiles VALUES('${OTHER}','${A}','owner');
      GRANT SELECT ON pg_temp.profiles TO authenticated;`);
    await caller('authenticated',OTHER);
    expect((await db.query<{member:boolean}>(`SELECT is_account_member('${A}','owner') AS member`)).rows[0].member).toBe(false);
    await db.exec('SAVEPOINT denied');
    await expect(db.query(`SELECT set_member_role('${MEMBER}','admin')`)).rejects.toMatchObject({code:'42501'});
    await db.exec('ROLLBACK TO SAVEPOINT denied; RELEASE SAVEPOINT denied; RESET ROLE');
    await db.exec('DROP TABLE pg_temp.profiles');
    await caller('authenticated',OWNER);
    await db.exec('SAVEPOINT denied');
    await expect(db.exec('CREATE FUNCTION public.attack() RETURNS void LANGUAGE sql AS $$ DELETE FROM public.profiles $$')).rejects.toMatchObject({code:'42501'});
    await db.exec('ROLLBACK TO SAVEPOINT denied; RELEASE SAVEPOINT denied');
  });
  it('dynamic broadcast column identifier cannot inject SQL even for service role', async () => {
    const before = await snapshot();
    await caller('service_role');
    await db.exec('SAVEPOINT denied');
    await expect(db.query(`SELECT _bcast_bump($1,$2,1)`,[RESOURCE,'sent_count = 999; DELETE FROM profiles; --'])).rejects.toMatchObject({code:'42703'});
    await db.exec('ROLLBACK TO SAVEPOINT denied; RELEASE SAVEPOINT denied');
    expect(await snapshot()).toEqual(before);
  });
  it('only reviewed read-only anon exceptions and scoped authenticated functions remain', async () => {
    const rows = (await db.query<{name:string,anon:boolean,auth:boolean,definer:boolean}>(`SELECT p.proname AS name,p.prosecdef AS definer,
      has_function_privilege('anon',p.oid,'EXECUTE') AS anon,
      has_function_privilege('authenticated',p.oid,'EXECUTE') AS auth
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef`)).rows;
    expect(rows.filter(x=>x.anon).map(x=>x.name).sort()).toEqual(['is_account_member','peek_invitation']);
    expect(rows.filter(x=>x.auth).map(x=>x.name).sort()).toEqual(['is_account_member','peek_invitation','redeem_invitation','remove_account_member','set_member_role','touch_presence','transfer_account_ownership']);
    await caller('anon');
    expect((await db.query<{member:boolean}>(`SELECT is_account_member('${A}') AS member`)).rows[0].member).toBe(false);
    expect((await db.query<{preview:unknown}>("SELECT peek_invitation('not-a-capability') AS preview")).rows[0].preview).toEqual({ok:false,reason:'not_found'});
  });
  it('invitation redemption cannot orphan members and remains atomic', async () => {
    await db.exec(`INSERT INTO account_invitations(account_id,role,token_hash,expires_at) VALUES('${B}','agent','fixture-invite',now()+interval '1 hour')`);
    await caller('authenticated',OWNER);
    await db.exec('SAVEPOINT denied');
    await expect(db.query("SELECT redeem_invitation('fixture-invite')")).rejects.toMatchObject({code:'23505'});
    await db.exec('ROLLBACK TO SAVEPOINT denied; RELEASE SAVEPOINT denied; RESET ROLE');
    expect((await db.query('SELECT accepted_at FROM account_invitations')).rows[0]).toEqual({accepted_at:null});
    expect((await db.query<{account_id:string}>(`SELECT account_id FROM profiles WHERE user_id='${OWNER}'`)).rows[0].account_id).toBe(A);
  });
  it('signup and assignment triggers continue functioning without direct browser grants', async () => {
    // Test a genuinely new signup with the real trigger function.
    const uid='90000000-0000-4000-8000-000000000001';
    await db.query(`INSERT INTO auth.users VALUES($1,'new@example.invalid','{"full_name":"Fixture Signup"}')`,[uid]);
    expect((await db.query<{account_role:string}>(`SELECT account_role FROM profiles WHERE user_id=$1`,[uid])).rows[0].account_role).toBe('owner');
    await caller('service_role');
    await db.query(`UPDATE conversations SET assigned_agent_id='${MEMBER}' WHERE id='${RESOURCE}'`);
    await db.exec('RESET ROLE');
    expect((await db.query('SELECT user_id FROM notifications')).rows[0]).toEqual({user_id:MEMBER});
  });
});

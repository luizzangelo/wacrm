import {beforeEach,describe,it,expect,vi} from 'vitest';
const h=vi.hoisted(()=>({role:'viewer',meta:vi.fn(),mutations:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'user-A'}},error:null})},from:(table:string)=>{
  if(table!=='profiles'){h.mutations();throw new Error('Unexpected write')}
  return {select:()=>({eq:()=>({maybeSingle:async()=>({data:{account_id:'A',account_role:h.role},error:null})})})};
}})}));
vi.mock('@/lib/whatsapp/meta-api',()=>({registerPhoneNumber:h.meta,subscribeWabaToApp:h.meta,verifyPhoneNumber:h.meta}));
import {POST,DELETE} from './route';
describe('WhatsApp configuration role guard precedes ALL Meta side effects',()=>{
 beforeEach(()=>{vi.clearAllMocks()});
 it.each(['viewer','agent'])('denies %s before reading body or invoking external APIs',async role=>{
  h.role=role;
  const read=vi.fn(async()=>({account_id:'B',access_token:'synthetic',phone_number_id:'synthetic'}));
  const response=await POST({json:read} as unknown as Request);
  expect(response.status).toBe(403);expect(read).not.toHaveBeenCalled();expect(h.meta).not.toHaveBeenCalled();expect(h.mutations).not.toHaveBeenCalled();
 });
 it.each(['viewer','agent'])('denies reset by %s before any delete',async role=>{
  h.role=role;expect((await DELETE()).status).toBe(403);expect(h.mutations).not.toHaveBeenCalled();
 });
});

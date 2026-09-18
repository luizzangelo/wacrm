import {describe,it,expect,vi,beforeEach} from 'vitest';
const h=vi.hoisted(()=>({rpc:vi.fn(),auth:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:h.auth},rpc:h.rpc})}));
vi.mock('@/lib/rate-limit',()=>({checkRateLimit:()=>({success:true}),RATE_LIMITS:{adminAction:{}},rateLimitResponse:vi.fn()}));
import {POST} from './route';
beforeEach(()=>{h.rpc.mockReset().mockResolvedValue({data:'new-account-C',error:null});h.auth.mockReset().mockResolvedValue({data:{user:{id:'C'}},error:null});});
const request=(body:unknown)=>new Request('https://crm.invalid/api/account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
describe('profile-less onboarding cannot select another tenant',()=>{
  it.each([{account_id:'account-A'},{account_role:'owner'},null,[]])('rejects forged or invalid onboarding %j',async(body)=>{
    expect((await POST(request(body))).status).toBe(400);expect(h.rpc).not.toHaveBeenCalled();
  });
  it('official route delegates only name to auth-derived transactional RPC',async()=>{
    const response=await POST(request({name:'C'}));
    expect(response.status).toBe(200);expect(h.rpc).toHaveBeenCalledWith('create_my_account',{p_name:'C'});
  });
  it('anonymous user cannot create account',async()=>{
    h.auth.mockResolvedValue({data:{user:null},error:null});
    expect((await POST(request({}))).status).toBe(401);expect(h.rpc).not.toHaveBeenCalled();
  });
});

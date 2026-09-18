import {describe,it,expect,vi,beforeEach} from 'vitest';
const h=vi.hoisted(()=>({signed:vi.fn(),download:vi.fn(),context:vi.fn()}));
vi.mock('@/lib/auth/account',()=>({getCurrentAccount:h.context,toErrorResponse:()=>new Response(null,{status:401})}));
import {GET,POST} from './route';
const context=(path:string,bucket='chat-media')=>({params:Promise.resolve({bucket,path:path.split('/')})});
beforeEach(()=>{
  h.signed.mockReset();h.download.mockReset();h.context.mockReset();
  h.context.mockResolvedValue({accountId:'A',userId:'user-A',supabase:{storage:{from:()=>({
    createSignedUrl:h.signed,download:h.download,
  })}}});
  // Caller-JWT Storage RLS, independently exercised on native PostgreSQL.
  h.signed.mockImplementation(async(path:string)=>path.startsWith('account-A/')?
    {data:{signedUrl:'https://storage.invalid/signed-A'},error:null}:{data:null,error:{message:'not found'}});
  h.download.mockImplementation(async(path:string)=>path.startsWith('account-A/')?
    {data:new Blob(['synthetic'],{type:'image/png'}),error:null}:{data:null,error:{message:'not found'}});
});
describe('private Storage routes use caller JWT, never service_role',()=>{
  it('authorized A downloads privately without a public redirect',async()=>{
    const response=await GET(new Request('https://crm.invalid'),context('account-A/file.png'));
    expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Location')).toBeNull();
  });
  it('authorized A requests a short-lived signed URL',async()=>{
    const response=await POST(new Request('https://crm.invalid'),context('account-A/file.png'));
    expect(response.status).toBe(200);expect(h.signed).toHaveBeenCalledWith('account-A/file.png',60);
  });
  it.each(['download','sign'])('A knowing B path cannot %s',async(operation)=>{
    const route=operation==='download'?GET:POST;
    expect((await route(new Request('https://crm.invalid'),context('account-B/file.png'))).status).toBe(404);
  });
  it('anonymous callers cannot download or sign',async()=>{
    h.context.mockRejectedValue(new Error('unauthorized'));
    expect((await GET(new Request('https://crm.invalid'),context('account-A/file.png'))).status).toBe(401);
    expect((await POST(new Request('https://crm.invalid'),context('account-A/file.png'))).status).toBe(401);
    expect(h.download).not.toHaveBeenCalled();expect(h.signed).not.toHaveBeenCalled();
  });
  it('rejects traversal and unsupported bucket before Storage operations',async()=>{
    expect((await POST(new Request('https://crm.invalid'),context('account-A/../B'))).status).toBe(404);
    expect((await GET(new Request('https://crm.invalid'),context('file','unknown'))).status).toBe(404);
    expect(h.signed).not.toHaveBeenCalled();expect(h.download).not.toHaveBeenCalled();
  });
});

import {describe,it,expect,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {mediaUrlForDelivery} from './delivery-url';
import {privateObjectUrl,parsePrivateObjectUrl,validObjectPath} from './private-reference';
const A='10000000-0000-4000-8000-000000000001';
const B='10000000-0000-4000-8000-000000000002';
describe('tenant-private media delivery (no network)',()=>{
  const sign=vi.fn(async()=>({data:{signedUrl:'https://storage.invalid/signed'},error:null}));
  const db={storage:{from:()=>({createSignedUrl:sign})}} as unknown as SupabaseClient;
  it('durable URLs contain no token and round-trip the original path',()=>{
    const path=`account-${A}/my file.png`;
    const url=privateObjectUrl('chat-media',path);
    expect(url).toBe(`/api/storage/chat-media/account-${A}/my%20file.png`);
    expect(parsePrivateObjectUrl(url)).toEqual({bucket:'chat-media',path});
    expect(url).not.toContain('token');
  });
  it('signs media A only for account A, with bounded TTL',async()=>{
    await mediaUrlForDelivery(db,A,privateObjectUrl('chat-media',`account-${A}/image.png`));
    expect(sign).toHaveBeenLastCalledWith(`account-${A}/image.png`,300);
  });
  it('rejects foreign tenant path BEFORE service-role signing',async()=>{
    sign.mockClear();
    await expect(mediaUrlForDelivery(db,A,privateObjectUrl('chat-media',`account-${B}/image.png`))).rejects.toThrow('account');
    expect(sign).not.toHaveBeenCalled();
  });
  it('rejects avatar as outbound account media before signing',async()=>{
    sign.mockClear();
    await expect(mediaUrlForDelivery(db,A,privateObjectUrl('avatars',`${B}/avatar.png`))).rejects.toThrow();
    expect(sign).not.toHaveBeenCalled();
  });
  it.each(['../file','a/../file','a//file','a\\file','a/\u0000file'])('rejects invalid path %s',path=>{
    expect(validObjectPath(path)).toBe(false);
  });
  it('refuses unsupported bucket',()=>{
    expect(()=>privateObjectUrl('unknown',`account-${A}/file`)).toThrow();
  });
  it('preserves external links without making requests',async()=>{
    sign.mockClear();
    expect(await mediaUrlForDelivery(db,A,'https://external.invalid/image.png')).toBe('https://external.invalid/image.png');
    expect(sign).not.toHaveBeenCalled();
  });
});

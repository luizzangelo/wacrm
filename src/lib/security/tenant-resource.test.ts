import {describe,it,expect} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {requireConversationRecipient} from './tenant-resource';
describe('service-role recipient binding before external send',()=>{
 function db(data:unknown){const filters:unknown[]=[];const chain={select:()=>chain,eq:(key:string,value:string)=>{filters.push([key,value]);return chain},maybeSingle:async()=>({data,error:null})};return {client:{from:()=>chain} as unknown as SupabaseClient,filters};}
 it('requires BOTH conversation and authorized account filters',async()=>{
  const test=db({account_id:'A',contact_id:'contact-A'});
  await requireConversationRecipient(test.client,'A','conversation-A','contact-A');
  expect(test.filters).toEqual([['id','conversation-A'],['account_id','A']]);
 });
 it.each([null,{account_id:'B',contact_id:'contact-A'},{account_id:'A',contact_id:'contact-B'},{}])('fails closed for forged/missing resource %j',async(data)=>{
  await expect(requireConversationRecipient(db(data).client,'A','forged-id','contact-A')).rejects.toThrow();
 });
});

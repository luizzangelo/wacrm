import type {SupabaseClient} from '@supabase/supabase-js';
/** Validate the complete recipient chain before any external send. */
export async function requireConversationRecipient(db:SupabaseClient,accountId:string,conversationId:string,contactId:string) {
  const {data,error} = await db.from('conversations').select('id,account_id,contact_id')
    .eq('id',conversationId).eq('account_id',accountId).maybeSingle();
  if (error || !data || data.account_id!==accountId || data.contact_id!==contactId)
    throw new Error('Conversation recipient does not belong to this account');
}

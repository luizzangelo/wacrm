import type { SupabaseClient } from '@supabase/supabase-js';
import { parsePrivateObjectUrl } from './private-reference';
/** Privileged senders must verify ownership before creating a bearer URL. */
export async function mediaUrlForDelivery(db: SupabaseClient, accountId: string, input: string): Promise<string> {
  const ref = parsePrivateObjectUrl(input);
  if (!ref) return input;
  if (ref.bucket === 'avatars' || ref.path.split('/')[0] !== `account-${accountId}`) {
    throw new Error('Media does not belong to this account');
  }
  const {data, error} = await db.storage.from(ref.bucket).createSignedUrl(ref.path, 300);
  if (error || !data?.signedUrl) throw new Error('Could not authorize private media');
  return data.signedUrl;
}

/** Keep the stored template durable; sign only its delivery-time copy. */
export async function templateMediaForDelivery<T extends {header_media_url?: string | null}>(
  db: SupabaseClient, accountId: string, template: T,
): Promise<T> {
  if (!template.header_media_url) return template;
  return {...template,header_media_url:await mediaUrlForDelivery(db,accountId,template.header_media_url)};
}

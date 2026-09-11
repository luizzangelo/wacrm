import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// This client bypasses RLS and must remain server-only. Callers authenticate
// first and every repository operation below is explicitly account-scoped.
let adminClient: SupabaseClient | null = null;

export function metaConversionsAdmin(): SupabaseClient {
  if (!adminClient) {
    adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return adminClient;
}

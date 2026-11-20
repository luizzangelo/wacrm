import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { operationalErrorFields } from '@/lib/security/operational-log';

/**
 * Lists the tags available to the authenticated workspace.
 *
 * The explicit account_id predicate is intentional even though RLS also
 * protects the table: flow configuration must never receive tag choices from
 * another tenant if a policy is changed later.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const { data, error } = await supabase
      .from('tags')
      .select('id, name, color')
      .eq('account_id', accountId)
      .order('name', { ascending: true });

    if (error) {
      console.error('[tags] list failed:', operationalErrorFields(error));
      return NextResponse.json(
        { error: 'Could not load tags' },
        { status: 500 }
      );
    }

    return NextResponse.json({ tags: data ?? [] });
  } catch (error) {
    return toErrorResponse(error);
  }
}

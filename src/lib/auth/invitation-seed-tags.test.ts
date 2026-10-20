// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20261020162259_invitation_ignore_seed_tags.sql',
    import.meta.url
  )
);
const cleanupMigrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20261020174441_invitation_cleanup_order.sql',
    import.meta.url
  )
);

describe('invitation data-loss guard', () => {
  it('ignores tags but retains every other domain-data guard', async () => {
    const sql = await readFile(migrationPath, 'utf8');
    expect(sql).not.toContain(
      'SELECT 1 FROM public.tags WHERE account_id=old_account'
    );
    for (const table of [
      'contacts',
      'conversations',
      'deals',
      'broadcasts',
      'automations',
      'flows',
      'message_templates',
      'custom_fields',
      'contact_notes',
      'whatsapp_config',
      'meta_conversion_config',
    ]) {
      expect(sql).toContain(`public.${table}`);
    }
    expect(sql).toContain('NOT is_bootstrap');
    expect(sql).toContain('DELETE FROM public.accounts WHERE id=old_account');
  });

  it('deletes the temporary bootstrap graph before deleting its account', async () => {
    const sql = await readFile(cleanupMigrationPath, 'utf8');
    const pipelines = sql.indexOf(
      'DELETE FROM public.pipelines WHERE account_id=old_account'
    );
    const tags = sql.indexOf(
      'DELETE FROM public.tags WHERE account_id=old_account'
    );
    const account = sql.indexOf(
      'DELETE FROM public.accounts WHERE id=old_account'
    );
    expect(pipelines).toBeGreaterThan(0);
    expect(tags).toBeGreaterThan(pipelines);
    expect(account).toBeGreaterThan(tags);
  });
});

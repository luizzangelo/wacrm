'use client';

import { useTranslations } from 'next-intl';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { LOST_REASONS, type LostReason } from '@/lib/deals/lifecycle';

export function LostReasonFields({
  reason,
  notes,
  onReasonChange,
  onNotesChange,
}: {
  reason: LostReason | '';
  notes: string;
  onReasonChange: (reason: LostReason | '') => void;
  onNotesChange: (notes: string) => void;
}) {
  const t = useTranslations('Pipelines.loss');
  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        <Label htmlFor="lost-reason">{t('reason')}</Label>
        <select
          id="lost-reason"
          value={reason}
          required
          onChange={(event) =>
            onReasonChange(event.target.value as LostReason | '')
          }
          className="border-border bg-muted text-foreground h-9 w-full rounded-lg border px-2.5 text-sm"
        >
          <option value="">{t('selectReason')}</option>
          {LOST_REASONS.map((code) => (
            <option key={code} value={code}>
              {t(`reasons.${code}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="lost-reason-notes">{t('notes')}</Label>
        <Textarea
          id="lost-reason-notes"
          value={notes}
          maxLength={4000}
          onChange={(event) => onNotesChange(event.target.value)}
        />
      </div>
    </div>
  );
}

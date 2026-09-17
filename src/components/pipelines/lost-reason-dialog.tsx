'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { LostReasonFields } from './lost-reason-fields';
import type { LossDetails, LostReason } from '@/lib/deals/lifecycle';

/** Mounted only for an unpersisted transition. Cancel never calls onConfirm. */
export function LostReasonDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: (loss: LossDetails) => Promise<void>;
}) {
  const t = useTranslations('Pipelines.loss');
  const [reason, setReason] = useState<LostReason | ''>('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  async function confirm() {
    if (!reason || saving) return;
    setSaving(true);
    try {
      await onConfirm({
        lostReason: reason,
        lostReasonNotes: notes.trim() || null,
      });
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onCancel();
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('reason')}</DialogTitle>
        </DialogHeader>
        <LostReasonFields
          reason={reason}
          notes={notes}
          onReasonChange={setReason}
          onNotesChange={setNotes}
        />
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onCancel}>
            {t('cancel')}
          </Button>
          <Button disabled={!reason || saving} onClick={confirm}>
            {saving ? t('saving') : t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { CURRENCIES } from '@/lib/currency';
import {
  getDealMetaAttribution,
  type DealMetaAttributionSelection,
} from '@/lib/meta-conversions/attribution-view';
import type {
  Contact,
  Conversation,
  Deal,
  DealStatus,
  PipelineStage,
  Profile,
} from '@/types';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MetaAdsAttributionCard } from '@/components/meta-conversions/meta-ads-attribution-card';
import {
  Check,
  X,
  Trash2,
  MessageSquare,
  DollarSign,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  buildDealWriteFields,
  buildNewDealInsert,
  moveDealStageIfChanged,
} from '@/lib/deals/deal-write';
import { requestDealStageMove } from '@/lib/deals/stage-client';
import {
  initialDealStage,
  sortDealStages,
  type LossDetails,
  type LostReason,
} from '@/lib/deals/lifecycle';
import { LostReasonDialog } from './lost-reason-dialog';
import { LostReasonFields } from './lost-reason-fields';

interface DealFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal?: Deal | null;
  pipelineId: string;
  stages: PipelineStage[];
  defaultStageId?: string;
  onSaved: () => void;
}

export function DealForm({
  open,
  onOpenChange,
  deal,
  pipelineId,
  stages,
  onSaved,
}: DealFormProps) {
  const t = useTranslations('Pipelines.form');
  const lossT = useTranslations('Pipelines.loss');
  const supabase = createClient();
  const { accountId, defaultCurrency } = useAuth();

  const [lostReason, setLostReason] = useState<LostReason | ''>('');
  const [lostReasonNotes, setLostReasonNotes] = useState('');
  const [lossTarget, setLossTarget] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [currency, setCurrency] = useState(defaultCurrency);
  const [contactId, setContactId] = useState('');
  const [stageId, setStageId] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [expectedCloseDate, setExpectedCloseDate] = useState('');
  const [notes, setNotes] = useState('');

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [linkedConversation, setLinkedConversation] =
    useState<Conversation | null>(null);
  const [metaAttributionState, setMetaAttributionState] = useState<{
    requestKey: string;
    selection: DealMetaAttributionSelection;
  }>({
    requestKey: '',
    selection: { attribution: null, source: null },
  });

  const [saving, setSaving] = useState(false);
  const [statusAction, setStatusAction] = useState<DealStatus | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset the form fields every time the sheet opens or its input
  // props change. This is legitimate prop-driven form synchronization.
  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    setLossTarget(null);
    if (deal) {
      setLostReason(deal.lost_reason ?? '');
      setLostReasonNotes(deal.lost_reason_notes ?? '');
      setValue(String(deal.value ?? ''));
      setCurrency(deal.currency || defaultCurrency);
      // contact_id is nullable when the contact has been deleted
      // (migration 004: ON DELETE SET NULL). "" means "no selection".
      setContactId(deal.contact_id ?? '');
      setStageId(deal.stage_id);
      setAssignedTo(deal.assigned_to ?? '');
      setExpectedCloseDate(deal.expected_close_date ?? '');
      setNotes(deal.notes ?? '');
    } else {
      setLostReason('');
      setLostReasonNotes('');
      setValue('');
      setCurrency(defaultCurrency);
      setContactId('');
      setStageId(initialDealStage(stages)?.id || '');
      setAssignedTo('');
      setExpectedCloseDate('');
      setNotes('');
    }
  }, [open, deal, stages, defaultCurrency]);

  // Load supporting data once the sheet is open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const [c, p] = await Promise.all([
        supabase.from('contacts').select('*').order('name'),
        supabase.from('profiles').select('*').order('full_name'),
      ]);
      if (cancelled) return;
      setContacts((c.data ?? []) as Contact[]);
      setProfiles((p.data ?? []) as Profile[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, supabase]);

  useEffect(() => {
    if (!open || !accountId) return;
    const channel = supabase
      .channel(`deal-form-contact-names:${accountId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'contacts',
          filter: `account_id=eq.${accountId}`,
        },
        async () => {
          const { data } = await supabase
            .from('contacts')
            .select('*')
            .eq('account_id', accountId)
            .order('name');
          setContacts((data ?? []) as Contact[]);
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [accountId, open, supabase]);

  // Fetch linked conversation for the selected contact (newest open one).
  // Clearing on no-selection is sync with prop state; the populated
  // case runs setLinkedConversation inside the async fetch callback.
  useEffect(() => {
    if (!open || !contactId) {
      setLinkedConversation(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('conversations')
        .select('*')
        .eq('contact_id', contactId)
        .order('last_message_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setLinkedConversation((data as Conversation | null) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, contactId, supabase]);

  const fixedMetaAttributionId = deal?.meta_attribution_id ?? null;
  const previewContactId = fixedMetaAttributionId ? null : contactId || null;
  const metaAttributionRequestKey =
    open && accountId && (fixedMetaAttributionId || previewContactId)
      ? `${accountId}:${fixedMetaAttributionId ? `fixed:${fixedMetaAttributionId}` : `preview:${previewContactId}`}`
      : '';
  useEffect(() => {
    if (!metaAttributionRequestKey || !accountId) return;
    let cancelled = false;

    getDealMetaAttribution(supabase, {
      accountId,
      metaAttributionId: fixedMetaAttributionId,
      contactId: previewContactId,
    })
      .then((selection) => {
        if (!cancelled) {
          setMetaAttributionState({
            requestKey: metaAttributionRequestKey,
            selection,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMetaAttributionState({
            requestKey: metaAttributionRequestKey,
            selection: { attribution: null, source: null },
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    accountId,
    fixedMetaAttributionId,
    metaAttributionRequestKey,
    previewContactId,
    supabase,
  ]);

  const currentMetaAttributionSelection =
    metaAttributionState.requestKey === metaAttributionRequestKey
      ? metaAttributionState.selection
      : { attribution: null, source: null };
  const loadingMetaAttribution = Boolean(
    metaAttributionRequestKey &&
    metaAttributionState.requestKey !== metaAttributionRequestKey
  );

  async function handleSave(loss?: LossDetails, targetStageId = stageId) {
    if (!contactId || !targetStageId) {
      toast.error(t('toastRequired'));
      return;
    }
    const target = stages.find((stage) => stage.id === targetStageId);
    const lossDetails =
      loss ?? (lostReason ? { lostReason, lostReasonNotes } : undefined);
    if (target?.is_lost_stage && !lossDetails) {
      toast.error(lossT('required'));
      return;
    }
    setSaving(true);

    const values = {
      value,
      currency,
      contactId,
      stageId: targetStageId,
      assignedTo,
      notes,
      expectedCloseDate,
    };

    if (deal) {
      const { error } = await supabase
        .from('deals')
        .update(buildDealWriteFields(values))
        .eq('id', deal.id);
      if (error) {
        toast.error(t('toastFailedSave'));
        setSaving(false);
        return;
      }

      try {
        if (target?.is_lost_stage) {
          await requestDealStageMove(
            deal.id,
            targetStageId,
            undefined,
            lossDetails
          );
        } else {
          await moveDealStageIfChanged(deal.stage_id, targetStageId, () =>
            requestDealStageMove(deal.id, targetStageId)
          );
        }
      } catch {
        toast.error(t('toastStageMoveFailedAfterSave'));
        setSaving(false);
        onOpenChange(false);
        onSaved();
        return;
      }
    } else {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        toast.error(t('toastNotSignedIn'));
        setSaving(false);
        return;
      }
      if (!accountId) {
        toast.error(t('toastNotLinked'));
        setSaving(false);
        return;
      }
      const { error } = await supabase.from('deals').insert(
        buildNewDealInsert(values, {
          userId: user.id,
          accountId,
          pipelineId,
        })
      );
      if (error) {
        toast.error(
          error.message.includes('pipeline_has_no_normal_stage')
            ? lossT('noNormalStage')
            : t('toastFailedCreate')
        );
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    toast.success(deal ? t('toastUpdated') : t('toastCreated'));
    onOpenChange(false);
    onSaved();
  }

  async function handleStatusChange(status: DealStatus) {
    if (!deal) return;
    if (status === 'lost') {
      const lostStage = stages.find((stage) => stage.is_lost_stage);
      if (lostStage) setLossTarget(lostStage.id);
      return;
    }
    if (
      status === 'open' &&
      stages.find((stage) => stage.id === deal.stage_id)?.is_lost_stage
    ) {
      const initial = initialDealStage(stages);
      if (!initial) {
        toast.error(lossT('noNormalStage'));
        return;
      }
      setStatusAction(status);
      try {
        await requestDealStageMove(deal.id, initial.id);
        toast.success(t('toastReopened'));
        onOpenChange(false);
        onSaved();
      } catch {
        toast.error(t('toastFailedStatus'));
      } finally {
        setStatusAction(null);
      }
      return;
    }
    setStatusAction(status);
    const { error } = await supabase
      .from('deals')
      .update({ status })
      .eq('id', deal.id);
    setStatusAction(null);
    if (error) {
      toast.error(t('toastFailedStatus'));
      return;
    }
    toast.success(status === 'won' ? t('toastMarkedWon') : t('toastReopened'));
    onOpenChange(false);
    onSaved();
  }

  async function handleDelete() {
    if (!deal) return;
    setDeleting(true);
    const { error } = await supabase.from('deals').delete().eq('id', deal.id);
    setDeleting(false);
    if (error) {
      toast.error(t('toastFailedDelete'));
      return;
    }
    toast.success(t('toastDeleted'));
    setConfirmDelete(false);
    onOpenChange(false);
    onSaved();
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="bg-popover border-border text-popover-foreground w-full p-0 sm:max-w-lg"
        >
          <div className="flex h-full flex-col">
            <SheetHeader className="border-border/50 border-b p-4">
              <SheetTitle className="text-popover-foreground">
                {deal ? t('editDeal') : t('newDeal')}
              </SheetTitle>
              {contactId && (
                <p className="text-muted-foreground text-sm">
                  {contacts.find((contact) => contact.id === contactId)?.name ||
                    (deal?.contact_id === contactId ? deal.contact?.name : '')}
                </p>
              )}
            </SheetHeader>

            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t('contact')}</Label>
                <select
                  value={contactId}
                  onChange={(e) => setContactId(e.target.value)}
                  className="border-border bg-muted text-foreground focus:border-primary focus:ring-primary h-9 w-full rounded-lg border px-2.5 text-sm outline-none focus:ring-1"
                >
                  <option value="">{t('selectContact')}</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || c.phone}
                    </option>
                  ))}
                </select>

                {linkedConversation && (
                  <Link
                    href="/inbox"
                    className="bg-primary/10 text-primary hover:bg-primary/20 mt-1 inline-flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-xs"
                  >
                    <MessageSquare className="h-3 w-3" />
                    {t('linkToConversation')}
                  </Link>
                )}
              </div>

              <MetaAdsAttributionCard
                attribution={currentMetaAttributionSelection.attribution}
                loading={loadingMetaAttribution}
                context={currentMetaAttributionSelection.source ?? 'contact'}
              />

              <div className="grid grid-cols-[1fr_110px] gap-3">
                <div className="grid gap-2">
                  <Label className="text-muted-foreground">{t('value')}</Label>
                  <div className="relative">
                    <DollarSign className="text-muted-foreground absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2" />
                    <Input
                      type="number"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      placeholder="0"
                      className="border-border bg-muted text-foreground pl-7"
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label className="text-muted-foreground">
                    {t('currency')}
                  </Label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="border-border bg-muted text-foreground focus:border-primary h-9 w-full rounded-lg border px-2.5 text-sm outline-none"
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid gap-2">
                <Label className="text-muted-foreground">
                  {t('expectedCloseDate')}
                </Label>
                <Input
                  type="date"
                  value={expectedCloseDate}
                  onChange={(e) => setExpectedCloseDate(e.target.value)}
                  className="border-border bg-muted text-foreground"
                />
              </div>

              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t('stage')}</Label>
                {deal ? (
                  <select
                    value={stageId}
                    onChange={(e) => {
                      const target = stages.find(
                        (stage) => stage.id === e.target.value
                      );
                      if (target?.is_lost_stage && target.id !== deal.stage_id)
                        setLossTarget(target.id);
                      else setStageId(e.target.value);
                    }}
                    className="border-border bg-muted text-foreground focus:border-primary h-9 w-full rounded-lg border px-2.5 text-sm outline-none"
                  >
                    {sortDealStages(stages).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.is_lost_stage ? lossT('stage') : s.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    {initialDealStage(stages)?.name || lossT('noNormalStage')}
                  </p>
                )}
              </div>
              {deal &&
                stages.find((stage) => stage.id === stageId)?.is_lost_stage && (
                  <LostReasonFields
                    reason={lostReason}
                    notes={lostReasonNotes}
                    onReasonChange={setLostReason}
                    onNotesChange={setLostReasonNotes}
                  />
                )}

              <div className="grid gap-2">
                <Label className="text-muted-foreground">
                  {t('assignedTo')}
                </Label>
                <select
                  value={assignedTo}
                  onChange={(e) => setAssignedTo(e.target.value)}
                  className="border-border bg-muted text-foreground focus:border-primary h-9 w-full rounded-lg border px-2.5 text-sm outline-none"
                >
                  <option value="">{t('unassigned')}</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name || p.email}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t('notes')}</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t('notesPlaceholder')}
                  className="border-border bg-muted text-foreground min-h-[100px]"
                />
              </div>

              {deal && (
                <div className="border-border bg-muted/50 space-y-2 rounded-lg border p-3">
                  <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                    {t('status')}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      onClick={() => handleStatusChange('won')}
                      disabled={
                        !!statusAction ||
                        deal.status === 'won' ||
                        deal.status === 'lost'
                      }
                      className="bg-primary text-primary-foreground hover:bg-primary/90 flex-1 disabled:opacity-50"
                    >
                      {statusAction === 'won' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Check className="mr-1 h-4 w-4" />
                          {t('markAsWon')}
                        </>
                      )}
                    </Button>
                    <Button
                      type="button"
                      onClick={() => handleStatusChange('lost')}
                      disabled={!!statusAction || deal.status === 'lost'}
                      className="flex-1 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {statusAction === 'lost' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <X className="mr-1 h-4 w-4" />
                          {t('markAsLost')}
                        </>
                      )}
                    </Button>
                  </div>
                  {deal.status && deal.status !== 'open' && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => handleStatusChange('open')}
                      disabled={!!statusAction}
                      className="text-muted-foreground hover:text-foreground w-full"
                    >
                      {t('reopenDeal')}
                    </Button>
                  )}
                </div>
              )}
            </div>

            <div className="border-border/50 bg-popover/80 border-t p-4">
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  className="border-border text-muted-foreground hover:bg-muted flex-1 bg-transparent"
                >
                  {t('cancel')}
                </Button>
                <Button
                  onClick={() => handleSave()}
                  disabled={saving || !contactId || !stageId}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 flex-1"
                >
                  {saving
                    ? t('saving')
                    : deal
                      ? t('saveChanges')
                      : t('createDeal')}
                </Button>
              </div>

              {deal &&
                (confirmDelete ? (
                  <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs">
                    <span className="text-red-300">{t('deletePrompt')}</span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        disabled={deleting}
                        className="text-muted-foreground hover:bg-muted rounded px-2 py-1"
                      >
                        {t('cancel')}
                      </button>
                      <button
                        type="button"
                        onClick={handleDelete}
                        disabled={deleting}
                        className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        {deleting ? t('deleting') : t('confirm')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="mt-3 flex w-full items-center justify-center gap-1 text-xs text-red-400 hover:text-red-300"
                  >
                    <Trash2 className="h-3 w-3" />
                    {t('deleteDeal')}
                  </button>
                ))}
            </div>
          </div>
        </SheetContent>
      </Sheet>
      {open && lossTarget && (
        <LostReasonDialog
          onCancel={() => setLossTarget(null)}
          onConfirm={async (loss) => {
            await handleSave(loss, lossTarget);
            setLossTarget(null);
          }}
        />
      )}
    </>
  );
}

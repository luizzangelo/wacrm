'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import type { Contact, Deal, ContactNote, PipelineStage, Tag } from '@/types';
import type { LossDetails } from '@/lib/deals/lifecycle';
import { requestDealStageMove } from '@/lib/deals/stage-client';
import { addContactTag, deleteContactTag } from '@/lib/contacts/tag-api';
import { operationalErrorFields } from '@/lib/security/operational-log';
import {
  Phone,
  Mail,
  Copy,
  Check,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Plus,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LostReasonDialog } from '@/components/pipelines/lost-reason-dialog';
import { ContactTaskList } from '@/components/tasks/contact-task-list';
import { format } from 'date-fns';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

interface ContactSidebarProps {
  contact: Contact | null;
  conversationId?: string | null;
  onTagsChange?: (tags: Tag[]) => void;
}

export function ContactSidebar({
  contact,
  conversationId,
  onTagsChange,
}: ContactSidebarProps) {
  const tSidebar = useTranslations('Inbox.sidebar');
  const tThread = useTranslations('Inbox.messageThread');
  const lossT = useTranslations('Pipelines.loss');

  const { accountId, canSendMessages } = useAuth();
  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [updatingTagIds, setUpdatingTagIds] = useState<Set<string>>(new Set());
  const [movingDealId, setMovingDealId] = useState<string | null>(null);
  const [pendingLoss, setPendingLoss] = useState<{
    deal: Deal;
    stage: PipelineStage;
  } | null>(null);
  const [newNote, setNewNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    // Fetch all account-scoped sidebar data in parallel. RLS remains the
    // final tenant boundary; account_id also keeps the tag query explicit.
    const [dealsRes, notesRes, tagsRes, availableTagsRes] = await Promise.all([
      supabase
        .from('deals')
        .select('*, stage:pipeline_stages(*)')
        .eq('contact_id', contact.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('contact_notes')
        .select('*')
        .eq('contact_id', contact.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('contact_tags')
        .select('id, tag_id, tags(*)')
        .eq('contact_id', contact.id),
      accountId
        ? supabase
            .from('tags')
            .select('*')
            .eq('account_id', accountId)
            .order('name')
        : Promise.resolve({ data: [] as Tag[], error: null }),
    ]);

    if (dealsRes.data) setDeals(dealsRes.data);
    if (notesRes.data) setNotes(notesRes.data);
    if (availableTagsRes.data) setAvailableTags(availableTagsRes.data);
    if (tagsRes.data) {
      const mapped = tagsRes.data
        .filter((ct: Record<string, unknown>) => ct.tags)
        .map((ct: Record<string, unknown>) => ({
          ...(ct.tags as Tag),
          contact_tag_id: ct.id as string,
        }));
      setTags(mapped);
    }

    const pipelineIds = Array.from(
      new Set((dealsRes.data ?? []).map((deal: Deal) => deal.pipeline_id))
    );
    if (pipelineIds.length === 0) {
      setStages([]);
    } else {
      const { data: stageRows, error: stageError } = await supabase
        .from('pipeline_stages')
        .select('*')
        .in('pipeline_id', pipelineIds)
        .order('position');
      if (stageError) {
        console.error(
          '[ContactSidebar] load stages failed',
          operationalErrorFields(stageError)
        );
      } else {
        setStages(stageRows ?? []);
      }
    }
  }, [contact, accountId]);

  useEffect(() => {
    fetchContactData();
  }, [fetchContactData]);

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Dep is the whole `contact` object (not `contact?.phone`) so the
    // React Compiler's inference agrees with the manual dep list —
    // fixes the `preserve-manual-memoization` lint error.
  }, [contact]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    if (!accountId) return;
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    const { data, error } = await supabase
      .from('contact_notes')
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: user?.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote('');
    }
    setAddingNote(false);
  }, [contact, newNote, accountId]);

  const publishTags = useCallback(
    (next: (Tag & { contact_tag_id: string })[]) => {
      setTags(next);
      onTagsChange?.(
        next.map((tag) => ({
          account_id: tag.account_id,
          id: tag.id,
          user_id: tag.user_id,
          name: tag.name,
          color: tag.color,
          standard_stage_key: tag.standard_stage_key,
          created_at: tag.created_at,
        }))
      );
    },
    [onTagsChange]
  );

  const handleTagToggle = useCallback(
    async (tag: Tag, checked: boolean) => {
      if (!contact || !canSendMessages || updatingTagIds.has(tag.id)) return;
      setUpdatingTagIds((current) => new Set(current).add(tag.id));
      try {
        if (checked) {
          await addContactTag(contact.id, tag.id);
          if (!tags.some((item) => item.id === tag.id)) {
            publishTags([...tags, { ...tag, contact_tag_id: tag.id }]);
          }
        } else {
          await deleteContactTag(contact.id, tag.id);
          publishTags(tags.filter((item) => item.id !== tag.id));
        }
      } catch (error) {
        console.error(
          '[ContactSidebar] update tag failed',
          operationalErrorFields(error)
        );
        toast.error(tSidebar('tagUpdateError'));
      } finally {
        setUpdatingTagIds((current) => {
          const next = new Set(current);
          next.delete(tag.id);
          return next;
        });
      }
    },
    [canSendMessages, contact, publishTags, tSidebar, tags, updatingTagIds]
  );

  const moveDeal = useCallback(
    async (deal: Deal, stage: PipelineStage, loss?: LossDetails) => {
      setMovingDealId(deal.id);
      try {
        await requestDealStageMove(deal.id, stage.id, undefined, loss);
        await fetchContactData();
        toast.success(tSidebar('stageUpdated'));
      } catch (error) {
        console.error(
          '[ContactSidebar] move deal failed',
          operationalErrorFields(error)
        );
        toast.error(tSidebar('stageUpdateError'));
      } finally {
        setMovingDealId(null);
      }
    },
    [fetchContactData, tSidebar]
  );

  const handleStageChange = useCallback(
    (deal: Deal, stageId: string | null) => {
      if (!stageId || stageId === deal.stage_id || !canSendMessages) return;
      const stage = stages.find(
        (candidate) =>
          candidate.id === stageId && candidate.pipeline_id === deal.pipeline_id
      );
      if (!stage) return;
      if (stage.is_lost_stage) {
        setPendingLoss({ deal, stage });
        return;
      }
      void moveDeal(deal, stage);
    },
    [canSendMessages, moveDeal, stages]
  );

  if (!contact) {
    return (
      <div className="border-border bg-card flex h-full w-70 items-center justify-center border-l">
        <p className="text-muted-foreground text-sm">
          {tThread('selectConversation')}
        </p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className="border-border bg-card flex h-full w-70 flex-col border-l">
      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div className="bg-muted text-foreground flex h-16 w-16 items-center justify-center rounded-full text-lg font-semibold">
              {contact.avatar_url ? (
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <h3 className="text-foreground mt-3 text-sm font-semibold">
              {displayName}
            </h3>
            {contact.company && (
              <p className="text-muted-foreground text-xs">{contact.company}</p>
            )}
          </div>

          {/* Phone */}
          <div className="mt-4 space-y-2">
            <button
              onClick={handleCopyPhone}
              className="text-muted-foreground hover:bg-muted flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors"
            >
              <Phone className="text-muted-foreground h-4 w-4" />
              <span className="flex-1 text-left">{contact.phone}</span>
              {copied ? (
                <Check className="text-primary h-3 w-3" />
              ) : (
                <Copy className="text-muted-foreground h-3 w-3" />
              )}
            </button>

            {contact.email && (
              <div className="text-muted-foreground flex items-center gap-2 rounded-lg px-3 py-2 text-sm">
                <Mail className="text-muted-foreground h-4 w-4" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="border-border my-4 border-t" />

          {/* Tags */}
          <div>
            <div className="text-muted-foreground flex items-center gap-2 px-1 text-xs font-medium tracking-wider uppercase">
              <TagIcon className="h-3 w-3" />
              {tSidebar('tags')}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.length === 0 ? (
                <p className="text-muted-foreground px-1 text-xs">
                  {tSidebar('noTags')}
                </p>
              ) : (
                tags.map((tag) => (
                  <span
                    key={tag.contact_tag_id}
                    className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                    }}
                  >
                    {tag.name}
                  </span>
                ))
              )}
            </div>
            {availableTags.length > 0 && (
              <Popover>
                <PopoverTrigger
                  disabled={!canSendMessages}
                  className="border-border bg-background text-muted-foreground hover:bg-muted mt-2 flex h-8 w-full items-center justify-between rounded-lg border px-2.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span>{tSidebar('selectTags')}</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </PopoverTrigger>
                <PopoverContent align="end" className="w-60">
                  <p className="text-foreground px-1 text-xs font-medium">
                    {tSidebar('selectTags')}
                  </p>
                  <div className="max-h-56 space-y-1 overflow-y-auto">
                    {availableTags.map((tag) => {
                      const checked = tags.some((item) => item.id === tag.id);
                      return (
                        <label
                          key={tag.id}
                          className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5"
                        >
                          <Checkbox
                            checked={checked}
                            disabled={updatingTagIds.has(tag.id)}
                            onCheckedChange={(value) =>
                              void handleTagToggle(tag, value === true)
                            }
                          />
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: tag.color }}
                          />
                          <span className="truncate text-xs">{tag.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>

          {/* Divider */}
          <div className="border-border my-4 border-t" />

          {/* Active Deals */}
          <div>
            <div className="text-muted-foreground flex items-center gap-2 px-1 text-xs font-medium tracking-wider uppercase">
              <DollarSign className="h-3 w-3" />
              {tSidebar('deals')}
            </div>
            <div className="mt-2 space-y-2">
              {deals.length === 0 ? (
                <p className="text-muted-foreground px-1 text-xs">
                  {tSidebar('noDeals')}
                </p>
              ) : (
                deals.map((deal) => (
                  <div key={deal.id} className="bg-muted rounded-lg px-3 py-2">
                    <p className="text-foreground text-sm font-medium">
                      {contact.name}
                    </p>
                    <div className="text-muted-foreground mt-1 flex items-center justify-between gap-2 text-xs">
                      <span>
                        {deal.currency ?? '$'}
                        {deal.value.toLocaleString()}
                      </span>
                      {deal.stage && (
                        <Select
                          value={deal.stage_id}
                          onValueChange={(value) =>
                            handleStageChange(deal, value)
                          }
                          disabled={
                            !canSendMessages || movingDealId === deal.id
                          }
                        >
                          <SelectTrigger
                            size="sm"
                            aria-label={tSidebar('dealStage')}
                            className="bg-background h-6 max-w-36 border-0 px-2 text-[10px] shadow-none"
                          >
                            <SelectValue>
                              {deal.stage.is_lost_stage
                                ? lossT('stage')
                                : deal.stage.name}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent align="end">
                            {stages
                              .filter(
                                (stage) =>
                                  stage.pipeline_id === deal.pipeline_id
                              )
                              .map((stage) => (
                                <SelectItem key={stage.id} value={stage.id}>
                                  <span
                                    className="h-2 w-2 rounded-full"
                                    style={{ backgroundColor: stage.color }}
                                  />
                                  {stage.is_lost_stage
                                    ? lossT('stage')
                                    : stage.name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="border-border my-4 border-t" />

          {/* Notes */}
          <div>
            <div className="text-muted-foreground flex items-center gap-2 px-1 text-xs font-medium tracking-wider uppercase">
              <StickyNote className="h-3 w-3" />
              {tSidebar('notes')}
            </div>
            <div className="mt-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder={tSidebar('addNotePlaceholder')}
                  rows={2}
                  className="border-border bg-muted text-foreground placeholder-muted-foreground focus:border-primary/50 flex-1 resize-none rounded-lg border px-3 py-2 text-xs outline-none"
                />
                <Button
                  size="sm"
                  className="bg-primary hover:bg-primary/90 h-auto px-2"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                {notes.map((note) => (
                  <div key={note.id} className="bg-muted rounded-lg px-3 py-2">
                    <p className="text-muted-foreground text-xs whitespace-pre-wrap">
                      {note.note_text}
                    </p>
                    <p className="text-muted-foreground mt-1 text-[10px]">
                      {format(new Date(note.created_at), 'MMM d, yyyy HH:mm')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="border-border my-4 border-t" />

          <ContactTaskList
            contactId={contact.id}
            conversationId={conversationId}
          />
        </div>
      </ScrollArea>
      {pendingLoss && (
        <LostReasonDialog
          onCancel={() => setPendingLoss(null)}
          onConfirm={async (loss) => {
            const pending = pendingLoss;
            setPendingLoss(null);
            await moveDeal(pending.deal, pending.stage, loss);
          }}
        />
      )}
    </div>
  );
}

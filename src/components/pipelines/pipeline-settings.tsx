'use client';

import { useEffect, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { createClient } from '@/lib/supabase/client';
import type { Pipeline, PipelineStage } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  META_CONVERSION_SELECT_OPTIONS,
  buildNewPipelineStageInsert,
  buildPipelineStageUpsertRows,
  duplicateMetaConversionMessageKey,
  findDuplicateMetaConversionEvent,
  getMetaConversionEventFromError,
  isMetaConversionUniqueViolation,
  metaConversionEventToSelectValue,
  preparePipelineStages,
  selectValueToMetaConversionEvent,
  type EditablePipelineStage,
} from '@/lib/meta-conversions/pipeline-stage-mapping';
import { Trash2, Plus, GripVertical, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

const STAGE_COLORS = [
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#f43f5e',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#06b6d4',
];

interface PipelineSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipeline: Pipeline;
  stages: PipelineStage[];
  onPipelinesChanged: () => void;
  onStagesChanged: () => void;
  onCreateNewPipeline: () => void;
}

export function PipelineSettings({
  open,
  onOpenChange,
  pipeline,
  stages,
  onPipelinesChanged,
  onStagesChanged,
  onCreateNewPipeline,
}: PipelineSettingsProps) {
  const t = useTranslations('Pipelines.settings');
  const supabase = createClient();

  const [name, setName] = useState(pipeline.name);
  const [localStages, setLocalStages] = useState<EditablePipelineStage[]>(() =>
    preparePipelineStages(stages)
  );
  const [newStageName, setNewStageName] = useState('');
  const [newStageColor, setNewStageColor] = useState(STAGE_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Reset form state when the dialog opens or its prop inputs change
  // — legitimate prop-driven sync.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setName(pipeline.name);
    setLocalStages(preparePipelineStages(stages));
    setShowDeleteConfirm(false);
  }, [open, pipeline, stages]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  function handleReorder(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = localStages.findIndex((s) => s.id === active.id);
    const newIndex = localStages.findIndex((s) => s.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    if (
      localStages[oldIndex].is_lost_stage ||
      localStages[newIndex].is_lost_stage
    )
      return;
    setLocalStages(arrayMove(localStages, oldIndex, newIndex));
  }

  async function handleSave() {
    const duplicateEvent = findDuplicateMetaConversionEvent(localStages);
    if (duplicateEvent) {
      toast.error(t(duplicateMetaConversionMessageKey(duplicateEvent)));
      return;
    }

    setSaving(true);

    // One upsert for all stages — batches N stage writes into a single
    // round-trip. Previous implementation did N sequential UPDATEs which
    // latency-scaled linearly with stage count.
    const stageRows = buildPipelineStageUpsertRows(localStages);

    const [renameRes, stagesRes] = await Promise.all([
      supabase
        .from('pipelines')
        .update({ name: name.trim() })
        .eq('id', pipeline.id),
      supabase.from('pipeline_stages').upsert(stageRows, { onConflict: 'id' }),
    ]);

    setSaving(false);

    if (stagesRes.error && isMetaConversionUniqueViolation(stagesRes.error)) {
      const event = getMetaConversionEventFromError(stagesRes.error);
      toast.error(
        event
          ? t(duplicateMetaConversionMessageKey(event))
          : t('metaConversionDuplicateGeneric')
      );
      return;
    }

    if (renameRes.error || stagesRes.error) {
      toast.error(t('toastFailedSave'));
      return;
    }

    onOpenChange(false);
    onPipelinesChanged();
    onStagesChanged();
    toast.success(t('toastSaved'));
  }

  async function handleAddStage() {
    const trimmed = newStageName.trim();
    if (!trimmed) return;
    const { data, error } = await supabase
      .from('pipeline_stages')
      .insert(
        buildNewPipelineStageInsert(
          pipeline.id,
          trimmed,
          newStageColor,
          localStages.filter((stage) => !stage.is_lost_stage).length
        )
      )
      .select()
      .single();
    if (error || !data) {
      toast.error(t('toastFailedAddStage'));
      return;
    }
    setLocalStages(
      preparePipelineStages([
        ...localStages,
        { ...(data as PipelineStage), meta_conversion_event: null },
      ])
    );
    setNewStageName('');
    setNewStageColor(
      STAGE_COLORS[(localStages.length + 1) % STAGE_COLORS.length]
    );
  }

  async function handleRemoveStage(stageId: string) {
    // Refuse to delete if deals still reference the stage (FK would fail).
    const { count } = await supabase
      .from('deals')
      .select('id', { count: 'exact', head: true })
      .eq('stage_id', stageId);
    if (count && count > 0) {
      toast.error(t('toastMoveOrDeleteDeals'));
      return;
    }
    const { error } = await supabase
      .from('pipeline_stages')
      .delete()
      .eq('id', stageId);
    if (error) {
      toast.error(t('toastFailedDeleteStage'));
      return;
    }
    setLocalStages(localStages.filter((s) => s.id !== stageId));
  }

  async function handleDeletePipeline() {
    setDeleting(true);
    // ON DELETE CASCADE handles deals + stages.
    const { error } = await supabase
      .from('pipelines')
      .delete()
      .eq('id', pipeline.id);
    setDeleting(false);
    if (error) {
      toast.error(t('toastFailedDeletePipeline'));
      return;
    }
    onOpenChange(false);
    onPipelinesChanged();
    toast.success(t('toastDeleted'));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {t('managePipeline')}
          </DialogTitle>
        </DialogHeader>

        {showDeleteConfirm ? (
          <div className="py-4">
            <div className="flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
              <AlertTriangle className="h-5 w-5 shrink-0 text-red-400" />
              <div>
                <p className="text-sm font-medium text-red-400">
                  {t('deletePipeline')}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {t('deletePipelineDesc')}
                </p>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setShowDeleteConfirm(false)}
                className="border-border text-muted-foreground hover:bg-muted bg-transparent"
              >
                {t('cancel')}
              </Button>
              <Button
                onClick={handleDeletePipeline}
                disabled={deleting}
                className="bg-red-600 text-white hover:bg-red-700"
              >
                {deleting ? t('deleting') : t('deletePipelineBtn')}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label className="text-muted-foreground">
                  {t('pipelineName')}
                </Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="border-border bg-muted text-foreground"
                />
              </div>

              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t('stages')}</Label>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleReorder}
                >
                  <SortableContext
                    items={localStages.map((s) => s.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-2">
                      {localStages.map((stage, index) => (
                        <SortableStageRow
                          key={stage.id}
                          stage={stage}
                          onNameChange={(v) => {
                            const updated = [...localStages];
                            updated[index] = { ...updated[index], name: v };
                            setLocalStages(updated);
                          }}
                          onColorChange={(v) => {
                            const updated = [...localStages];
                            updated[index] = { ...updated[index], color: v };
                            setLocalStages(updated);
                          }}
                          onMetaConversionEventChange={(value) => {
                            const updated = [...localStages];
                            updated[index] = {
                              ...updated[index],
                              meta_conversion_event: value,
                            };
                            setLocalStages(updated);
                          }}
                          onRemove={() => handleRemoveStage(stage.id)}
                          colors={STAGE_COLORS}
                          t={t}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>

                {/* Add new stage */}
                <div className="mt-1 flex flex-wrap gap-1">
                  {STAGE_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setNewStageColor(color)}
                      className="h-5 w-5 rounded-full border-2 transition-transform hover:scale-110"
                      style={{
                        backgroundColor: color,
                        borderColor:
                          newStageColor === color
                            ? 'var(--foreground)'
                            : 'transparent',
                      }}
                      aria-label={`Pick color ${color}`}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    value={newStageName}
                    onChange={(e) => setNewStageName(e.target.value)}
                    placeholder={t('newStageNamePlaceholder')}
                    className="border-border bg-muted text-foreground text-sm"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddStage();
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAddStage}
                    disabled={!newStageName.trim()}
                    className="border-border text-muted-foreground hover:bg-muted shrink-0 bg-transparent"
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    {t('add')}
                  </Button>
                </div>
              </div>

              <Button
                variant="outline"
                onClick={onCreateNewPipeline}
                className="border-border text-muted-foreground hover:bg-muted w-full bg-transparent"
              >
                <Plus className="mr-1 h-3 w-3" />
                {t('createNewPipeline')}
              </Button>
            </div>

            <DialogFooter className="border-border bg-popover/50">
              <Button
                onClick={() => setShowDeleteConfirm(true)}
                className="mr-auto bg-red-600 text-white hover:bg-red-700"
              >
                {t('deletePipeline')}
              </Button>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="border-border text-muted-foreground hover:bg-muted bg-transparent"
              >
                {t('cancel')}
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !name.trim()}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? t('saving') : t('saveChanges')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SortableStageRow({
  stage,
  onNameChange,
  onColorChange,
  onMetaConversionEventChange,
  onRemove,
  colors,
  t,
}: {
  stage: EditablePipelineStage;
  onNameChange: (v: string) => void;
  onColorChange: (v: string) => void;
  onMetaConversionEventChange: (
    value: EditablePipelineStage['meta_conversion_event']
  ) => void;
  onRemove: () => void;
  colors: string[];
  t: (key: string) => string;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: stage.id, disabled: stage.is_lost_stage });

  const lossT = useTranslations('Pipelines.loss');

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="border-border bg-muted rounded-lg border p-2"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="text-muted-foreground hover:text-foreground cursor-grab touch-none active:cursor-grabbing"
          aria-label={t('dragToReorder')}
          disabled={stage.is_lost_stage}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <ColorSwatch
          value={stage.color}
          onChange={onColorChange}
          colors={colors}
          t={t}
        />
        <Input
          value={stage.is_lost_stage ? lossT('stage') : stage.name}
          disabled={stage.is_lost_stage}
          onChange={(e) => onNameChange(e.target.value)}
          className="text-foreground focus:border-border h-7 flex-1 border-transparent bg-transparent text-sm"
        />
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onRemove}
          disabled={stage.is_lost_stage}
          className="text-muted-foreground hover:text-red-400"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      <div className="mt-2 grid gap-1 pl-6">
        <Label
          htmlFor={`meta-conversion-${stage.id}`}
          className="text-muted-foreground text-xs"
        >
          {t('metaConversionLabel')}
        </Label>
        <Select
          disabled={stage.is_lost_stage}
          value={metaConversionEventToSelectValue(stage.meta_conversion_event)}
          onValueChange={(value) =>
            onMetaConversionEventChange(
              selectValueToMetaConversionEvent(String(value))
            )
          }
        >
          <SelectTrigger
            id={`meta-conversion-${stage.id}`}
            className="bg-background w-full"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {META_CONVERSION_SELECT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {t(option.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">
          {stage.is_lost_stage
            ? lossT('unmappedHelp')
            : t('metaConversionHelp')}
        </p>
      </div>
    </div>
  );
}

function ColorSwatch({
  value,
  onChange,
  colors,
  t,
}: {
  value: string;
  onChange: (v: string) => void;
  colors: string[];
  t: (key: string) => string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="border-border h-4 w-4 rounded-full border"
        style={{ backgroundColor: value }}
        aria-label={t('changeColor')}
      />
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="border-border bg-popover absolute top-6 left-0 z-20 flex w-36 flex-wrap gap-1 rounded-lg border p-2 shadow-lg">
            {colors.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
                className="h-5 w-5 rounded-full border-2 transition-transform hover:scale-110"
                style={{
                  backgroundColor: c,
                  borderColor:
                    c === value ? 'var(--foreground)' : 'transparent',
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

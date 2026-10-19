'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDays, addHours } from 'date-fns';
import {
  CalendarCheck,
  Clock,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import { taskDateLabel, taskTimingState } from '@/lib/tasks/time';
import type { AccountMember, Task } from '@/types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TaskEditor } from './task-editor';

export function ContactTaskList({
  contactId,
  conversationId,
}: {
  contactId: string;
  conversationId?: string | null;
}) {
  const { accountId, user, canSendMessages } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<AccountMember[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const [taskResult, memberResult] = await Promise.all([
      supabase
        .from('tasks')
        .select('*, task_type:task_types(*)')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .order('completed_at', { ascending: true, nullsFirst: true })
        .order('due_at'),
      fetch('/api/account/members').then((response) => response.json()),
    ]);
    if (taskResult.error) {
      toast.error('Não foi possível carregar as tarefas.');
      return;
    }
    setTasks((taskResult.data ?? []) as Task[]);
    setMembers((memberResult.members ?? []) as AccountMember[]);
  }, [accountId, contactId]);

  useEffect(() => {
    // Initial remote synchronization; state updates happen after the request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    if (!accountId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`contact-tasks:${contactId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tasks',
          filter: `account_id=eq.${accountId}`,
        },
        () => void load()
      )
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [accountId, contactId, load]);

  const memberNames = useMemo(
    () =>
      new Map(
        members.map((member) => [member.user_id, member.full_name || 'Usuário'])
      ),
    [members]
  );

  async function patchTask(id: string, values: Record<string, unknown>) {
    if (!accountId) return;
    const { error } = await createClient()
      .from('tasks')
      .update(values)
      .eq('id', id)
      .eq('account_id', accountId);
    if (error) toast.error('Não foi possível atualizar a tarefa.');
    else await load();
  }

  async function removeTask(id: string) {
    if (!accountId || !window.confirm('Excluir esta tarefa?')) return;
    const { error } = await createClient()
      .from('tasks')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId);
    if (error) toast.error('Não foi possível excluir a tarefa.');
    else await load();
  }

  return (
    <div>
      <div className="flex items-center justify-between px-1">
        <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wider uppercase">
          <CalendarCheck className="h-3 w-3" />
          Tarefas
        </div>
        <span className="text-muted-foreground text-[10px]">
          {tasks.filter((task) => !task.completed_at).length}
        </span>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="mt-2 w-full justify-start text-xs"
        disabled={!canSendMessages}
        onClick={() => {
          setEditingTask(null);
          setEditorOpen(true);
        }}
      >
        <Plus className="h-3.5 w-3.5" /> Adicionar tarefa
      </Button>

      <div className="mt-2 space-y-2">
        {tasks.length === 0 ? (
          <p className="text-muted-foreground px-1 py-2 text-xs">
            Nenhuma tarefa para este contato.
          </p>
        ) : (
          tasks.map((task) => {
            const timing = taskTimingState(task.due_at);
            return (
              <div
                key={task.id}
                className={cn(
                  'border-border bg-background rounded-lg border p-2.5',
                  task.completed_at && 'opacity-60'
                )}
              >
                <div className="flex items-start gap-2">
                  <Checkbox
                    className="mt-0.5"
                    checked={Boolean(task.completed_at)}
                    disabled={!canSendMessages}
                    onCheckedChange={(checked) =>
                      void patchTask(task.id, {
                        completed_at: checked ? new Date().toISOString() : null,
                        completed_by: checked ? user?.id : null,
                      })
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        'text-foreground text-xs font-medium',
                        task.completed_at && 'line-through'
                      )}
                    >
                      {task.text}
                    </p>
                    <p className="text-muted-foreground mt-1 text-[10px]">
                      {task.task_type?.name ?? 'Tarefa'} ·{' '}
                      {memberNames.get(task.assigned_to) ?? 'Responsável'}
                    </p>
                    <p
                      className={cn(
                        'mt-1 flex items-center gap-1 text-[10px]',
                        timing === 'overdue' && !task.completed_at
                          ? 'text-red-500'
                          : timing === 'today' && !task.completed_at
                            ? 'text-amber-500'
                            : 'text-muted-foreground'
                      )}
                    >
                      <Clock className="h-3 w-3" />{' '}
                      {taskDateLabel(task.due_at, task.all_day)}
                      {task.all_day ? ' · Dia todo' : ''}
                    </p>
                  </div>
                  {canSendMessages && (
                    <DropdownMenu>
                      <DropdownMenuTrigger className="text-muted-foreground hover:bg-muted rounded p-1">
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => {
                            setEditingTask(task);
                            setEditorOpen(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" /> Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            void patchTask(task.id, {
                              due_at: addHours(
                                new Date(task.due_at),
                                1
                              ).toISOString(),
                              all_day: false,
                            })
                          }
                        >
                          Adiar 1 hora
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            void patchTask(task.id, {
                              due_at: addDays(
                                new Date(task.due_at),
                                1
                              ).toISOString(),
                            })
                          }
                        >
                          Adiar para amanhã
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => void removeTask(task.id)}
                        >
                          <Trash2 className="h-4 w-4" /> Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <TaskEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        task={editingTask}
        contactId={contactId}
        conversationId={conversationId}
        onSaved={load}
      />
    </div>
  );
}

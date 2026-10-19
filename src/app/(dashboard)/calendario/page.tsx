'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  addDays,
  addHours,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  LayoutDashboard,
  List,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import {
  taskDateLabel,
  taskTimingState,
  type TaskTimingState,
} from '@/lib/tasks/time';
import type { AccountMember, Task, TaskType } from '@/types';
import { TaskEditor } from '@/components/tasks/task-editor';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type ViewMode = 'kanban' | 'list' | 'calendar';
type CalendarMode = 'day' | 'week' | 'month';

const COLUMNS: Array<{ key: TaskTimingState; label: string; accent: string }> =
  [
    {
      key: 'overdue',
      label: 'Atrasadas',
      accent: 'border-red-500/50 text-red-500',
    },
    {
      key: 'today',
      label: 'Hoje',
      accent: 'border-amber-500/50 text-amber-500',
    },
    {
      key: 'tomorrow',
      label: 'Amanhã',
      accent: 'border-blue-500/50 text-blue-500',
    },
    {
      key: 'week',
      label: 'Esta semana',
      accent: 'border-primary/50 text-primary',
    },
    {
      key: 'future',
      label: 'Próximas',
      accent: 'border-border text-muted-foreground',
    },
  ];

export default function CalendarioPage() {
  const { accountId, user, accountRole, canSendMessages } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [types, setTypes] = useState<TaskType[]>([]);
  const [members, setMembers] = useState<AccountMember[]>([]);
  const [view, setView] = useState<ViewMode>('kanban');
  const [calendarMode, setCalendarMode] = useState<CalendarMode>('month');
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [scope, setScope] = useState('mine');
  const [assignee, setAssignee] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [status, setStatus] = useState('pending');
  const [period, setPeriod] = useState('90');
  const [search, setSearch] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [initialDate, setInitialDate] = useState<Date | undefined>();

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const [taskResult, typeResult, memberResult] = await Promise.all([
      supabase
        .from('tasks')
        .select('*, task_type:task_types(*), contact:contacts(*)')
        .eq('account_id', accountId)
        .order('due_at'),
      supabase
        .from('task_types')
        .select('*')
        .eq('account_id', accountId)
        .order('name'),
      fetch('/api/account/members').then((response) => response.json()),
    ]);
    if (taskResult.error || typeResult.error) {
      toast.error('Não foi possível carregar o calendário.');
      return;
    }
    setTasks((taskResult.data ?? []) as Task[]);
    setTypes((typeResult.data ?? []) as TaskType[]);
    setMembers((memberResult.members ?? []) as AccountMember[]);
  }, [accountId]);

  useEffect(() => {
    // Initial remote synchronization; state updates happen after the request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    if (!accountId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`calendar-tasks:${accountId}`)
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
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [accountId, load]);

  const memberNames = useMemo(
    () =>
      new Map(
        members.map((item) => [item.user_id, item.full_name || 'Usuário'])
      ),
    [members]
  );
  const filtered = useMemo(() => {
    const now = new Date();
    const until = addDays(now, Number(period));
    const needle = search.trim().toLocaleLowerCase('pt-BR');
    return tasks.filter((task) => {
      if (scope === 'mine' && task.assigned_to !== user?.id) return false;
      if (scope === 'overdue' && taskTimingState(task.due_at) !== 'overdue')
        return false;
      if (assignee !== 'all' && task.assigned_to !== assignee) return false;
      if (typeFilter !== 'all' && task.task_type_id !== typeFilter)
        return false;
      if (status === 'pending' && task.completed_at) return false;
      if (status === 'completed' && !task.completed_at) return false;
      if (period !== 'all' && new Date(task.due_at) > until) return false;
      if (
        needle &&
        !`${task.text} ${task.contact?.name ?? ''} ${task.contact?.phone ?? ''}`
          .toLocaleLowerCase('pt-BR')
          .includes(needle)
      )
        return false;
      return true;
    });
  }, [assignee, period, scope, search, status, tasks, typeFilter, user?.id]);

  async function patchTask(id: string, values: Record<string, unknown>) {
    if (!accountId) return;
    if (values.completed_at && user?.id) values.completed_by = user.id;
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

  function openNew(date?: Date) {
    setEditingTask(null);
    setInitialDate(date);
    setEditorOpen(true);
  }
  function openEdit(task: Task) {
    setEditingTask(task);
    setInitialDate(undefined);
    setEditorOpen(true);
  }

  async function dropTask(taskId: string, state: TaskTimingState) {
    if (!taskId) return;
    const base = new Date();
    const due =
      state === 'today'
        ? addHours(base, 1)
        : state === 'tomorrow'
          ? addHours(addDays(base, 1), 1)
          : state === 'week'
            ? endOfWeek(base, { weekStartsOn: 1 })
            : state === 'future'
              ? addDays(base, 7)
              : addHours(base, -1);
    await patchTask(taskId, { due_at: due.toISOString(), all_day: false });
  }

  const isManager = accountRole === 'owner' || accountRole === 'admin';

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h2 className="text-foreground text-2xl font-bold">Calendário</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Organize acompanhamentos e tarefas do comercial.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="border-border bg-card flex rounded-lg border p-1">
            {(
              [
                ['kanban', LayoutDashboard, 'Kanban'],
                ['list', List, 'Lista'],
                ['calendar', CalendarDays, 'Calendário'],
              ] as const
            ).map(([key, Icon, label]) => (
              <Button
                key={key}
                variant={view === key ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setView(key)}
              >
                <Icon className="h-4 w-4" />{' '}
                <span className="hidden sm:inline">{label}</span>
              </Button>
            ))}
          </div>
          <Button onClick={() => openNew()} disabled={!canSendMessages}>
            <Plus className="h-4 w-4" /> Nova tarefa
          </Button>
        </div>
      </div>

      <div className="border-border bg-card grid gap-2 rounded-xl border p-3 md:grid-cols-3 xl:grid-cols-6">
        <div className="relative md:col-span-2 xl:col-span-1">
          <Search className="text-muted-foreground absolute top-2.5 left-3 h-4 w-4" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar tarefa ou contato"
            className="pl-9"
          />
        </div>
        <Select
          value={scope}
          onValueChange={(value) => setScope(value ?? 'mine')}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mine">Minhas tarefas</SelectItem>
            <SelectItem value="overdue">Atrasadas</SelectItem>
            <SelectItem value="all">Todas as tarefas</SelectItem>
          </SelectContent>
        </Select>
        {isManager && (
          <Select
            value={assignee}
            onValueChange={(value) => setAssignee(value ?? 'all')}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Responsável" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos responsáveis</SelectItem>
              {members.map((member) => (
                <SelectItem key={member.user_id} value={member.user_id}>
                  {member.full_name || 'Usuário'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select
          value={typeFilter}
          onValueChange={(value) => setTypeFilter(value ?? 'all')}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            {types.map((type) => (
              <SelectItem key={type.id} value={type.id}>
                {type.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(value) => setStatus(value ?? 'pending')}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pendentes</SelectItem>
            <SelectItem value="completed">Concluídas</SelectItem>
            <SelectItem value="all">Todos os status</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={period}
          onValueChange={(value) => setPeriod(value ?? '90')}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Próximos 7 dias</SelectItem>
            <SelectItem value="30">Próximos 30 dias</SelectItem>
            <SelectItem value="90">Próximos 90 dias</SelectItem>
            <SelectItem value="all">Todo o período</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <p className="text-muted-foreground text-sm">
        {filtered.length} {filtered.length === 1 ? 'tarefa' : 'tarefas'}
      </p>

      {filtered.length === 0 ? (
        <div className="border-border bg-card/50 flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed text-center">
          <CheckCircle2 className="text-primary/70 h-10 w-10" />
          <p className="text-foreground mt-3 font-medium">
            Nenhuma tarefa por aqui
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            Crie uma tarefa para acompanhar seus contatos.
          </p>
          <Button
            className="mt-4"
            variant="outline"
            onClick={() => openNew()}
            disabled={!canSendMessages}
          >
            <Plus className="h-4 w-4" /> Criar tarefa
          </Button>
        </div>
      ) : view === 'kanban' ? (
        <div className="grid items-start gap-3 overflow-x-auto pb-2 xl:grid-cols-5">
          {COLUMNS.map((column) => {
            const columnTasks = filtered.filter(
              (task) =>
                !task.completed_at &&
                taskTimingState(task.due_at) === column.key
            );
            return (
              <section
                key={column.key}
                className={cn(
                  'bg-muted/30 min-w-64 rounded-xl border-t-2 p-3',
                  column.accent
                )}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) =>
                  void dropTask(
                    event.dataTransfer.getData('text/task-id'),
                    column.key
                  )
                }
              >
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{column.label}</h3>
                  <span className="bg-background rounded-full px-2 py-0.5 text-xs">
                    {columnTasks.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {columnTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      memberName={memberNames.get(task.assigned_to)}
                      canEdit={canSendMessages}
                      onPatch={patchTask}
                      onEdit={openEdit}
                      onDelete={removeTask}
                      draggable
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : view === 'list' ? (
        <div className="border-border bg-card overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[850px] text-sm">
            <thead className="border-border bg-muted/40 text-muted-foreground border-b text-left text-xs uppercase">
              <tr>
                <th className="p-3">Concluir</th>
                <th className="p-3">Vencimento</th>
                <th className="p-3">Tipo</th>
                <th className="p-3">Tarefa</th>
                <th className="p-3">Contato</th>
                <th className="p-3">Responsável</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((task) => (
                <TaskTableRow
                  key={task.id}
                  task={task}
                  memberName={memberNames.get(task.assigned_to)}
                  canEdit={canSendMessages}
                  onPatch={patchTask}
                  onEdit={openEdit}
                  onDelete={removeTask}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <CalendarView
          tasks={filtered}
          mode={calendarMode}
          date={calendarDate}
          onMode={setCalendarMode}
          onDate={setCalendarDate}
          onEmptyClick={openNew}
          onTaskClick={openEdit}
        />
      )}

      <TaskEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        task={editingTask}
        initialDate={initialDate}
        allowContactSelection
        onSaved={load}
      />
    </div>
  );
}

function TaskCard({
  task,
  memberName,
  canEdit,
  onPatch,
  onEdit,
  onDelete,
  draggable = false,
}: {
  task: Task;
  memberName?: string;
  canEdit: boolean;
  onPatch: (id: string, values: Record<string, unknown>) => Promise<void>;
  onEdit: (task: Task) => void;
  onDelete: (id: string) => Promise<void>;
  draggable?: boolean;
}) {
  const timing = taskTimingState(task.due_at);
  return (
    <article
      draggable={draggable}
      onDragStart={(event) =>
        event.dataTransfer.setData('text/task-id', task.id)
      }
      className="border-border bg-card text-foreground rounded-lg border p-3 shadow-sm"
    >
      <div className="flex items-start gap-2">
        <Checkbox
          checked={Boolean(task.completed_at)}
          disabled={!canEdit}
          onCheckedChange={(checked) =>
            void onPatch(task.id, {
              completed_at: checked ? new Date().toISOString() : null,
              completed_by: checked ? task.assigned_to : null,
            })
          }
        />
        <div className="min-w-0 flex-1">
          <p className="text-primary text-[11px] font-medium">
            {task.task_type?.name ?? 'Tarefa'}
          </p>
          <p className="mt-1 text-sm font-medium">{task.text}</p>
          {task.contact && (
            <Link
              href={
                task.conversation_id
                  ? `/inbox?c=${task.conversation_id}`
                  : '/contacts'
              }
              className="text-primary mt-2 block truncate text-xs hover:underline"
            >
              {task.contact.name || task.contact.phone}
            </Link>
          )}
          <p
            className={cn(
              'mt-2 flex items-center gap-1 text-xs',
              timing === 'overdue'
                ? 'text-red-500'
                : timing === 'today'
                  ? 'text-amber-500'
                  : 'text-muted-foreground'
            )}
          >
            <Clock className="h-3.5 w-3.5" />{' '}
            {taskDateLabel(task.due_at, task.all_day)}
          </p>
          <div className="text-muted-foreground mt-2 flex items-center gap-1.5 text-xs">
            <Avatar className="h-5 w-5">
              <AvatarFallback className="text-[9px]">
                {memberName?.charAt(0) ?? 'U'}
              </AvatarFallback>
            </Avatar>
            {memberName ?? 'Responsável'}
          </div>
        </div>
        {canEdit && (
          <TaskActions
            task={task}
            onPatch={onPatch}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        )}
      </div>
    </article>
  );
}

function TaskActions({
  task,
  onPatch,
  onEdit,
  onDelete,
}: {
  task: Task;
  onPatch: (id: string, values: Record<string, unknown>) => Promise<void>;
  onEdit: (task: Task) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="text-muted-foreground hover:bg-muted rounded-md p-1">
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onEdit(task)}>
          <Pencil className="h-4 w-4" /> Editar
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            void onPatch(task.id, {
              due_at: addHours(new Date(task.due_at), 1).toISOString(),
              all_day: false,
            })
          }
        >
          Adiar 1 hora
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            void onPatch(task.id, {
              due_at: addDays(new Date(task.due_at), 1).toISOString(),
            })
          }
        >
          Adiar para amanhã
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => void onDelete(task.id)}
        >
          <Trash2 className="h-4 w-4" /> Excluir
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TaskTableRow({
  task,
  memberName,
  canEdit,
  onPatch,
  onEdit,
  onDelete,
}: {
  task: Task;
  memberName?: string;
  canEdit: boolean;
  onPatch: (id: string, values: Record<string, unknown>) => Promise<void>;
  onEdit: (task: Task) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const timing = taskTimingState(task.due_at);
  return (
    <tr className="border-border border-b last:border-0">
      <td className="p-3">
        <Checkbox
          checked={Boolean(task.completed_at)}
          disabled={!canEdit}
          onCheckedChange={(checked) =>
            void onPatch(task.id, {
              completed_at: checked ? new Date().toISOString() : null,
              completed_by: checked ? task.assigned_to : null,
            })
          }
        />
      </td>
      <td
        className={cn(
          'p-3',
          timing === 'overdue' && !task.completed_at
            ? 'text-red-500'
            : timing === 'today' && !task.completed_at
              ? 'text-amber-500'
              : 'text-muted-foreground'
        )}
      >
        {taskDateLabel(task.due_at, task.all_day)}
      </td>
      <td className="p-3">{task.task_type?.name}</td>
      <td
        className={cn(
          'p-3 font-medium',
          task.completed_at && 'text-muted-foreground line-through'
        )}
      >
        {task.text}
      </td>
      <td className="p-3">
        {task.contact ? (
          <Link
            className="text-primary hover:underline"
            href={
              task.conversation_id
                ? `/inbox?c=${task.conversation_id}`
                : '/contacts'
            }
          >
            {task.contact.name || task.contact.phone}
          </Link>
        ) : (
          '—'
        )}
      </td>
      <td className="text-muted-foreground p-3">{memberName ?? 'Usuário'}</td>
      <td className="p-3">
        {canEdit && (
          <TaskActions
            task={task}
            onPatch={onPatch}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        )}
      </td>
    </tr>
  );
}

function CalendarView({
  tasks,
  mode,
  date,
  onMode,
  onDate,
  onEmptyClick,
  onTaskClick,
}: {
  tasks: Task[];
  mode: CalendarMode;
  date: Date;
  onMode: (mode: CalendarMode) => void;
  onDate: (date: Date) => void;
  onEmptyClick: (date: Date) => void;
  onTaskClick: (task: Task) => void;
}) {
  const interval =
    mode === 'day'
      ? { start: date, end: date }
      : mode === 'week'
        ? {
            start: startOfWeek(date, { weekStartsOn: 1 }),
            end: endOfWeek(date, { weekStartsOn: 1 }),
          }
        : {
            start: startOfWeek(startOfMonth(date), { weekStartsOn: 1 }),
            end: endOfWeek(endOfMonth(date), { weekStartsOn: 1 }),
          };
  const days = eachDayOfInterval(interval);
  const step = mode === 'day' ? 1 : mode === 'week' ? 7 : 30;
  return (
    <div className="border-border bg-card rounded-xl border">
      <div className="border-border flex flex-wrap items-center justify-between gap-2 border-b p-3">
        <div className="flex items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => onDate(addDays(date, -step))}
          >
            <ChevronLeft />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => onDate(addDays(date, step))}
          >
            <ChevronRight />
          </Button>
          <strong className="ml-2 capitalize">
            {format(date, mode === 'day' ? "dd 'de' MMMM" : 'MMMM yyyy', {
              locale: ptBR,
            })}
          </strong>
        </div>
        <div className="border-border flex rounded-lg border p-1">
          {(['day', 'week', 'month'] as const).map((item) => (
            <Button
              key={item}
              size="sm"
              variant={mode === item ? 'secondary' : 'ghost'}
              onClick={() => onMode(item)}
            >
              {item === 'day' ? 'Dia' : item === 'week' ? 'Semana' : 'Mês'}
            </Button>
          ))}
        </div>
      </div>
      <div
        className={cn('grid', mode === 'day' ? 'grid-cols-1' : 'grid-cols-7')}
      >
        {days.map((day) => {
          const dayTasks = tasks.filter((task) =>
            isSameDay(new Date(task.due_at), day)
          );
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onEmptyClick(day)}
              className={cn(
                'border-border hover:bg-muted/30 min-h-32 border-r border-b p-2 text-left',
                isSameDay(day, new Date()) && 'bg-primary/5'
              )}
            >
              <span className="text-muted-foreground text-xs font-medium">
                {format(day, mode === 'month' ? 'd' : 'EEE dd', {
                  locale: ptBR,
                })}
              </span>
              <div className="mt-2 space-y-1">
                {dayTasks.slice(0, 5).map((task) => (
                  <span
                    key={task.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      onTaskClick(task);
                    }}
                    className="bg-primary/10 text-primary block truncate rounded px-2 py-1 text-[11px]"
                  >
                    {task.all_day
                      ? ''
                      : `${format(new Date(task.due_at), 'HH:mm')} · `}
                    {task.text}
                  </span>
                ))}
                {dayTasks.length > 5 && (
                  <span className="text-muted-foreground text-[10px]">
                    +{dayTasks.length - 5} tarefas
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

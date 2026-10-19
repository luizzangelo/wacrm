import {
  addDays,
  addHours,
  addMinutes,
  endOfDay,
  endOfWeek,
  format,
  isAfter,
  isBefore,
  isSameDay,
  startOfDay,
} from 'date-fns';

export type TaskTimingState =
  'overdue' | 'today' | 'tomorrow' | 'week' | 'future';

export function taskTimingState(
  dueAt: string,
  now = new Date()
): TaskTimingState {
  const due = new Date(dueAt);
  if (isBefore(due, now)) return 'overdue';
  if (isSameDay(due, now)) return 'today';
  if (isSameDay(due, addDays(now, 1))) return 'tomorrow';
  if (isBefore(due, endOfWeek(now, { weekStartsOn: 1 }))) return 'week';
  return 'future';
}

export function dueAtFromInputs(
  date: string,
  time: string
): {
  due_at: string;
  all_day: boolean;
} {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) throw new Error('invalid_due_date');
  if (!time) {
    return {
      due_at: endOfDay(new Date(year, month - 1, day)).toISOString(),
      all_day: true,
    };
  }
  const [hour, minute] = time.split(':').map(Number);
  return {
    due_at: new Date(year, month - 1, day, hour, minute, 0, 0).toISOString(),
    all_day: false,
  };
}

export function dueInputsFromDate(value: Date) {
  return { date: format(value, 'yyyy-MM-dd'), time: format(value, 'HH:mm') };
}

export const QUICK_DUE_OPTIONS = [
  {
    key: 'after15',
    label: 'Após 15 min',
    resolve: () => addMinutes(new Date(), 15),
  },
  {
    key: 'after30',
    label: 'Após 30 min',
    resolve: () => addMinutes(new Date(), 30),
  },
  { key: 'hour', label: 'Em 1 hora', resolve: () => addHours(new Date(), 1) },
  { key: 'today', label: 'Hoje', resolve: () => addHours(new Date(), 1) },
  { key: 'tomorrow', label: 'Amanhã', resolve: () => addDays(new Date(), 1) },
  {
    key: 'week',
    label: 'Esta semana',
    resolve: () => endOfWeek(new Date(), { weekStartsOn: 1 }),
  },
  { key: 'days7', label: 'Em 7 dias', resolve: () => addDays(new Date(), 7) },
  {
    key: 'days30',
    label: 'Em 30 dias',
    resolve: () => addDays(new Date(), 30),
  },
  { key: 'year', label: 'Em 1 ano', resolve: () => addDays(new Date(), 365) },
] as const;

export function taskDateLabel(dueAt: string, allDay: boolean) {
  const due = new Date(dueAt);
  return allDay ? format(due, 'dd/MM/yyyy') : format(due, 'dd/MM/yyyy HH:mm');
}

export function startOfTaskDay(value = new Date()) {
  return startOfDay(value);
}

export function isTaskFuture(dueAt: string, now = new Date()) {
  return isAfter(new Date(dueAt), now);
}

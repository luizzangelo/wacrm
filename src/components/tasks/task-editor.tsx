'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { addHours, format } from 'date-fns';
import { CalendarClock, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import {
  QUICK_DUE_OPTIONS,
  dueAtFromInputs,
  dueInputsFromDate,
} from '@/lib/tasks/time';
import type { AccountMember, Contact, Task, TaskType } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

interface TaskEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void | Promise<void>;
  contactId?: string;
  conversationId?: string | null;
  initialDate?: Date;
  task?: Task | null;
  allowContactSelection?: boolean;
}

export function TaskEditor({
  open,
  onOpenChange,
  onSaved,
  contactId,
  conversationId,
  initialDate,
  task,
  allowContactSelection = false,
}: TaskEditorProps) {
  const { accountId, user, accountRole } = useAuth();
  const [types, setTypes] = useState<TaskType[]>([]);
  const [members, setMembers] = useState<AccountMember[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [typeId, setTypeId] = useState('');
  const [selectedContactId, setSelectedContactId] = useState(contactId ?? '');
  const [text, setText] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = useCallback(() => {
    const base = task
      ? new Date(task.due_at)
      : (initialDate ?? addHours(new Date(), 1));
    setTypeId(task?.task_type_id ?? '');
    setSelectedContactId(task?.contact_id ?? contactId ?? '');
    setText(task?.text ?? '');
    setAssignedTo(task?.assigned_to ?? user?.id ?? '');
    setDate(format(base, 'yyyy-MM-dd'));
    setTime(task?.all_day ? '' : format(base, 'HH:mm'));
  }, [contactId, initialDate, task, user?.id]);

  useEffect(() => {
    if (!open || !accountId) return;
    reset();
    const supabase = createClient();
    void Promise.all([
      supabase
        .from('task_types')
        .select('*')
        .eq('account_id', accountId)
        .order('name'),
      fetch('/api/account/members').then((response) => response.json()),
      allowContactSelection
        ? supabase
            .from('contacts')
            .select('*')
            .eq('account_id', accountId)
            .order('name')
            .limit(500)
        : Promise.resolve({ data: [] }),
    ]).then(([typeResult, memberResult, contactResult]) => {
      const loadedTypes = (typeResult.data ?? []) as TaskType[];
      setTypes(loadedTypes);
      setTypeId(
        (current) =>
          current ||
          loadedTypes.find((item) => item.name === 'Acompanhar')?.id ||
          loadedTypes[0]?.id ||
          ''
      );
      setMembers((memberResult.members ?? []) as AccountMember[]);
      setContacts((contactResult.data ?? []) as Contact[]);
    });
  }, [open, accountId, allowContactSelection, reset]);

  const canSave = useMemo(
    () =>
      Boolean(typeId && selectedContactId && text.trim() && assignedTo && date),
    [assignedTo, date, selectedContactId, text, typeId]
  );

  async function save() {
    if (!canSave || !accountId || !user || saving) return;
    setSaving(true);
    try {
      const due = dueAtFromInputs(date, time);
      const payload = {
        account_id: accountId,
        contact_id: selectedContactId,
        conversation_id: task?.conversation_id ?? conversationId ?? null,
        task_type_id: typeId,
        text: text.trim(),
        assigned_to: assignedTo,
        ...due,
      };
      const supabase = createClient();
      const result = task
        ? await supabase
            .from('tasks')
            .update(payload)
            .eq('id', task.id)
            .eq('account_id', accountId)
        : await supabase
            .from('tasks')
            .insert({ ...payload, created_by: user.id });
      if (result.error) throw result.error;
      toast.success(task ? 'Tarefa atualizada.' : 'Tarefa criada.');
      onOpenChange(false);
      await onSaved();
    } catch {
      toast.error('Não foi possível salvar a tarefa.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover text-popover-foreground max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="text-primary h-5 w-5" />
            {task ? 'Editar tarefa' : 'Nova tarefa'}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2 sm:grid-cols-2">
          {allowContactSelection && (
            <div className="space-y-2 sm:col-span-2">
              <Label>Contato</Label>
              <Select
                value={selectedContactId}
                onValueChange={(value) => setSelectedContactId(value ?? '')}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selecione o contato">
                    {contacts.find(
                      (contact) => contact.id === selectedContactId
                    )?.name ||
                      contacts.find(
                        (contact) => contact.id === selectedContactId
                      )?.phone}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {contacts.map((contact) => (
                    <SelectItem key={contact.id} value={contact.id}>
                      {contact.name || contact.phone}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label>Tipo</Label>
            <Select
              value={typeId}
              onValueChange={(value) => setTypeId(value ?? '')}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Tipo da tarefa">
                  {types.find((type) => type.id === typeId)?.name}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {types.map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Responsável</Label>
            <Select
              value={assignedTo}
              onValueChange={(value) => setAssignedTo(value ?? '')}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Responsável">
                  {members.find((member) => member.user_id === assignedTo)
                    ?.full_name || 'Usuário'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {members
                  .filter(
                    (member) =>
                      accountRole === 'owner' ||
                      accountRole === 'admin' ||
                      member.user_id === user?.id
                  )
                  .map((member) => (
                    <SelectItem key={member.user_id} value={member.user_id}>
                      {member.full_name || 'Usuário'}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Descrição</Label>
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Ex.: Falar com o contato"
              maxLength={500}
            />
          </div>
          <div className="space-y-2">
            <Label>Data de vencimento</Label>
            <Input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Horário (opcional)</Label>
            <Input
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
            <p className="text-muted-foreground text-[11px]">
              Sem horário = dia todo
            </p>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Atalhos rápidos</Label>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_DUE_OPTIONS.map((option) => (
                <Button
                  key={option.key}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => {
                    const next = dueInputsFromDate(option.resolve());
                    setDate(next.date);
                    setTime(next.time);
                  }}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button onClick={save} disabled={!canSave || saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

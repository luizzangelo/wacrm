import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { tasksAdmin } from '@/lib/tasks/admin-client';

export const maxDuration = 60;

function authorized(request: Request, expected: string) {
  const supplied = request.headers.get('x-cron-secret') ?? '';
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function GET(request: Request) {
  const secret = process.env.AUTOMATION_CRON_SECRET;
  if (!secret)
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  if (!authorized(request, secret))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = tasksAdmin();
  const { data: tasks, error } = await admin
    .from('tasks')
    .select('id,account_id,assigned_to,conversation_id,contact_id,text')
    .is('completed_at', null)
    .is('due_notification_sent_at', null)
    .lte('due_at', new Date().toISOString())
    .order('due_at')
    .limit(100);
  if (error)
    return NextResponse.json({ error: 'task lookup failed' }, { status: 500 });
  if (!tasks?.length) return NextResponse.json({ processed: 0 });

  const notifications = tasks.map((task) => ({
    account_id: task.account_id,
    user_id: task.assigned_to,
    type: 'task_due',
    conversation_id: task.conversation_id,
    contact_id: task.contact_id,
    task_id: task.id,
    actor_user_id: null,
    title: 'Tarefa vencida',
    body: task.text,
  }));
  const { error: insertError } = await admin
    .from('notifications')
    .upsert(notifications, {
      onConflict: 'task_id,user_id,type',
      ignoreDuplicates: true,
    });
  if (insertError)
    return NextResponse.json(
      { error: 'notification creation failed' },
      { status: 500 }
    );

  const ids = tasks.map((task) => task.id);
  const { error: updateError } = await admin
    .from('tasks')
    .update({ due_notification_sent_at: new Date().toISOString() })
    .in('id', ids)
    .is('due_notification_sent_at', null);
  if (updateError)
    return NextResponse.json(
      { error: 'task notification marker failed' },
      { status: 500 }
    );
  return NextResponse.json({ processed: ids.length });
}

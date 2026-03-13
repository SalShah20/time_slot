import type { TaskRow } from '@/types/timer';

const LS_PREFIX = 'ts_notif_';

function hasSent(key: string): boolean {
  try { return localStorage.getItem(LS_PREFIX + key) === '1'; }
  catch { return false; }
}

function markSent(key: string): void {
  try { localStorage.setItem(LS_PREFIX + key, '1'); }
  catch { /* localStorage unavailable */ }
}

function fire(title: string, body: string, tag: string): void {
  if (typeof window === 'undefined') return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  new Notification(title, { body, tag, icon: '/favicon.ico' });
}

export async function requestPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

/**
 * Fire a notification for any pending task based on its reminder setting.
 * Uses `reminder_minutes` if set (0 = no reminder), otherwise defaults to 15 min.
 * Uses localStorage to ensure each task only fires once.
 * Call this every minute.
 */
export function checkTaskStartingSoon(tasks: TaskRow[]): void {
  const now = Date.now();
  for (const task of tasks) {
    if (task.status !== 'pending' || !task.scheduled_start) continue;

    // 0 means no reminder for this task
    const reminderMin = task.reminder_minutes ?? 15;
    if (reminderMin === 0) continue;

    const minutesUntil = (new Date(task.scheduled_start).getTime() - now) / 60_000;
    // Fire within a 4-minute window centered around the reminder time
    const windowLow  = reminderMin - 2;
    const windowHigh = reminderMin + 2;
    if (minutesUntil >= windowLow && minutesUntil < windowHigh) {
      const key = `soon_${task.id}`;
      if (!hasSent(key)) {
        const label = reminderMin >= 60
          ? `${Math.round(reminderMin / 60)} hour${reminderMin >= 120 ? 's' : ''}`
          : `${reminderMin} minute${reminderMin !== 1 ? 's' : ''}`;
        fire(
          'Task starting soon',
          `"${task.title}" starts in ${label}`,
          `soon-${task.id}`,
        );
        markSent(key);
      }
    }
  }
}

/**
 * Fire a notification for any non-completed task whose deadline is tomorrow.
 * Highlights if the task is also unscheduled.
 */
export function checkDeadlineApproaching(tasks: TaskRow[]): void {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

  for (const task of tasks) {
    if (!task.deadline || task.status === 'completed' || task.status === 'cancelled') continue;
    const deadlineDate = task.deadline.slice(0, 10);
    if (deadlineDate !== tomorrowDate) continue;

    const key = `deadline_${task.id}_${tomorrowDate}`;
    if (!hasSent(key)) {
      const unscheduled = !task.scheduled_start ? ' — not yet scheduled' : '';
      fire(
        'Deadline tomorrow',
        `"${task.title}" is due tomorrow${unscheduled}`,
        `deadline-${task.id}`,
      );
      markSent(key);
    }
  }
}

/**
 * Send the 8 AM morning summary. `dateKey` should be 'YYYY-MM-DD' for today.
 * No-ops if already sent today.
 */
export function sendMorningSummary(tasks: TaskRow[], dateKey: string): void {
  const key = `morning_${dateKey}`;
  if (hasSent(key)) return;

  const todayStart = new Date(dateKey).getTime();
  const todayEnd   = todayStart + 86_400_000;

  const todayTasks = tasks
    .filter((t) => {
      if (t.status === 'completed' || !t.scheduled_start) return false;
      const ts = new Date(t.scheduled_start).getTime();
      return ts >= todayStart && ts < todayEnd;
    })
    .sort((a, b) => new Date(a.scheduled_start!).getTime() - new Date(b.scheduled_start!).getTime());

  const body = todayTasks.length > 0
    ? `${todayTasks.length} task${todayTasks.length !== 1 ? 's' : ''} scheduled today — first up: "${todayTasks[0].title}"`
    : 'No tasks scheduled yet. Add one to get started!';

  fire("Good morning! Here's your day", body, 'morning-summary');
  markSent(key);
}

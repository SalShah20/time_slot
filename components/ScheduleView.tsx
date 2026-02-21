'use client';

import { useEffect, useState, useRef } from 'react';
import type { TaskRow } from '@/types/timer';

const HOUR_HEIGHT = 64; // px per hour
const START_HOUR  = 7;  // 7 am
const END_HOUR    = 21; // 9 pm

interface Props {
  tasks: TaskRow[];
  loading: boolean;
}

function formatHour(h: number): string {
  if (h === 0)  return '12am';
  if (h === 12) return '12pm';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

function formatDateHeader(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function topForTime(isoTime: string): number {
  const d = new Date(isoTime);
  return (d.getHours() - START_HOUR + d.getMinutes() / 60) * HOUR_HEIGHT;
}

function heightForMinutes(minutes: number): number {
  return Math.max(28, (minutes / 60) * HOUR_HEIGHT);
}

function currentTimeTop(): number | null {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  if (h < START_HOUR || h >= END_HOUR) return null;
  return (h - START_HOUR + m / 60) * HOUR_HEIGHT;
}

const PRIORITY_STRIPE: Record<string, string> = {
  high:   'border-red-400',
  medium: 'border-amber-400',
  low:    'border-green-500',
};

function TaskBlock({ task }: { task: TaskRow }) {
  const top    = topForTime(task.scheduled_start!);
  const height = heightForMinutes(task.estimated_minutes);

  const borderColor =
    task.status === 'in_progress'
      ? 'border-amber-400'
      : task.priority && PRIORITY_STRIPE[task.priority]
      ? PRIORITY_STRIPE[task.priority]
      : 'border-teal-400';

  const bg =
    task.status === 'in_progress' ? 'bg-amber-50 text-amber-900' : 'bg-teal-50 text-teal-900';

  return (
    <div
      className={`absolute left-14 right-2 rounded-lg border-l-4 px-2.5 py-1.5 overflow-hidden shadow-sm ${bg} ${borderColor}`}
      style={{ top: `${top}px`, height: `${height}px` }}
      title={task.title}
    >
      <p className="text-xs font-semibold truncate leading-tight">{task.title}</p>
      <div className="flex items-center gap-1.5 mt-0.5">
        <p className="text-xs opacity-60">{task.estimated_minutes}m</p>
        {task.tag && <p className="text-xs opacity-60">· {task.tag}</p>}
      </div>
    </div>
  );
}

export default function ScheduleView({ tasks, loading }: Props) {
  const [timeTop, setTimeTop] = useState<number | null>(currentTimeTop());
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setInterval(() => setTimeTop(currentTimeTop()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Scroll to current time on mount
  useEffect(() => {
    if (gridRef.current && timeTop !== null) {
      gridRef.current.scrollTop = Math.max(0, timeTop - 80);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalHours = END_HOUR - START_HOUR;
  const gridHeight = totalHours * HOUR_HEIGHT;

  const today      = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const todayEnd   = todayStart + 86_400_000;

  const scheduledTasks   = tasks.filter((t) => t.scheduled_start !== null);
  const unscheduledTasks = tasks.filter((t) => t.scheduled_start === null);

  const todayTasks = scheduledTasks.filter((t) => {
    const ts = new Date(t.scheduled_start!).getTime();
    return ts >= todayStart && ts < todayEnd;
  });

  return (
    <div className="h-full flex flex-col">
      {/* Date header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-surface-200 bg-white flex-shrink-0">
        <div>
          <h2 className="text-base font-bold text-surface-900">Today&apos;s Schedule</h2>
          <p className="text-xs text-surface-500">{formatDateHeader(today)}</p>
        </div>
        <div className="flex items-center gap-2">
          {todayTasks.length > 0 && (
            <span className="text-xs bg-teal-100 text-teal-700 font-medium px-2 py-0.5 rounded-full">
              {todayTasks.length} task{todayTasks.length > 1 ? 's' : ''} scheduled
            </span>
          )}
        </div>
      </div>

      {/* Scrollable grid */}
      <div className="flex-1 overflow-y-auto" ref={gridRef}>
        {loading ? (
          <div className="flex items-center justify-center py-20 text-surface-400 text-sm">
            Loading schedule…
          </div>
        ) : (
          <>
            {/* Time grid */}
            <div className="relative mx-4 mt-2" style={{ height: `${gridHeight}px` }}>
              {/* Hour rows */}
              {Array.from({ length: totalHours + 1 }, (_, i) => {
                const h = START_HOUR + i;
                return (
                  <div
                    key={h}
                    className="absolute w-full border-t border-surface-100 flex items-start"
                    style={{ top: `${i * HOUR_HEIGHT}px` }}
                  >
                    <span className="text-xs text-surface-400 w-10 pr-2 text-right -mt-2 select-none">
                      {formatHour(h)}
                    </span>
                  </div>
                );
              })}

              {/* Task blocks */}
              {todayTasks.map((task) => (
                <TaskBlock key={task.id} task={task} />
              ))}

              {/* Current time indicator */}
              {timeTop !== null && (
                <div
                  className="absolute left-0 right-0 z-10 pointer-events-none"
                  style={{ top: `${timeTop}px` }}
                >
                  <div className="flex items-center">
                    <div className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0 ml-10" />
                    <div className="flex-1 h-px bg-red-400" />
                  </div>
                </div>
              )}
            </div>

            {/* Unscheduled tasks */}
            {unscheduledTasks.length > 0 && (
              <div className="mx-4 mt-6 mb-4">
                <h3 className="text-xs font-semibold text-surface-400 uppercase tracking-wider mb-3">
                  Unscheduled
                </h3>
                <div className="space-y-2">
                  {unscheduledTasks.map((task) => (
                    <div
                      key={task.id}
                      className="flex items-center justify-between bg-white border border-surface-200 rounded-lg px-4 py-3 shadow-sm"
                    >
                      <div>
                        <p className="text-sm font-medium text-surface-900">{task.title}</p>
                        <p className="text-xs text-surface-500">{task.estimated_minutes}m estimated</p>
                      </div>
                      <span className="text-xs px-2 py-1 rounded-full font-medium bg-surface-100 text-surface-600">
                        Pending
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Empty state */}
            {todayTasks.length === 0 && unscheduledTasks.length === 0 && (
              <div className="text-center py-16 px-6 text-surface-400">
                <div className="w-12 h-12 bg-surface-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-surface-500">No tasks scheduled today</p>
                <p className="text-xs mt-1">Add a task on the left to get started.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

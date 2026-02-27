'use client';

import { useEffect, useState, useRef } from 'react';
import type { TaskRow, CalendarBlock } from '@/types/timer';
import AddBlockModal from '@/components/AddBlockModal';
import { getTagColor } from '@/lib/tagColors';

const HOUR_HEIGHT = 64; // px per hour
const START_HOUR  = 0;  // 12 am
const END_HOUR    = 24; // 12 am (next day)

// ── Column layout algorithm ────────────────────────────────────────────────

interface LayoutEntry {
  key: string;
  start: number; // ms
  end: number;   // ms
}

function assignColumns(entries: LayoutEntry[]): Map<string, { col: number; totalCols: number }> {
  if (entries.length === 0) return new Map();

  const sorted = [...entries].sort((a, b) => a.start - b.start);
  const colEnds: number[] = [];
  const colOf = new Map<string, number>();

  for (const ev of sorted) {
    let c = 0;
    while (c < colEnds.length && colEnds[c] > ev.start) c++;
    colEnds[c] = ev.end;
    colOf.set(ev.key, c);
  }

  const result = new Map<string, { col: number; totalCols: number }>();
  for (const ev of sorted) {
    const myCol = colOf.get(ev.key)!;
    let maxCol = myCol;
    for (const other of sorted) {
      if (other.key !== ev.key && other.start < ev.end && other.end > ev.start) {
        maxCol = Math.max(maxCol, colOf.get(other.key)!);
      }
    }
    result.set(ev.key, { col: myCol, totalCols: maxCol + 1 });
  }

  return result;
}

function columnStyle(col: number, totalCols: number): React.CSSProperties {
  if (totalCols <= 1) return {};
  return {
    left: `calc(56px + ${col} * (100% - 64px) / ${totalCols})`,
    right: 'auto',
    width: `calc((100% - 64px) / ${totalCols} - 4px)`,
  };
}

interface Props {
  tasks: TaskRow[];
  loading: boolean;
  blocks: CalendarBlock[];
  calendarConnected: boolean;
  selectedDate?: Date;
  onDateChange?: (date: Date) => void;
  onAddBlock: (block: { title: string; start_time: string; end_time: string }) => Promise<void>;
  onDeleteBlock: (id: string) => Promise<void>;
}

function formatHour(h: number): string {
  if (h === 0 || h === 24) return '12am';
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

function heightForRange(startIso: string, endIso: string): number {
  const durationMinutes = (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000;
  return Math.max(28, (durationMinutes / 60) * HOUR_HEIGHT);
}

function currentTimeTop(): number | null {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  if (h < START_HOUR || h >= END_HOUR) return null;
  return (h - START_HOUR + m / 60) * HOUR_HEIGHT;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth()    === b.getMonth()    &&
    a.getDate()     === b.getDate()
  );
}

function TaskBlock({ task, colStyle }: { task: TaskRow; colStyle?: React.CSSProperties }) {
  const top    = topForTime(task.scheduled_start!);
  const height = heightForMinutes(task.estimated_minutes);
  const tagColor = getTagColor(task.tag);

  // Status colors take precedence; tag colors apply for pending tasks
  const borderColor =
    task.status === 'in_progress' ? 'border-amber-400' :
    task.status === 'completed'   ? 'border-green-400' :
    tagColor.border;

  const bg =
    task.status === 'completed'   ? 'bg-green-50 text-green-700 opacity-60' :
    task.status === 'in_progress' ? 'bg-amber-50 text-amber-900' :
    'bg-white text-surface-900';

  return (
    <div
      className={`absolute left-14 right-2 rounded-lg border-l-4 px-2.5 py-1.5 overflow-hidden shadow-sm z-10 ${bg} ${borderColor}`}
      style={{ top: `${top}px`, height: `${height}px`, ...colStyle }}
      title={task.title}
    >
      <p className="text-xs font-semibold truncate leading-tight">{task.title}</p>
      <div className="flex items-center gap-1.5 mt-0.5">
        <p className="text-xs opacity-60">{task.estimated_minutes}m</p>
        {task.tag && (
          <span
            className="text-xs font-medium px-1.5 py-0.5 rounded-full"
            style={{ backgroundColor: tagColor.hex + '22', color: tagColor.hex }}
          >
            {task.tag}
          </span>
        )}
      </div>
    </div>
  );
}

function BlockItem({
  block,
  colStyle,
  onDelete,
}: {
  block: CalendarBlock;
  colStyle?: React.CSSProperties;
  onDelete?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const top    = topForTime(block.start_time);
  const height = heightForRange(block.start_time, block.end_time);

  const isGoogle = block.source === 'google';
  const bg = isGoogle
    ? 'bg-violet-50 text-violet-900 border-violet-300'
    : 'bg-indigo-50 text-indigo-900 border-indigo-300';

  return (
    <div
      className={`absolute left-14 right-2 rounded-lg border-l-4 px-2.5 py-1.5 overflow-hidden shadow-sm z-[5] opacity-80 ${bg}`}
      style={{ top: `${top}px`, height: `${height}px`, ...colStyle }}
      title={block.title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-start justify-between gap-1">
        <p className="text-xs font-semibold truncate leading-tight">{block.title}</p>
        {!isGoogle && hovered && onDelete && (
          <button
            onClick={onDelete}
            className="flex-shrink-0 text-indigo-300 hover:text-red-500 leading-none text-sm font-bold transition-colors"
            title="Remove block"
          >
            ×
          </button>
        )}
      </div>
      {isGoogle && (
        <p className="text-xs opacity-50 truncate">Google Calendar</p>
      )}
    </div>
  );
}

export default function ScheduleView({
  tasks,
  loading,
  blocks,
  calendarConnected,
  selectedDate: selectedDateProp,
  onDateChange,
  onAddBlock,
  onDeleteBlock,
}: Props) {
  const today = new Date();
  const selectedDate = selectedDateProp ?? today;
  const isToday = isSameDay(selectedDate, today);

  const [timeTop, setTimeTop]           = useState<number | null>(isToday ? currentTimeTop() : null);
  const [showAddBlock, setShowAddBlock] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isToday) {
      setTimeTop(null);
      return;
    }
    setTimeTop(currentTimeTop());
    const id = setInterval(() => setTimeTop(currentTimeTop()), 60_000);
    return () => clearInterval(id);
  }, [isToday]);

  // Scroll to a smart position whenever the viewed date changes.
  // Today → current time. Other days → first scheduled task, or 8 AM default.
  const selectedDateKey = `${selectedDate.getFullYear()}-${selectedDate.getMonth()}-${selectedDate.getDate()}`;
  useEffect(() => {
    if (!gridRef.current) return;
    if (isToday && timeTop !== null) {
      gridRef.current.scrollTop = Math.max(0, timeTop - 80);
      return;
    }
    const firstTask = [...viewTasks].sort(
      (a, b) => new Date(a.scheduled_start!).getTime() - new Date(b.scheduled_start!).getTime(),
    )[0];
    gridRef.current.scrollTop = firstTask
      ? Math.max(0, topForTime(firstTask.scheduled_start!) - 80)
      : 8 * HOUR_HEIGHT; // default 8 AM
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDateKey]);

  const totalHours = END_HOUR - START_HOUR;
  const gridHeight = totalHours * HOUR_HEIGHT;

  const selectedStart = new Date(
    selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate()
  ).getTime();
  const selectedEnd = selectedStart + 86_400_000;

  const scheduledTasks   = tasks.filter((t) => t.scheduled_start !== null);
  const unscheduledTasks = isToday ? tasks.filter((t) => t.scheduled_start === null) : [];

  const viewTasks = scheduledTasks.filter((t) => {
    const ts = new Date(t.scheduled_start!).getTime();
    return ts >= selectedStart && ts < selectedEnd;
  });

  const viewBlocks = blocks.filter((b) => {
    const ts = new Date(b.start_time).getTime();
    return ts >= selectedStart && ts < selectedEnd;
  });

  // Column layout: combine tasks + blocks
  const layoutEntries: LayoutEntry[] = [
    ...viewTasks.map((t) => ({
      key: `task-${t.id}`,
      start: new Date(t.scheduled_start!).getTime(),
      end: t.scheduled_end
        ? new Date(t.scheduled_end).getTime()
        : new Date(t.scheduled_start!).getTime() + t.estimated_minutes * 60_000,
    })),
    ...viewBlocks.map((b) => ({
      key: `block-${b.id}`,
      start: new Date(b.start_time).getTime(),
      end: new Date(b.end_time).getTime(),
    })),
  ];
  const layout = assignColumns(layoutEntries);

  // Prev / next day helpers
  const prevDay = new Date(selectedDate);
  prevDay.setDate(prevDay.getDate() - 1);
  const nextDay = new Date(selectedDate);
  nextDay.setDate(nextDay.getDate() + 1);

  const isTomorrow = isSameDay(selectedDate, (() => { const t = new Date(today); t.setDate(t.getDate() + 1); return t; })());
  const dayLabel = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : null;

  return (
    <div className="h-full flex flex-col">
      {/* Date header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-surface-200 bg-white flex-shrink-0">
        {/* Date nav: ← date → */}
        <div className="flex items-center gap-1.5">
          {onDateChange && (
            <button
              onClick={() => onDateChange(prevDay)}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-surface-400 hover:text-surface-700 hover:bg-surface-100 transition-colors"
              aria-label="Previous day"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <div>
            <div className="flex items-baseline gap-1.5">
              <h2 className="text-base font-bold text-surface-900">
                {formatDateHeader(selectedDate)}
              </h2>
              {dayLabel && (
                <span className="text-xs font-medium text-teal-600">{dayLabel}</span>
              )}
            </div>
          </div>
          {onDateChange && (
            <button
              onClick={() => onDateChange(nextDay)}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-surface-400 hover:text-surface-700 hover:bg-surface-100 transition-colors"
              aria-label="Next day"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Jump to today */}
          {onDateChange && !isToday && (
            <button
              onClick={() => onDateChange(today)}
              className="px-2.5 py-1 rounded-lg border border-surface-200 text-xs font-medium text-surface-600 hover:bg-surface-50 transition-colors"
            >
              Today
            </button>
          )}

          {viewTasks.length > 0 && (
            <span className="text-xs bg-teal-100 text-teal-700 font-medium px-2 py-0.5 rounded-full">
              {viewTasks.length} task{viewTasks.length > 1 ? 's' : ''} scheduled
            </span>
          )}
          <button
            onClick={() => setShowAddBlock(true)}
            className="flex items-center gap-1 px-2.5 py-1 border border-surface-200 rounded-lg text-xs font-medium text-surface-600 hover:bg-surface-50 transition-colors"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add Block
          </button>
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

              {/* Calendar blocks (behind tasks) */}
              {viewBlocks.map((block) => {
                const l = layout.get(`block-${block.id}`);
                return (
                  <BlockItem
                    key={`${block.source}-${block.id}`}
                    block={block}
                    colStyle={l ? columnStyle(l.col, l.totalCols) : undefined}
                    onDelete={() => onDeleteBlock(block.id)}
                  />
                );
              })}

              {/* Task blocks (in front) */}
              {viewTasks.map((task) => {
                const l = layout.get(`task-${task.id}`);
                return (
                  <TaskBlock
                    key={task.id}
                    task={task}
                    colStyle={l ? columnStyle(l.col, l.totalCols) : undefined}
                  />
                );
              })}

              {/* Current time indicator (today only) */}
              {isToday && timeTop !== null && (
                <div
                  className="absolute left-0 right-0 z-20 pointer-events-none"
                  style={{ top: `${timeTop}px` }}
                >
                  <div className="flex items-center">
                    <div className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0 ml-10" />
                    <div className="flex-1 h-px bg-red-400" />
                  </div>
                </div>
              )}
            </div>

            {/* Unscheduled tasks (today only) */}
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
            {viewTasks.length === 0 && unscheduledTasks.length === 0 && viewBlocks.length === 0 && (
              <div className="text-center py-16 px-6 text-surface-400">
                <div className="w-12 h-12 bg-surface-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                {calendarConnected ? (
                  <>
                    <p className="text-sm font-medium text-surface-500">
                      No events {isToday ? 'today' : 'tomorrow'}
                    </p>
                    <p className="text-xs mt-1">Add a task to auto-schedule it into your day.</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium text-surface-500">
                      No tasks scheduled {isToday ? 'today' : 'tomorrow'}
                    </p>
                    <p className="text-xs mt-1">
                      Add a task to get started, or{' '}
                      <a href="/api/calendar/oauth" className="text-teal-600 hover:underline">
                        connect Google Calendar
                      </a>{' '}
                      to see your existing schedule.
                    </p>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {showAddBlock && (
        <AddBlockModal
          onAdd={onAddBlock}
          onClose={() => setShowAddBlock(false)}
        />
      )}
    </div>
  );
}

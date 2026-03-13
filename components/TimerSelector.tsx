'use client';

import { useState } from 'react';
import type { TaskRow } from '@/types/timer';
import * as timer from '@/lib/timerService';
import { getTagColor } from '@/lib/tagColors';

interface Props {
  tasks: TaskRow[];
  onStarted: () => void;
  onClose: () => void;
}

const PRIORITY_STYLES: Record<string, { label: string; cls: string }> = {
  urgent: { label: 'Urgent', cls: 'bg-red-100 text-red-700' },
  high:   { label: 'High',   cls: 'bg-red-50 text-red-600' },
  medium: { label: 'Medium', cls: 'bg-amber-50 text-amber-700' },
  low:    { label: 'Low',    cls: 'bg-surface-100 text-surface-600' },
};

function formatTimeRange(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  if (end) return `${fmt(start)} – ${fmt(end)}`;
  return fmt(start);
}

export default function TimerSelector({ tasks, onStarted, onClose }: Props) {
  const [selectedId, setSelectedId] = useState<string>('');
  const [starting, setStarting] = useState(false);

  const pendingTasks = tasks
    .filter((t) => t.status === 'pending')
    .sort((a, b) => {
      if (!a.scheduled_start && !b.scheduled_start) return 0;
      if (!a.scheduled_start) return 1;
      if (!b.scheduled_start) return -1;
      return new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime();
    });

  async function handleStart() {
    const task = tasks.find((t) => t.id === selectedId);
    if (!task) return;
    setStarting(true);
    await timer.startTask(task.id, task.title, task.estimated_minutes);
    setStarting(false);
    onStarted();
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-surface-900">Select Task to Work On</h2>
          <button
            onClick={onClose}
            className="text-surface-400 hover:text-surface-600 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {pendingTasks.length === 0 ? (
          <p className="text-sm text-surface-500 text-center py-8">
            No pending tasks. Add a task first to start timing.
          </p>
        ) : (
          <div className="space-y-2 mb-5 max-h-72 overflow-y-auto">
            {pendingTasks.map((task) => {
              const tagColor = task.tag ? getTagColor(task.tag) : null;
              const timeRange = formatTimeRange(task.scheduled_start, task.scheduled_end);
              const priority = task.priority ? PRIORITY_STYLES[task.priority] : null;

              return (
                <label
                  key={task.id}
                  className={`flex items-start gap-3 p-3 border rounded-xl cursor-pointer transition-colors ${
                    selectedId === task.id
                      ? 'border-teal-500 bg-teal-50'
                      : 'border-surface-200 hover:border-surface-300 hover:bg-surface-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="task-select"
                    value={task.id}
                    checked={selectedId === task.id}
                    onChange={() => setSelectedId(task.id)}
                    className="accent-teal-600 mt-1"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-surface-900 truncate">{task.title}</p>
                    {timeRange && (
                      <p className="text-xs text-surface-400 mt-0.5">{timeRange}</p>
                    )}
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      {tagColor && task.tag && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${tagColor.bg} ${tagColor.text}`}>
                          {task.tag}
                        </span>
                      )}
                      {priority && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${priority.cls}`}>
                          {priority.label}
                        </span>
                      )}
                      <span className="text-xs text-surface-400">{task.estimated_minutes}m est.</span>
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 border border-surface-300 text-surface-700 rounded-lg hover:bg-surface-50 transition-colors text-sm font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleStart}
            disabled={!selectedId || starting || pendingTasks.length === 0}
            className="flex-1 py-2.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm font-medium flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
            {starting ? 'Starting...' : 'Start Working'}
          </button>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import TaskForm, { type TaskInput } from '@/components/TaskForm';
import type { TaskRow } from '@/types/timer';

interface Props {
  open: boolean;
  onClose: () => void;
  onTaskCreated: (task: TaskRow) => void;
  onTasksCreated?: (tasks: TaskRow[]) => void;
}

export default function TaskDrawer({ open, onClose, onTaskCreated, onTasksCreated }: Props) {
  const [batchMode, setBatchMode]     = useState(false);
  const [queue, setQueue]             = useState<TaskInput[]>([]);
  const [submitting, setSubmitting]   = useState(false);
  const [batchError, setBatchError]   = useState<string | null>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Reset batch state when drawer closes
  useEffect(() => {
    if (!open) {
      setBatchMode(false);
      setQueue([]);
      setBatchError(null);
    }
  }, [open]);

  const handleTaskCreated = (task: TaskRow) => {
    onTaskCreated(task);
    onClose();
  };

  const handleAddToQueue = (task: TaskInput) => {
    setQueue((prev) => [...prev, task]);
  };

  const handleRemoveFromQueue = (index: number) => {
    setQueue((prev) => prev.filter((_, i) => i !== index));
  };

  const handleScheduleAll = async () => {
    if (queue.length === 0) return;
    setBatchError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/tasks/batch-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks: queue }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? 'Batch scheduling failed');
      }
      const { tasks } = await res.json() as { tasks: TaskRow[] };
      if (onTasksCreated) {
        onTasksCreated(tasks);
      } else {
        tasks.forEach((t) => onTaskCreated(t));
      }
      onClose();
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  const formatDuration = (min: number) =>
    min >= 60 ? `${Math.floor(min / 60)}h${min % 60 > 0 ? ` ${min % 60}m` : ''}` : `${min}m`;

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/30 z-40 transition-opacity duration-300 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl shadow-2xl transition-transform duration-300 ease-out max-h-[90vh] flex flex-col ${
          open ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        {/* Handle bar */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 bg-surface-200 rounded-full" />
        </div>

        {/* Drawer header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-surface-900">
              {batchMode ? 'Batch Add Tasks' : 'Add New Task'}
            </h2>
            <p className="text-xs text-surface-500 mt-0.5">
              {batchMode
                ? `${queue.length} task${queue.length !== 1 ? 's' : ''} in queue — schedule all at once`
                : 'Auto-schedules into your free time'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Batch mode toggle */}
            <button
              onClick={() => { setBatchMode((v) => !v); setQueue([]); setBatchError(null); }}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                batchMode
                  ? 'border-teal-500 bg-teal-50 text-teal-700'
                  : 'border-surface-200 text-surface-500 hover:border-surface-300 hover:bg-surface-50'
              }`}
              title={batchMode ? 'Switch to single task mode' : 'Switch to batch mode'}
            >
              {batchMode ? 'Batch On' : 'Batch'}
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full text-surface-400 hover:text-surface-600 hover:bg-surface-100 transition-colors text-xl leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        {/* Batch queue list */}
        {batchMode && queue.length > 0 && (
          <div className="px-5 py-3 border-b border-surface-100 flex-shrink-0 space-y-2 max-h-40 overflow-y-auto">
            {queue.map((task, i) => (
              <div key={i} className="flex items-center gap-2 bg-surface-50 rounded-lg px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-surface-900 truncate">{task.title}</p>
                  <p className="text-xs text-surface-500">
                    {formatDuration(task.estimatedMinutes)}
                    {task.tag && ` · ${task.tag}`}
                    {task.deadline && ` · due ${new Date(task.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                  </p>
                </div>
                <button
                  onClick={() => handleRemoveFromQueue(i)}
                  className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-surface-400 hover:text-red-500 hover:bg-red-50 transition-colors text-sm leading-none"
                  aria-label="Remove from queue"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Form — scrollable */}
        <div className="flex-1 overflow-y-auto pb-2">
          <TaskForm
            onTaskCreated={handleTaskCreated}
            hideHeader
            onQueue={batchMode ? handleAddToQueue : undefined}
          />
        </div>

        {/* Batch submit footer */}
        {batchMode && (
          <div className="px-5 py-4 border-t border-surface-100 flex-shrink-0 space-y-2">
            {batchError && (
              <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{batchError}</p>
            )}
            <button
              onClick={handleScheduleAll}
              disabled={queue.length === 0 || submitting}
              className="w-full py-2.5 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {submitting
                ? 'Scheduling…'
                : queue.length === 0
                ? 'Add tasks to queue above'
                : `Schedule All ${queue.length} Task${queue.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

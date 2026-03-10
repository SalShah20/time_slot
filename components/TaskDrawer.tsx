'use client';

import { useEffect, useState } from 'react';
import TaskForm, { type TaskInput } from '@/components/TaskForm';
import BrainDumpInput from '@/components/BrainDumpInput';
// import VoiceTaskAgent from '@/components/VoiceTaskAgent'; // TODO: implement voice agent later
import type { TaskRow } from '@/types/timer';

interface Props {
  open: boolean;
  onClose: () => void;
  onTaskCreated: (task: TaskRow) => void;
  onTasksCreated?: (tasks: TaskRow[]) => void;
}

export default function TaskDrawer({ open, onClose, onTaskCreated, onTasksCreated }: Props) {
  // batchMode = true → queue tasks then schedule all
  // batchMode = false → quick add (immediate scheduling, one task)
  const [batchMode, setBatchMode]         = useState(true);
  // inputMode only applies in batch mode
  const [inputMode, setInputMode]         = useState<'braindump' | 'detailed' | 'voice'>('braindump');
  const [queue, setQueue]                 = useState<TaskInput[]>([]);
  const [submitting, setSubmitting]       = useState(false);
  const [batchError, setBatchError]       = useState<string | null>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Reset state when drawer closes
  useEffect(() => {
    if (!open) {
      setBatchMode(true);
      setInputMode('braindump');
      setQueue([]);
      setBatchError(null);
    }
  }, [open]);

  const handleTaskCreated = (task: TaskRow) => {
    onTaskCreated(task);
    onClose();
  };

  const handleSingleTasksCreated = (tasks: TaskRow[]) => {
    if (onTasksCreated) onTasksCreated(tasks);
    else tasks.forEach((t) => onTaskCreated(t));
    onClose();
  };

  // Add one task from the structured form
  const handleAddToQueue = (task: TaskInput) => {
    setQueue((prev) => [...prev, task]);
  };

  // Add multiple tasks from the brain dump parser
  const handleAddManyToQueue = (tasks: TaskInput[]) => {
    setQueue((prev) => [...prev, ...tasks]);
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
        body: JSON.stringify({
          tasks:    queue,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      let data: Record<string, unknown> = {};
      try { data = await res.json() as Record<string, unknown>; } catch { /* non-JSON */ }
      if (!res.ok) {
        throw new Error((data.error as string) ?? `Batch scheduling failed (HTTP ${res.status})`);
      }
      const { tasks } = data as { tasks: TaskRow[] };
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
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 bg-surface-200 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-surface-900">
              {batchMode ? 'Add Tasks' : 'Quick Add'}
            </h2>
            <p className="text-xs text-surface-500 mt-0.5">
              {batchMode
                ? queue.length > 0
                  ? `${queue.length} task${queue.length !== 1 ? 's' : ''} queued — schedule all at once`
                  : 'Queue tasks then schedule together'
                : 'Schedule one task immediately'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* Batch input-mode tabs (only in batch mode) */}
            {batchMode && (
              <div className="flex items-center bg-surface-100 rounded-full p-0.5 gap-0.5">
                <button
                  onClick={() => setInputMode('braindump')}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    inputMode === 'braindump'
                      ? 'bg-white text-teal-700 shadow-sm'
                      : 'text-surface-500 hover:text-surface-700'
                  }`}
                  title="Type tasks naturally — AI parses them"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                  </svg>
                  AI
                </button>
                <button
                  onClick={() => setInputMode('detailed')}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    inputMode === 'detailed'
                      ? 'bg-white text-teal-700 shadow-sm'
                      : 'text-surface-500 hover:text-surface-700'
                  }`}
                  title="Fill out a structured form"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                  </svg>
                  Form
                </button>
                <button
                  onClick={() => setInputMode('voice')}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    inputMode === 'voice'
                      ? 'bg-white text-teal-700 shadow-sm'
                      : 'text-surface-500 hover:text-surface-700'
                  }`}
                  title="Speak your tasks — AI adds them to the queue"
                >
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 1a4 4 0 00-4 4v7a4 4 0 008 0V5a4 4 0 00-4-4z" />
                    <path d="M19 11a7 7 0 01-14 0H3a9 9 0 008 8.94V22h2v-2.06A9 9 0 0021 11h-2z" />
                  </svg>
                  Voice
                </button>
              </div>
            )}

            {/* Batch / Quick toggle */}
            <button
              onClick={() => { setBatchMode((v) => !v); setQueue([]); setBatchError(null); }}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                !batchMode
                  ? 'border-teal-500 bg-teal-50 text-teal-700'
                  : 'border-surface-200 text-surface-500 hover:border-surface-300 hover:bg-surface-50'
              }`}
              title={batchMode ? 'Switch to quick-add (schedules immediately)' : 'Switch to batch mode (queue then schedule all)'}
            >
              {batchMode ? 'Quick Add' : 'Batch Mode'}
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

        {/* Queue list */}
        {batchMode && queue.length > 0 && (
          <div className="px-5 py-3 border-b border-surface-100 flex-shrink-0 space-y-2 max-h-44 overflow-y-auto">
            {queue.map((task, i) => (
              <div key={i} className="flex items-center gap-2 bg-surface-50 rounded-lg px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-surface-900 truncate">{task.title}</p>
                  <p className="text-xs text-surface-500">
                    {task.estimatedMinutes ? formatDuration(task.estimatedMinutes) : 'AI estimate'}
                    {task.tag && ` · ${task.tag}`}
                    {task.isFixed && ' · Pinned'}
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

        {/* Input area */}
        <div className="flex-1 overflow-y-auto pb-2">
          {batchMode ? (
            inputMode === 'braindump' ? (
              <div className="px-5 py-4">
                <BrainDumpInput
                  onTasksQueued={handleAddManyToQueue}
                  onSwitchToForm={() => setInputMode('detailed')}
                />
              </div>
            ) : inputMode === 'voice' ? (
              // TODO: VoiceTaskAgent — implement later
              <div className="px-5 py-8 text-center text-surface-500 text-sm">Voice input coming soon.</div>
            ) : (
              <TaskForm
                onTaskCreated={handleTaskCreated}
                hideHeader
                onQueue={handleAddToQueue}
              />
            )
          ) : (
            <TaskForm
              onTaskCreated={handleTaskCreated}
              onTasksCreated={handleSingleTasksCreated}
              hideHeader
            />
          )}
        </div>

        {/* Batch schedule footer */}
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
                ? 'Parse or add tasks above'
                : `Schedule All (${queue.length})`}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

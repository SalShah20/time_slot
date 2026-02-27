'use client';

import { useState, useEffect } from 'react';
import type { TaskRow } from '@/types/timer';
import { getTagColor } from '@/lib/tagColors';
import { getUserTags, saveUserTag } from '@/lib/userTags';

export interface TaskInput {
  title: string;
  description?: string;
  tag?: string;
  /** Omit to let the server LLM estimate the duration */
  estimatedMinutes?: number;
  priority: string;
  deadline?: string;
}

interface Props {
  onTaskCreated: (task: TaskRow) => void;
  hideHeader?: boolean;
  /** If provided, the form operates in "queue" mode: validates then calls this instead of the API. */
  onQueue?: (task: TaskInput) => void;
}

const DURATION_OPTIONS = [
  { label: 'AI Estimate', value: -1 },
  { label: '30 min',      value: 30 },
  { label: '1 hour',      value: 60 },
  { label: '2 hours',     value: 120 },
  { label: '3 hours',     value: 180 },
  { label: '4 hours',     value: 240 },
  { label: 'Custom',      value: 0 },
];

const SUGGESTED_TAGS = ['Study', 'Work', 'Personal', 'Exercise', 'Health', 'Social', 'Errands', 'Other'];

const PRIORITY_OPTIONS = [
  { label: 'Low',    value: 'low',    dot: 'bg-green-500' },
  { label: 'Medium', value: 'medium', dot: 'bg-amber-400' },
  { label: 'High',   value: 'high',   dot: 'bg-red-500'   },
] as const;
type Priority = 'low' | 'medium' | 'high';

export default function TaskForm({ onTaskCreated, hideHeader = false, onQueue }: Props) {
  const [title, setTitle]               = useState('');
  const [description, setDescription]   = useState('');
  const [deadlineDate, setDeadlineDate] = useState('');
  const [deadlineTime, setDeadlineTime] = useState('');
  const [tag, setTag]                   = useState('');
  const [durationValue, setDurationValue] = useState<number>(-1);
  const [customMinutes, setCustomMinutes] = useState('');
  const [priority, setPriority]         = useState<Priority>('medium');
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [success, setSuccess]           = useState(false);
  const [customTags, setCustomTags]     = useState<string[]>([]);

  useEffect(() => { setCustomTags(getUserTags()); }, []);

  const isAiEstimate = durationValue === -1;
  const isCustom = durationValue === 0;
  const estimatedMinutes = isCustom ? parseInt(customMinutes, 10) || 0 : isAiEstimate ? 0 : durationValue;
  const isQueueMode = !!onQueue;

  // Build ISO deadline: date required, time optional (defaults to midnight)
  function buildDeadline(): string | undefined {
    if (!deadlineDate) return undefined;
    const time = deadlineTime || '00:00';
    return new Date(`${deadlineDate}T${time}:00`).toISOString();
  }

  function resetForm() {
    setTitle('');
    setDescription('');
    setDeadlineDate('');
    setDeadlineTime('');
    setTag('');
    setDurationValue(60);
    setCustomMinutes('');
    setPriority('medium');
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!title.trim())                             return setError('Task title is required.');
    if (!deadlineDate)                             return setError('Deadline date is required.');
    if (!isAiEstimate && estimatedMinutes < 1)     return setError('Please enter a valid duration.');

    // Queue mode: collect data without API call
    if (isQueueMode) {
      if (tag.trim()) {
        saveUserTag(tag.trim());
        setCustomTags(getUserTags());
      }
      onQueue({
        title:           title.trim(),
        description:     description.trim() || undefined,
        tag:             tag.trim() || undefined,
        estimatedMinutes: isAiEstimate ? undefined : estimatedMinutes,
        priority,
        deadline:        buildDeadline(),
      });
      resetForm();
      setSuccess(true);
      setTimeout(() => setSuccess(false), 1500);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/tasks/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:            title.trim(),
          description:      description.trim() || undefined,
          tag:              tag.trim() || undefined,
          estimatedMinutes: isAiEstimate ? undefined : estimatedMinutes,
          priority,
          deadline:         buildDeadline(),
        }),
      });

      if (!res.ok) {
        let errMsg = 'Failed to create task';
        try { const d = await res.json() as { error?: string }; errMsg = d.error ?? errMsg; } catch { /* non-JSON */ }
        throw new Error(errMsg);
      }

      const task: TaskRow = await res.json();
      if (tag.trim()) {
        saveUserTag(tag.trim());
        setCustomTags(getUserTags());
      }
      onTaskCreated(task);

      // Reset form
      resetForm();
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-full flex flex-col">
      {!hideHeader && (
        <div className="px-5 py-4 border-b border-surface-200 flex-shrink-0">
          <h2 className="text-base font-bold text-surface-900">Add New Task</h2>
          <p className="text-xs text-surface-500 mt-0.5">Auto-schedules into your free time</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {/* Task Title */}
        <div>
          <label className="block text-sm font-medium text-surface-700 mb-1">
            Task Title <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Circuits Homework"
            className="w-full px-3 py-2.5 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-surface-900 placeholder:text-surface-400"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-surface-700 mb-1">
            Description <span className="text-surface-400 text-xs">(optional)</span>
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Any notes about this task…"
            rows={2}
            className="w-full px-3 py-2.5 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-surface-900 placeholder:text-surface-400 resize-none"
          />
        </div>

        {/* Deadline — split into date + optional time */}
        <div>
          <label className="block text-sm font-medium text-surface-700 mb-1">
            Deadline <span className="text-red-400">*</span>
          </label>
          <div className="flex gap-2">
            <input
              type="date"
              value={deadlineDate}
              onChange={(e) => setDeadlineDate(e.target.value)}
              className="flex-1 px-3 py-2.5 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-surface-900"
            />
            <input
              type="time"
              value={deadlineTime}
              onChange={(e) => setDeadlineTime(e.target.value)}
              placeholder="Time (optional)"
              className="w-32 px-3 py-2.5 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-surface-900"
            />
          </div>
          <p className="text-xs text-surface-400 mt-1">Time defaults to midnight if left blank</p>
        </div>

        {/* Tag — freeform with suggestions */}
        <div>
          <label className="block text-sm font-medium text-surface-700 mb-1">
            Tag <span className="text-surface-400 text-xs">(optional)</span>
          </label>
          <input
            type="text"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            placeholder="e.g. Study, Work, or anything…"
            className="w-full px-3 py-2.5 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-surface-900 placeholder:text-surface-400"
          />
          {/* Suggestion pills */}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {SUGGESTED_TAGS.map((s) => {
              const color = getTagColor(s);
              const isActive = tag === s;
              return (
                <button
                  key={s}
                  type="button"
                  onMouseDown={() => setTag(s)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                    isActive
                      ? `${color.bg} ${color.text} ${color.border} border`
                      : 'border-surface-200 text-surface-600 hover:border-surface-300 hover:bg-surface-50'
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: color.hex }}
                  />
                  {s}
                </button>
              );
            })}
            {customTags.length > 0 && (
              <>
                <span className="self-center text-surface-300 text-xs select-none">·</span>
                {customTags.map((s) => {
                  const isActive = tag === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onMouseDown={() => setTag(s)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                        isActive
                          ? 'border-teal-500 bg-teal-50 text-teal-800'
                          : 'border-surface-200 text-surface-600 hover:border-surface-300 hover:bg-surface-50'
                      }`}
                    >
                      {s}
                    </button>
                  );
                })}
              </>
            )}
          </div>
        </div>

        {/* Estimated Duration */}
        <div>
          <label className="block text-sm font-medium text-surface-700 mb-1">
            Estimated Duration
          </label>
          <select
            value={durationValue}
            onChange={(e) => setDurationValue(Number(e.target.value))}
            className="w-full px-3 py-2.5 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-surface-900 bg-white"
          >
            {DURATION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {isAiEstimate && (
            <p className="mt-1 text-xs text-teal-600">
              AI will estimate based on your task title and description
            </p>
          )}
          {isCustom && (
            <input
              type="number"
              value={customMinutes}
              onChange={(e) => setCustomMinutes(e.target.value)}
              placeholder="Minutes (e.g. 45)"
              min={1}
              className="mt-2 w-full px-3 py-2.5 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-surface-900 placeholder:text-surface-400"
            />
          )}
        </div>

        {/* Priority */}
        <div>
          <label className="block text-sm font-medium text-surface-700 mb-2">Priority</label>
          <div className="flex gap-2">
            {PRIORITY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPriority(opt.value)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium rounded-lg border transition-colors ${
                  priority === opt.value
                    ? 'border-teal-500 bg-teal-50 text-teal-800'
                    : 'border-surface-200 text-surface-600 hover:border-surface-300 hover:bg-surface-50'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${opt.dot}`} />
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Error / Success */}
        {error && (
          <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
        )}
        {success && (
          <p className="text-sm text-teal-700 bg-teal-50 px-3 py-2 rounded-lg font-medium">
            {isQueueMode ? 'Added to queue!' : 'Task added and scheduled!'}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Scheduling…' : isQueueMode ? '+ Add to Queue' : '+ Add & Auto-Schedule'}
        </button>
      </form>
    </div>
  );
}

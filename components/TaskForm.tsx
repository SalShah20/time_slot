'use client';

import { useState } from 'react';
import type { TaskRow } from '@/types/timer';

interface Props {
  onTaskCreated: (task: TaskRow) => void;
  hideHeader?: boolean;
}

const DURATION_OPTIONS = [
  { label: '30 min',  value: 30 },
  { label: '1 hour',  value: 60 },
  { label: '2 hours', value: 120 },
  { label: '3 hours', value: 180 },
  { label: '4 hours', value: 240 },
  { label: 'Custom',  value: 0 },
];

type Tag = 'Study' | 'Work' | 'Personal' | 'Exercise' | 'Other';

const PRIORITY_OPTIONS = [
  { label: 'Low',    value: 'low',    dot: 'bg-green-500' },
  { label: 'Medium', value: 'medium', dot: 'bg-amber-400' },
  { label: 'High',   value: 'high',   dot: 'bg-red-500'   },
] as const;
type Priority = 'low' | 'medium' | 'high';

export default function TaskForm({ onTaskCreated, hideHeader = false }: Props) {
  const [title, setTitle]               = useState('');
  const [description, setDescription]   = useState('');
  const [deadline, setDeadline]         = useState('');
  const [tag, setTag]                   = useState<Tag | ''>('');
  const [durationValue, setDurationValue] = useState<number>(60);
  const [customMinutes, setCustomMinutes] = useState('');
  const [priority, setPriority]         = useState<Priority>('medium');
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [success, setSuccess]           = useState(false);

  const isCustom = durationValue === 0;
  const estimatedMinutes = isCustom ? parseInt(customMinutes, 10) || 0 : durationValue;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!title.trim())        return setError('Task title is required.');
    if (!tag)                 return setError('Please select a tag.');
    if (!deadline)            return setError('Deadline is required.');
    if (estimatedMinutes < 1) return setError('Please enter a valid duration.');

    setLoading(true);
    try {
      const res = await fetch('/api/tasks/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          tag,
          estimatedMinutes,
          priority,
          deadline: deadline ? new Date(deadline).toISOString() : undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Failed to create task');
      }

      const task: TaskRow = await res.json();
      onTaskCreated(task);

      // Reset form
      setTitle('');
      setDescription('');
      setDeadline('');
      setTag('');
      setDurationValue(60);
      setCustomMinutes('');
      setPriority('medium');
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

        {/* Deadline */}
        <div>
          <label className="block text-sm font-medium text-surface-700 mb-1">
            Deadline <span className="text-red-400">*</span>
          </label>
          <input
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className="w-full px-3 py-2.5 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-surface-900"
          />
        </div>

        {/* Tag */}
        <div>
          <label className="block text-sm font-medium text-surface-700 mb-1">
            Tag <span className="text-red-400">*</span>
          </label>
          <select
            value={tag}
            onChange={(e) => setTag(e.target.value as Tag | '')}
            className="w-full px-3 py-2.5 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-surface-900 bg-white"
          >
            <option value="">Select tag…</option>
            <option value="Study">📚 Study</option>
            <option value="Work">💼 Work</option>
            <option value="Personal">🏠 Personal</option>
            <option value="Exercise">🏃 Exercise</option>
            <option value="Other">📌 Other</option>
          </select>
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
            Task added and scheduled!
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Scheduling…' : '+ Add & Auto-Schedule'}
        </button>
      </form>
    </div>
  );
}

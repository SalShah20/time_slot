'use client';

import { useState, useEffect } from 'react';
import type { TaskRow } from '@/types/timer';
import { getTagColor } from '@/lib/tagColors';

interface Props {
  task: TaskRow | null;
  onClose: () => void;
  onSave: () => void;
}

const SUGGESTED_TAGS = ['Study', 'Work', 'Personal', 'Exercise', 'Health', 'Social', 'Errands', 'Other'];

const DURATION_OPTIONS = [
  { label: '15 min',  value: 15 },
  { label: '30 min',  value: 30 },
  { label: '45 min',  value: 45 },
  { label: '1 hour',  value: 60 },
  { label: '90 min',  value: 90 },
  { label: '2 hours', value: 120 },
  { label: '3 hours', value: 180 },
  { label: 'Custom',  value: 0 },
];

const PRIORITY_OPTIONS = [
  { label: 'Low',    value: 'low',    dot: 'bg-green-500' },
  { label: 'Medium', value: 'medium', dot: 'bg-amber-400' },
  { label: 'High',   value: 'high',   dot: 'bg-red-500'   },
] as const;

type Priority = 'low' | 'medium' | 'high';

function parseIsoToLocal(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  const d = new Date(iso);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return { date, time };
}

export default function TaskEditModal({ task, onClose, onSave }: Props) {
  const [title, setTitle]                   = useState('');
  const [tag, setTag]                       = useState('');
  const [priority, setPriority]             = useState<Priority>('medium');
  const [deadlineDate, setDeadlineDate]     = useState('');
  const [deadlineTime, setDeadlineTime]     = useState('');
  const [durationValue, setDurationValue]   = useState<number>(60);
  const [customMinutes, setCustomMinutes]   = useState('');
  const [startDate, setStartDate]           = useState('');
  const [startTime, setStartTime]           = useState('');
  const [loading, setLoading]               = useState(false);
  const [deleting, setDeleting]             = useState(false);
  const [error, setError]                   = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete]   = useState(false);

  // Pre-fill form when task changes
  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setTag(task.tag ?? '');
    setPriority((task.priority as Priority) ?? 'medium');

    const dl = parseIsoToLocal(task.deadline);
    setDeadlineDate(dl.date);
    setDeadlineTime(dl.time);

    const mins = task.estimated_minutes;
    const preset = DURATION_OPTIONS.find((o) => o.value === mins && o.value !== 0);
    if (preset) {
      setDurationValue(mins);
      setCustomMinutes('');
    } else {
      setDurationValue(0);
      setCustomMinutes(String(mins));
    }

    const st = parseIsoToLocal(task.scheduled_start);
    setStartDate(st.date);
    setStartTime(st.time);

    setError(null);
    setConfirmDelete(false);
  }, [task]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!task) return null;

  const isCustom = durationValue === 0;
  const estimatedMinutes = isCustom ? (parseInt(customMinutes, 10) || 0) : durationValue;

  function buildDeadline(): string | undefined {
    if (!deadlineDate) return undefined;
    const time = deadlineTime || '00:00';
    return new Date(`${deadlineDate}T${time}:00`).toISOString();
  }

  function buildScheduledStart(): string | undefined {
    if (!startDate || !startTime) return undefined;
    return new Date(`${startDate}T${startTime}:00`).toISOString();
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!task) return;
    if (!title.trim()) return setError('Title is required');
    if (isCustom && estimatedMinutes < 1) return setError('Please enter a valid duration');

    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        title:    title.trim(),
        tag:      tag.trim() || null,
        priority,
        deadline: buildDeadline() ?? null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
      if (estimatedMinutes > 0) body.estimatedMinutes = estimatedMinutes;
      const newStart = buildScheduledStart();
      if (newStart) body.scheduledStart = newStart;

      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let errMsg = 'Failed to save';
        try { const d = await res.json() as { error?: string }; errMsg = d.error ?? errMsg; } catch { /* non-JSON */ }
        throw new Error(errMsg);
      }
      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!task) return;
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
      if (!res.ok) {
        let errMsg = 'Failed to delete';
        try { const d = await res.json() as { error?: string }; errMsg = d.error ?? errMsg; } catch { /* non-JSON */ }
        throw new Error(errMsg);
      }
      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />

      {/* Modal */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl shadow-2xl max-h-[90vh] flex flex-col">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 bg-surface-200 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-100 flex-shrink-0">
          <h2 className="text-base font-bold text-surface-900">Edit Task</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-surface-400 hover:text-surface-600 hover:bg-surface-100 transition-colors text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto px-5 py-4 space-y-4 pb-6">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">
              Task Title <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2.5 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-surface-900"
            />
          </div>

          {/* Tag */}
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">
              Tag <span className="text-surface-400 text-xs">(optional)</span>
            </label>
            <input
              type="text"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="e.g. Study, Work…"
              className="w-full px-3 py-2.5 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-surface-900 placeholder:text-surface-400"
            />
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
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color.hex }} />
                    {s}
                  </button>
                );
              })}
            </div>
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

          {/* Deadline */}
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">
              Deadline <span className="text-surface-400 text-xs">(optional)</span>
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
                className="w-32 px-3 py-2.5 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-surface-900"
              />
            </div>
          </div>

          {/* Duration */}
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">Duration</label>
            <select
              value={durationValue}
              onChange={(e) => setDurationValue(Number(e.target.value))}
              className="w-full px-3 py-2.5 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-surface-900 bg-white"
            >
              {DURATION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
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

          {/* Scheduled Start */}
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">
              Scheduled Start <span className="text-surface-400 text-xs">(optional — leave blank to keep current)</span>
            </label>
            <div className="flex gap-2">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="flex-1 px-3 py-2.5 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-surface-900"
              />
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-32 px-3 py-2.5 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-surface-900"
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
          )}

          {/* Save */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Saving…' : 'Save Changes'}
          </button>

          {/* Delete */}
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className={`w-full py-2.5 text-sm font-semibold rounded-lg border transition-colors disabled:opacity-50 ${
              confirmDelete
                ? 'bg-red-600 text-white border-red-600 hover:bg-red-700'
                : 'text-red-500 border-red-200 hover:bg-red-50'
            }`}
          >
            {deleting ? 'Deleting…' : confirmDelete ? 'Confirm Delete' : 'Delete Task'}
          </button>

          {confirmDelete && (
            <p className="text-xs text-center text-surface-500">
              Click again to confirm. This will also remove the task from Google Calendar.
            </p>
          )}
        </form>
      </div>
    </>
  );
}

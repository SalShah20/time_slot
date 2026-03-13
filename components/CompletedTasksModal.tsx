'use client';

import { useState, useEffect, useCallback } from 'react';
import { getTagColor } from '@/lib/tagColors';

interface CompletedTask {
  id: string;
  title: string;
  tag: string | null;
  priority: string | null;
  updated_at: string;
  actual_duration: number | null;
  estimated_minutes: number;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(minutes: number): string {
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${minutes}m`;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onTaskUndone: () => void;
}

export default function CompletedTasksModal({ isOpen, onClose, onTaskUndone }: Props) {
  const [tasks, setTasks] = useState<CompletedTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [undoing, setUndoing] = useState<string | null>(null);

  const fetchCompleted = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tasks/completed');
      if (res.ok) setTasks(await res.json());
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  }, []);

  // Lazy fetch: only when modal opens
  useEffect(() => {
    if (isOpen) {
      void fetchCompleted();
      setSearch('');
    }
  }, [isOpen, fetchCompleted]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  async function handleMarkIncomplete(taskId: string) {
    setUndoing(taskId);
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'pending' }),
      });
      if (res.ok) {
        setTasks((prev) => prev.filter((t) => t.id !== taskId));
        onTaskUndone();
      }
    } catch {
      // non-fatal
    } finally {
      setUndoing(null);
    }
  }

  if (!isOpen) return null;

  const searchLower = search.toLowerCase();
  const filtered = searchLower
    ? tasks.filter((t) => t.title.toLowerCase().includes(searchLower))
    : tasks;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3 flex-shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-surface-900">Completed Tasks</h2>
            <span className="text-xs font-medium text-surface-400 bg-surface-100 px-2 py-0.5 rounded-full">
              {tasks.length} completed
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-surface-400 hover:text-surface-600 hover:bg-surface-100 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="px-6 pb-3 flex-shrink-0">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search completed tasks..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-surface-50 border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-surface-900 placeholder:text-surface-400"
            />
          </div>
        </div>

        {/* Task list */}
        <div className="flex-1 overflow-y-auto px-6 pb-5">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <svg className="w-6 h-6 text-surface-300 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-12 h-12 bg-surface-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm text-surface-500 font-medium">
                {search ? 'No matching tasks' : 'No completed tasks yet. Finish something!'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-surface-100">
              {filtered.map((task) => {
                const tagColor = task.tag ? getTagColor(task.tag) : null;
                return (
                  <div key={task.id} className="group flex items-start gap-3 py-3">
                    {/* Check circle */}
                    <div className="flex-shrink-0 w-5 h-5 rounded-full bg-teal-500 flex items-center justify-center mt-0.5">
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-surface-400 line-through truncate">{task.title}</p>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        {tagColor && task.tag && (
                          <span className={`text-xs px-1.5 py-0.5 rounded-full ${tagColor.bg} ${tagColor.text}`}>
                            {task.tag}
                          </span>
                        )}
                        <span className="text-xs text-surface-400">
                          Completed {formatRelativeTime(task.updated_at)}
                        </span>
                        {task.actual_duration != null && task.actual_duration > 0 && (
                          <span className="text-xs text-surface-400">
                            &middot; took {formatDuration(task.actual_duration)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Undo button — visible on hover */}
                    <button
                      onClick={() => void handleMarkIncomplete(task.id)}
                      disabled={undoing === task.id}
                      className="opacity-0 group-hover:opacity-100 flex-shrink-0 text-xs text-teal-600 hover:underline transition-opacity mt-0.5 disabled:opacity-50"
                    >
                      {undoing === task.id ? 'Undoing...' : 'Mark incomplete'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

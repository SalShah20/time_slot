'use client';

import { useState } from 'react';
import type { TaskInput } from '@/components/TaskForm';

interface Props {
  onTasksQueued: (tasks: TaskInput[]) => void;
  onSwitchToForm: () => void;
}

export default function BrainDumpInput({ onTasksQueued, onSwitchToForm }: Props) {
  const [input, setInput]     = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [hintsOpen, setHintsOpen] = useState(false);

  async function handleSubmit() {
    const trimmed = input.trim();
    if (!trimmed) return;
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      const res = await fetch('/api/tasks/brain-dump', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input:    trimmed,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });

      let data: { tasks?: TaskInput[]; error?: string } = {};
      try { data = await res.json() as typeof data; } catch { /* non-JSON */ }

      if (!res.ok) throw new Error(data.error ?? 'Failed to parse tasks');

      const tasks = data.tasks ?? [];
      if (tasks.length === 0) throw new Error('No tasks found — try being more specific');

      onTasksQueued(tasks);
      setInput('');
      setSuccess(`Parsed ${tasks.length} task${tasks.length !== 1 ? 's' : ''} — review below then schedule`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Hint above textarea */}
      <div>
        <p className="text-sm font-semibold text-teal-600">
          Just type naturally — AI extracts your tasks.
        </p>
        <p className="text-xs text-surface-500 mt-0.5">
          Write a paragraph, a list, or anything — include deadlines, durations, or priority if you want, or let AI estimate.
        </p>
      </div>

      {/* Textarea */}
      <div className="relative">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void handleSubmit();
            }
          }}
          placeholder={"I need to finish my CS homework by Friday (probably 2 hours), study for the exam tomorrow, hit the gym at some point, and I should submit that job app by Monday."}
          rows={7}
          className="w-full px-3 py-3 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-surface-900 placeholder:text-surface-400 resize-none leading-relaxed"
          style={{ fontSize: '16px', minHeight: '180px' }}
        />
        {input.trim() && (
          <span className="absolute bottom-2.5 right-3 text-xs text-surface-400 pointer-events-none bg-white px-1">
            {'\u2318\u21B5'}
          </span>
        )}
      </div>

      {/* Feedback */}
      {error && (
        <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
      )}
      {success && (
        <p className="text-sm text-teal-700 bg-teal-50 px-3 py-2 rounded-lg font-medium">{success}</p>
      )}

      {/* Collapsible "What can I include?" hint */}
      <div>
        <button
          type="button"
          onClick={() => setHintsOpen((v) => !v)}
          className="text-xs text-teal-600 underline underline-offset-2 cursor-pointer hover:text-teal-700 transition-colors"
        >
          {hintsOpen ? 'Hide hints' : 'What can I include?'}
        </button>
        {hintsOpen && (
          <div className="mt-2 bg-teal-50 rounded-lg px-3 py-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-surface-600">
            <div>
              <span className="font-medium text-surface-700">Deadlines</span>
              <p className="text-surface-500">&ldquo;by Friday&rdquo;, &ldquo;due tomorrow&rdquo;, &ldquo;end of week&rdquo;</p>
            </div>
            <div>
              <span className="font-medium text-surface-700">Duration</span>
              <p className="text-surface-500">&ldquo;2 hours&rdquo;, &ldquo;30 mins&rdquo;, &ldquo;quick&rdquo;</p>
            </div>
            <div>
              <span className="font-medium text-surface-700">Priority</span>
              <p className="text-surface-500">&ldquo;urgent&rdquo;, &ldquo;high priority&rdquo;, &ldquo;when I have time&rdquo;</p>
            </div>
            <div>
              <span className="font-medium text-surface-700">Tag</span>
              <p className="text-surface-500">&ldquo;for work&rdquo;, &ldquo;personal&rdquo;, &ldquo;study&rdquo;</p>
            </div>
          </div>
        )}
      </div>

      {/* Submit */}
      <button
        onClick={() => void handleSubmit()}
        disabled={!input.trim() || loading}
        className="w-full py-2.5 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Scheduling…
          </>
        ) : (
          <>
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
            </svg>
            Schedule My Tasks
          </>
        )}
      </button>

      {/* Bottom hint + form toggle */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onSwitchToForm}
          className="flex-shrink-0 text-xs text-teal-600 hover:text-teal-700 font-medium whitespace-nowrap underline-offset-2 hover:underline"
        >
          Use form instead
        </button>
      </div>
    </div>
  );
}

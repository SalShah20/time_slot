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
          placeholder={"Type your tasks naturally…\n\n• Finish CS homework by Friday 2 hours\n• Study for exam tomorrow high priority\n• Gym workout 1hr personal\n• Submit job app Monday work"}
          rows={7}
          className="w-full px-3 py-3 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-surface-900 placeholder:text-surface-400 resize-none leading-relaxed"
          style={{ fontSize: '16px', minHeight: '180px' }}
        />
        {input.trim() && (
          <span className="absolute bottom-2.5 right-3 text-xs text-surface-400 pointer-events-none bg-white px-1">
            ⌘↵
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

      {/* Hint */}
      <p className="text-xs text-surface-400">
        One task per line. Write naturally — AI figures out the rest.
      </p>

      {/* Submit */}
      <button
        onClick={() => void handleSubmit()}
        disabled={!input.trim() || loading}
        className="w-full py-2.5 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            AI is parsing…
          </>
        ) : (
          <>
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
            </svg>
            Parse Tasks with AI
          </>
        )}
      </button>

      {/* Tips + form toggle */}
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-surface-500 leading-relaxed">
          Write naturally: deadlines (&ldquo;by Friday&rdquo;), duration (&ldquo;2 hours&rdquo;), priority (&ldquo;urgent&rdquo;).
        </p>
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

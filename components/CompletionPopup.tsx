'use client';

import { useState } from 'react';
import type { CompletionStats } from '@/types/timer';

type Difficulty = 'harder' | 'right' | 'easy';

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
}

const MOTIVATIONAL: string[] = [
  'Locked in.',
  "That's how it's done.",
  'One down.',
  'Keep the momentum.',
  'Good work.',
];

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

interface Props {
  stats: CompletionStats | null;
  onDismiss: () => void;
  onStartNewTask: () => void;
}

export default function CompletionPopup({ stats, onDismiss, onStartNewTask }: Props) {
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);

  if (!stats) return null;

  const { taskId, taskTitle, estimatedMinutes, actualWorkSeconds, totalBreakSeconds } = stats;
  const motivational = MOTIVATIONAL[hashId(taskId) % 5];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
        {/* Icon */}
        <div className="w-14 h-14 bg-teal-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-7 h-7 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h2 className="text-xl font-bold text-surface-900 mb-1">Task Complete!</h2>
        <p className="text-surface-500 text-sm mb-1 truncate max-w-full px-4" title={taskTitle}>
          {taskTitle}
        </p>
        <p className="text-sm font-medium text-teal-600 mb-5">{motivational}</p>

        {/* Session summary */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-surface-50 rounded-xl p-3">
            <p className="text-xs text-surface-500 mb-1">Work Time</p>
            <p className="text-lg font-bold text-surface-800">{formatDuration(actualWorkSeconds)}</p>
          </div>
          <div className="bg-surface-50 rounded-xl p-3">
            <p className="text-xs text-surface-500 mb-1">Break Time</p>
            <p className="text-lg font-bold text-surface-800">{totalBreakSeconds > 0 ? formatDuration(totalBreakSeconds) : '—'}</p>
          </div>
        </div>

        <p className="text-xs text-surface-400 mb-5">
          Estimated {estimatedMinutes}m &middot; Actual {formatDuration(actualWorkSeconds)}
        </p>

        {/* Difficulty rating */}
        <div className="mb-5">
          <p className="text-sm font-medium text-surface-700 mb-2">How&apos;d it go?</p>
          <div className="flex gap-2">
            {(
              [
                { value: 'harder', label: 'Harder', bg: 'bg-red-50 border-red-200 text-red-700', active: 'border-red-400 bg-red-100' },
                { value: 'right',  label: 'Right',  bg: 'bg-surface-50 border-surface-200 text-surface-700', active: 'border-teal-400 bg-teal-50 text-teal-700' },
                { value: 'easy',   label: 'Easy',   bg: 'bg-green-50 border-green-200 text-green-700', active: 'border-green-400 bg-green-100' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                onClick={() => setDifficulty(opt.value)}
                className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-colors ${
                  difficulty === opt.value ? opt.active : opt.bg
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onDismiss}
            className="flex-1 px-4 py-2.5 border border-surface-300 text-surface-700 rounded-lg hover:bg-surface-50 transition-colors font-medium text-sm"
          >
            Done
          </button>
          <button
            onClick={onStartNewTask}
            className="flex-1 px-4 py-2.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors font-medium text-sm"
          >
            New Task
          </button>
        </div>
      </div>
    </div>
  );
}

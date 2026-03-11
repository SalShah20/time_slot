'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

function formatHour(h: number): string {
  if (h === 0 || h === 24) return '12:00 AM';
  if (h === 12) return '12:00 PM';
  return h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`;
}

function formatHalfHour(h: number): string {
  const whole = Math.floor(h);
  const isHalf = h % 1 !== 0;
  if (whole === 0 && !isHalf) return '12:00 AM';
  if (whole === 0 && isHalf) return '12:30 AM';
  if (whole === 12 && !isHalf) return '12:00 PM';
  if (whole === 12 && isHalf) return '12:30 PM';
  if (whole < 12) return `${whole}:${isHalf ? '30' : '00'} AM`;
  return `${whole - 12}:${isHalf ? '30' : '00'} PM`;
}

export default function SettingsPage() {
  const router = useRouter();
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [toast, setToast]       = useState<string | null>(null);

  const [workStartHour, setWorkStartHour]       = useState(8);
  const [workEndHour, setWorkEndHour]             = useState(23);
  const [workEndLateHour, setWorkEndLateHour]     = useState(3);

  useEffect(() => {
    fetch('/api/user/settings')
      .then((r) => r.json())
      .then((data: { workStartHour: number; workEndHour: number; workEndLateHour: number }) => {
        setWorkStartHour(data.workStartHour);
        setWorkEndHour(data.workEndHour);
        setWorkEndLateHour(data.workEndLateHour);
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch('/api/user/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workStartHour, workEndHour, workEndLateHour }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? 'Failed to save');
      }
      setToast('Working hours saved');
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Failed to save');
      setTimeout(() => setToast(null), 3000);
    } finally {
      setSaving(false);
    }
  }

  // Start options: 5am–11am in 1h increments
  const startOptions: number[] = [];
  for (let h = 5; h <= 11; h++) startOptions.push(h);

  // End options: 5pm–11pm in 1h increments
  const endOptions: number[] = [];
  for (let h = 17; h <= 23; h++) endOptions.push(h);

  // Late hour options
  const lateOptions = [0, 1, 2, 3, 4, 5, 6];

  const selectClass =
    'w-full border border-surface-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-surface-900 bg-white appearance-none';

  return (
    <div className="min-h-screen bg-surface-50">
      {/* Header */}
      <header className="bg-white border-b border-surface-200 px-6 py-3.5 flex items-center gap-3">
        <button
          onClick={() => router.push('/')}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-surface-400 hover:text-surface-700 hover:bg-surface-100 transition-colors"
          aria-label="Back"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-lg font-bold text-surface-900">Settings</h1>
      </header>

      <div className="max-w-lg mx-auto px-4 py-6">
        {loading ? (
          <div className="text-center py-12 text-surface-400 text-sm">Loading...</div>
        ) : (
          <div className="bg-white rounded-2xl border border-surface-200 shadow-sm p-6">
            <h2 className="text-base font-bold text-surface-900">Working Hours</h2>
            <p className="text-sm text-surface-500 mt-1">
              When should TimeSlot schedule your tasks?
            </p>

            <div className="mt-5 space-y-4">
              {/* Preferred start */}
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1.5">
                  Earliest start time
                </label>
                <select
                  value={workStartHour}
                  onChange={(e) => setWorkStartHour(Number(e.target.value))}
                  className={selectClass}
                >
                  {startOptions.map((h) => (
                    <option key={h} value={h}>{formatHour(h)}</option>
                  ))}
                </select>
              </div>

              {/* Preferred end */}
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1.5">
                  Latest preferred end time
                </label>
                <select
                  value={workEndHour}
                  onChange={(e) => setWorkEndHour(Number(e.target.value))}
                  className={selectClass}
                >
                  {endOptions.map((h) => (
                    <option key={h} value={h}>{formatHour(h)}</option>
                  ))}
                </select>
              </div>

              {/* Last resort cutoff */}
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1.5">
                  Latest ever (last resort only)
                </label>
                <select
                  value={workEndLateHour}
                  onChange={(e) => setWorkEndLateHour(Number(e.target.value))}
                  className={selectClass}
                >
                  {lateOptions.map((h) => (
                    <option key={h} value={h}>
                      {h === 0 ? '12:00 AM (midnight)' : formatHalfHour(h)}
                    </option>
                  ))}
                </select>
              </div>

              <p className="text-xs text-surface-400">
                Tasks are never scheduled between {formatHour(workEndLateHour)} and {formatHour(workStartHour)}.
              </p>
            </div>

            {/* Save */}
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="mt-6 w-full py-2.5 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-surface-900 text-white text-sm px-5 py-2.5 rounded-full shadow-lg z-50 pointer-events-none whitespace-nowrap">
          {toast}
        </div>
      )}
    </div>
  );
}

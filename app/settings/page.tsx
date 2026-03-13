'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

function formatHalfHour(h: number): string {
  if (h === 24) return '12:00 AM';
  const whole = Math.floor(h) % 24;
  const isHalf = h % 1 !== 0;
  if (whole === 0 && !isHalf) return '12:00 AM';
  if (whole === 0 && isHalf) return '12:30 AM';
  if (whole === 12 && !isHalf) return '12:00 PM';
  if (whole === 12 && isHalf) return '12:30 PM';
  if (whole < 12) return `${whole}:${isHalf ? '30' : '00'} AM`;
  return `${whole - 12}:${isHalf ? '30' : '00'} PM`;
}

/** Generate an array of half-hour values from `from` to `to` (inclusive). */
function halfHourRange(from: number, to: number): number[] {
  const result: number[] = [];
  for (let h = from; h <= to; h += 0.5) result.push(h);
  return result;
}

// Full 24-hour range in 30-min steps: 0, 0.5, 1, ..., 23.5
const allHalfHours = halfHourRange(0, 23.5);

interface CalendarInfo {
  id: string;
  summary: string;
  primary: boolean;
}

export default function SettingsPage() {
  const router = useRouter();
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [toast, setToast]       = useState<string | null>(null);

  const [workStartHour, setWorkStartHour]       = useState(8);
  const [workEndHour, setWorkEndHour]             = useState(23);
  const [workEndLateHour, setWorkEndLateHour]     = useState(3);

  const [calendars, setCalendars]         = useState<CalendarInfo[]>([]);
  const [calendarsLoading, setCalendarsLoading] = useState(true);
  const [calendarsError, setCalendarsError]     = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/user/settings')
      .then((r) => r.json())
      .then((data: { workStartHour: number; workEndHour: number; workEndLateHour: number }) => {
        setWorkStartHour(data.workStartHour);
        // Normalize legacy value 24 → 0
        setWorkEndHour(data.workEndHour === 24 ? 0 : data.workEndHour);
        setWorkEndLateHour(data.workEndLateHour);
      })
      .catch(() => null)
      .finally(() => setLoading(false));

    // Fetch connected calendars
    fetch('/api/calendar/calendars')
      .then(async (r) => {
        if (!r.ok) {
          if (r.status === 401) {
            setCalendarsError('not_connected');
          } else {
            setCalendarsError('failed');
          }
          return;
        }
        const data = await r.json() as { calendars: CalendarInfo[] };
        setCalendars(data.calendars);
      })
      .catch(() => setCalendarsError('failed'))
      .finally(() => setCalendarsLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch('/api/user/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workStartHour,
          workEndHour,
          workEndLateHour,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
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

  // Whether the blackout window is valid (late hour must be before start hour)
  const hasValidBlackout = workEndLateHour < workStartHour;

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

      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
        {loading ? (
          <div className="text-center py-12 text-surface-400 text-sm">Loading...</div>
        ) : (
          <>
            {/* Working Hours card */}
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
                    {allHalfHours.map((h) => (
                      <option key={h} value={h}>{formatHalfHour(h)}</option>
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
                    {allHalfHours.map((h) => (
                      <option key={h} value={h}>{formatHalfHour(h)}</option>
                    ))}
                  </select>
                </div>

                {/* Last resort cutoff */}
                <div>
                  <label className="block text-sm font-medium text-surface-700 mb-1.5">
                    Absolute latest (last resort only)
                  </label>
                  <select
                    value={workEndLateHour}
                    onChange={(e) => setWorkEndLateHour(Number(e.target.value))}
                    className={selectClass}
                  >
                    {allHalfHours.map((h) => (
                      <option key={h} value={h}>{formatHalfHour(h)}</option>
                    ))}
                  </select>
                </div>

                {hasValidBlackout ? (
                  <p className="text-xs text-surface-400">
                    Tasks are never scheduled between {formatHalfHour(workEndLateHour)} and {formatHalfHour(workStartHour)}.
                  </p>
                ) : (
                  <p className="text-xs text-amber-600">
                    The &ldquo;absolute latest&rdquo; time must be earlier than the &ldquo;earliest start&rdquo; time to create a blackout window. Without a blackout, tasks can be scheduled at any hour.
                  </p>
                )}
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

            {/* Connected Calendars card */}
            <div className="bg-white rounded-2xl border border-surface-200 shadow-sm p-6">
              <h2 className="text-base font-bold text-surface-900">Connected Calendars</h2>
              <p className="text-sm text-surface-500 mt-1">
                TimeSlot reads busy time from all your Google Calendars to avoid scheduling conflicts.
              </p>

              <div className="mt-4">
                {calendarsLoading ? (
                  <p className="text-sm text-surface-400">Loading calendars...</p>
                ) : calendarsError === 'not_connected' ? (
                  <div className="flex items-center gap-2 text-sm text-surface-500">
                    <div className="w-2 h-2 rounded-full bg-surface-300 flex-shrink-0" />
                    <span>Connect Google Calendar to enable</span>
                  </div>
                ) : calendarsError ? (
                  <p className="text-sm text-surface-400">Could not load calendars</p>
                ) : calendars.length === 0 ? (
                  <p className="text-sm text-surface-400">No calendars found</p>
                ) : (
                  <ul className="space-y-2">
                    {calendars.map((cal) => (
                      <li key={cal.id} className="flex items-center gap-2.5 text-sm text-surface-700">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                        <span className="truncate">
                          {cal.summary}
                          {cal.primary && (
                            <span className="ml-1.5 text-xs text-surface-400">(primary)</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </>
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

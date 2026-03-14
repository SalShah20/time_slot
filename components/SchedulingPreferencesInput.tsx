'use client';

import { useState, useEffect } from 'react';

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

function halfHourRange(from: number, to: number): number[] {
  const result: number[] = [];
  for (let h = from; h <= to; h += 0.5) result.push(h);
  return result;
}

const allHalfHours = halfHourRange(0, 23.5);

interface Prefs {
  schedulingContext: string | null;
  schedulingNotes: string | null;
  workStartHour: number;
  workEndHour: number;
  workEndLateHour: number;
  preferMornings: boolean;
  preferEvenings: boolean;
  avoidBackToBack: boolean;
}

const selectClass =
  'w-full border border-surface-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-surface-900 bg-white appearance-none';

export default function SchedulingPreferencesInput() {
  const [input, setInput]     = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingPrefs, setLoadingPrefs] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [saved, setSaved]     = useState(false);

  const [workStartHour, setWorkStartHour]   = useState(8);
  const [workEndHour, setWorkEndHour]       = useState(23);
  const [workEndLateHour, setWorkEndLateHour] = useState(3);

  const [schedulingNotes, setSchedulingNotes] = useState<string | null>(null);
  const [preferMornings, setPreferMornings]   = useState(false);
  const [preferEvenings, setPreferEvenings]   = useState(false);
  const [avoidBackToBack, setAvoidBackToBack] = useState(false);
  const [savedContext, setSavedContext]       = useState('');

  useEffect(() => {
    Promise.all([
      fetch('/api/user/scheduling-preferences').then((r) => r.json()) as Promise<Partial<Prefs>>,
      fetch('/api/user/settings').then((r) => r.json()) as Promise<{ workStartHour: number; workEndHour: number; workEndLateHour: number }>,
    ])
      .then(([prefs, settings]) => {
        // Time fields from settings API (authoritative)
        setWorkStartHour(settings.workStartHour);
        setWorkEndHour(settings.workEndHour === 24 ? 0 : settings.workEndHour);
        setWorkEndLateHour(settings.workEndLateHour);

        // NL prefs
        if (prefs.schedulingContext) {
          setInput(prefs.schedulingContext);
          setSavedContext(prefs.schedulingContext);
        }
        setSchedulingNotes(prefs.schedulingNotes ?? null);
        setPreferMornings(prefs.preferMornings ?? false);
        setPreferEvenings(prefs.preferEvenings ?? false);
        setAvoidBackToBack(prefs.avoidBackToBack ?? false);
      })
      .catch(() => null)
      .finally(() => setLoadingPrefs(false));
  }, []);

  async function handleSave() {
    setError(null);
    setSaved(false);
    setLoading(true);

    try {
      const paragraphChanged = input.trim() !== savedContext.trim();

      // If paragraph changed, parse it first (it also writes work hours to DB)
      if (paragraphChanged && input.trim()) {
        const nlRes = await fetch('/api/user/scheduling-preferences', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ context: input.trim() }),
        });
        const nlData = (await nlRes.json()) as { success?: boolean; parsed?: Record<string, unknown>; error?: string };
        if (!nlRes.ok) throw new Error(nlData.error ?? 'Failed to parse preferences');

        // Update local state from parsed result
        if (nlData.parsed) {
          const p = nlData.parsed;
          if (typeof p.work_start_hour === 'number') setWorkStartHour(p.work_start_hour);
          if (typeof p.work_end_hour === 'number') setWorkEndHour(p.work_end_hour);
          if (typeof p.work_end_late_hour === 'number') setWorkEndLateHour(p.work_end_late_hour);
          if (typeof p.prefer_mornings === 'boolean') setPreferMornings(p.prefer_mornings);
          if (typeof p.prefer_evenings === 'boolean') setPreferEvenings(p.prefer_evenings);
          if (typeof p.avoid_back_to_back === 'boolean') setAvoidBackToBack(p.avoid_back_to_back);
          if (typeof p.scheduling_notes === 'string') setSchedulingNotes(p.scheduling_notes);
        }

        setSavedContext(input.trim());
      }

      // Always save the current manual time field values (user may have overridden AI)
      const settingsRes = await fetch('/api/user/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workStartHour,
          workEndHour,
          workEndLateHour,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      if (!settingsRes.ok) {
        const data = (await settingsRes.json()) as { error?: string };
        throw new Error(data.error ?? 'Failed to save settings');
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  const hasValidBlackout = workEndLateHour < workStartHour;

  if (loadingPrefs) {
    return (
      <div className="bg-white rounded-2xl border border-surface-200 shadow-sm p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-5 bg-surface-100 rounded w-1/3" />
          <div className="h-3 bg-surface-100 rounded w-2/3" />
          <div className="h-24 bg-surface-50 rounded-lg" />
          <div className="h-10 bg-surface-100 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-surface-200 shadow-sm p-6">
      <h2 className="text-base font-bold text-surface-900">Your Schedule</h2>
      <p className="text-sm text-surface-500 mt-1">
        Tell us when you work &mdash; type it out or set times directly.
      </p>

      {/* NL textarea */}
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void handleSave();
          }
        }}
        placeholder={"I'm a night owl — don't schedule anything before 11am. I usually stop working around midnight but can stay up until 2am if needed. I prefer mornings for hard tasks and need breaks between sessions."}
        rows={3}
        className="w-full mt-4 px-3 py-2.5 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-surface-900 placeholder:text-surface-400 resize-none leading-relaxed"
        style={{ fontSize: '15px' }}
      />

      {/* Parsed summary pill */}
      {schedulingNotes && (
        <div className="mt-3 bg-teal-50 rounded-lg px-3 py-2 text-sm text-teal-800 flex flex-wrap items-center gap-1.5">
          <span className="font-medium">TimeSlot understood:</span>{' '}
          <span>{schedulingNotes}</span>
          {(preferMornings || preferEvenings || avoidBackToBack) && (
            <div className="flex flex-wrap gap-1.5 w-full mt-1.5">
              {preferMornings && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-teal-100 text-teal-700">
                  Prefers mornings
                </span>
              )}
              {preferEvenings && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-teal-100 text-teal-700">
                  Prefers evenings
                </span>
              )}
              {avoidBackToBack && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-teal-100 text-teal-700">
                  Breaks preferred
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Divider */}
      <div className="flex items-center gap-3 mt-5 mb-4">
        <div className="flex-1 h-px bg-surface-200" />
        <span className="text-xs text-surface-400">or adjust manually</span>
        <div className="flex-1 h-px bg-surface-200" />
      </div>

      {/* Manual time inputs */}
      <div className="space-y-4">
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
            The &ldquo;absolute latest&rdquo; time must be earlier than the &ldquo;earliest start&rdquo; to form a blackout window.
          </p>
        )}
      </div>

      {/* Feedback */}
      {error && (
        <p className="mt-3 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
      )}
      {saved && (
        <p className="mt-3 text-sm text-teal-700 bg-teal-50 px-3 py-2 rounded-lg font-medium">
          Schedule preferences saved.
        </p>
      )}

      {/* Single save button */}
      <button
        onClick={() => void handleSave()}
        disabled={loading}
        className="mt-5 w-full py-2.5 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Saving...
          </>
        ) : (
          'Save'
        )}
      </button>
    </div>
  );
}

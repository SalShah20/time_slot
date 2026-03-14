'use client';

import { useState, useEffect } from 'react';

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

export default function SchedulingPreferencesInput() {
  const [input, setInput]     = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingPrefs, setLoadingPrefs] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [saved, setSaved]     = useState(false);
  const [prefs, setPrefs]     = useState<Prefs | null>(null);

  useEffect(() => {
    fetch('/api/user/scheduling-preferences')
      .then((r) => r.json())
      .then((data: Partial<Prefs>) => {
        setPrefs({
          schedulingContext: data.schedulingContext ?? null,
          schedulingNotes:   data.schedulingNotes ?? null,
          workStartHour:     data.workStartHour ?? 8,
          workEndHour:       data.workEndHour ?? 23,
          workEndLateHour:   data.workEndLateHour ?? 3,
          preferMornings:    data.preferMornings ?? false,
          preferEvenings:    data.preferEvenings ?? false,
          avoidBackToBack:   data.avoidBackToBack ?? false,
        });
        if (data.schedulingContext) setInput(data.schedulingContext);
      })
      .catch(() => null)
      .finally(() => setLoadingPrefs(false));
  }, []);

  async function handleSave() {
    const trimmed = input.trim();
    if (!trimmed) return;
    setError(null);
    setSaved(false);
    setLoading(true);

    try {
      const res = await fetch('/api/user/scheduling-preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: trimmed }),
      });

      let data: { success?: boolean; parsed?: Record<string, unknown>; error?: string } = {};
      try { data = await res.json() as typeof data; } catch { /* non-JSON */ }

      if (!res.ok) throw new Error(data.error ?? 'Failed to save preferences');

      // Refresh displayed prefs
      const refreshRes = await fetch('/api/user/scheduling-preferences');
      const refreshed = await refreshRes.json() as Partial<Prefs>;
      setPrefs({
        schedulingContext: refreshed.schedulingContext ?? null,
        schedulingNotes:   refreshed.schedulingNotes ?? null,
        workStartHour:     refreshed.workStartHour ?? 8,
        workEndHour:       refreshed.workEndHour ?? 23,
        workEndLateHour:   refreshed.workEndLateHour ?? 3,
        preferMornings:    refreshed.preferMornings ?? false,
        preferEvenings:    refreshed.preferEvenings ?? false,
        avoidBackToBack:   refreshed.avoidBackToBack ?? false,
      });

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  const hasChanged = input.trim() !== (prefs?.schedulingContext ?? '').trim();

  return (
    <div className="bg-white rounded-2xl border border-surface-200 shadow-sm p-6">
      <h2 className="text-base font-bold text-surface-900">Scheduling Preferences</h2>
      <p className="text-sm text-surface-500 mt-1">
        Describe your schedule in plain English — AI will parse it into settings.
      </p>

      {loadingPrefs ? (
        <div className="mt-4 h-24 bg-surface-50 rounded-lg animate-pulse" />
      ) : (
        <>
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
            rows={4}
            className="w-full mt-4 px-3 py-2.5 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-surface-900 placeholder:text-surface-400 resize-none leading-relaxed"
            style={{ fontSize: '15px' }}
          />

          {/* Current parsed summary */}
          {prefs?.schedulingNotes && (
            <div className="mt-3 bg-teal-50 rounded-lg px-3 py-2.5 text-sm text-teal-800">
              <span className="font-medium">Current settings:</span>{' '}
              {prefs.schedulingNotes}
              {/* Parsed flags */}
              <div className="flex flex-wrap gap-1.5 mt-2">
                {prefs.preferMornings && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-teal-100 text-teal-700">
                    Prefers mornings
                  </span>
                )}
                {prefs.preferEvenings && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-teal-100 text-teal-700">
                    Prefers evenings
                  </span>
                )}
                {prefs.avoidBackToBack && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-teal-100 text-teal-700">
                    Avoids back-to-back
                  </span>
                )}
              </div>
            </div>
          )}

          {error && (
            <p className="mt-2 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
          )}
          {saved && (
            <p className="mt-2 text-sm text-teal-700 bg-teal-50 px-3 py-2 rounded-lg font-medium">
              Preferences saved and applied to scheduling.
            </p>
          )}

          <button
            onClick={() => void handleSave()}
            disabled={!input.trim() || loading || !hasChanged}
            className="mt-4 w-full py-2.5 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Analyzing...
              </>
            ) : (
              'Save Preferences'
            )}
          </button>

          <p className="mt-2 text-xs text-surface-400">
            This updates your working hours and scheduling flags automatically. You can also adjust them manually above.
          </p>
        </>
      )}
    </div>
  );
}

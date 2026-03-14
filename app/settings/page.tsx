'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import SchedulingPreferencesInput from '@/components/SchedulingPreferencesInput';
import CanvasSettings from '@/components/CanvasSettings';
import GoogleClassroomCard from '@/components/GoogleClassroomCard';

interface CalendarFilterItem {
  id: string;
  name: string;
  color: string | null;
  isPrimary: boolean;
  isIncluded: boolean;
}

export default function SettingsPage() {
  const router = useRouter();
  const [toast, setToast] = useState<string | null>(null);

  // Calendar filter state
  const [calFilters, setCalFilters]             = useState<CalendarFilterItem[]>([]);
  const [calFiltersLoading, setCalFiltersLoading] = useState(true);
  const [calFiltersError, setCalFiltersError]     = useState<string | null>(null);
  const [calFilterSaving, setCalFilterSaving]     = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/calendar/filter')
      .then(async (r) => {
        if (!r.ok) {
          setCalFiltersError(r.status === 401 ? 'not_connected' : 'failed');
          return;
        }
        const data = await r.json() as { calendars: CalendarFilterItem[] };
        setCalFilters(data.calendars);
      })
      .catch(() => setCalFiltersError('failed'))
      .finally(() => setCalFiltersLoading(false));
  }, []);

  async function handleToggleCalendar(cal: CalendarFilterItem) {
    const newValue = !cal.isIncluded;
    setCalFilterSaving(cal.id);
    setCalFilters((prev) =>
      prev.map((c) => c.id === cal.id ? { ...c, isIncluded: newValue } : c)
    );
    try {
      const res = await fetch('/api/calendar/filter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          calendarId: cal.id,
          calendarName: cal.name,
          isIncluded: newValue,
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      fetch('/api/calendar/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone: tz }),
      }).catch(() => { /* non-fatal */ });
    } catch {
      setCalFilters((prev) =>
        prev.map((c) => c.id === cal.id ? { ...c, isIncluded: !newValue } : c)
      );
      setToast('Failed to save calendar filter');
      setTimeout(() => setToast(null), 3000);
    } finally {
      setCalFilterSaving(null);
    }
  }

  return (
    <div className="min-h-screen bg-surface-50">
      {/* Header */}
      <header className="bg-white border-b border-surface-200 px-6 py-3.5 flex items-center gap-3">
        <button
          onClick={() => router.push('/dashboard')}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-surface-400 hover:text-surface-700 hover:bg-surface-100 transition-colors"
          aria-label="Back"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-lg font-bold text-surface-900">Settings</h1>
      </header>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {/* Unified Schedule card */}
        <SchedulingPreferencesInput />

        {/* Calendar Filtering card */}
        <div className="bg-white rounded-2xl border border-surface-200 shadow-sm p-6">
          <h2 className="text-base font-bold text-surface-900">Calendar Filtering</h2>
          <p className="text-sm text-surface-500 mt-1">
            Choose which calendars TimeSlot uses when scheduling.
          </p>

          <div className="mt-4">
            {calFiltersLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3 animate-pulse">
                    <div className="w-3 h-3 rounded-full bg-surface-200" />
                    <div className="flex-1 h-4 bg-surface-100 rounded" />
                    <div className="w-10 h-5 bg-surface-100 rounded-full" />
                  </div>
                ))}
              </div>
            ) : calFiltersError === 'not_connected' ? (
              <div className="text-sm text-surface-400 py-2">
                <a href="/api/calendar/oauth" className="text-teal-600 hover:text-teal-700 font-medium">
                  Connect Google Calendar
                </a>{' '}
                to manage calendar filtering.
              </div>
            ) : calFiltersError ? (
              <div className="text-sm text-surface-400 py-2">
                Could not load calendars. Make sure{' '}
                <a href="/api/calendar/oauth" className="text-teal-600 hover:text-teal-700 font-medium">
                  Google Calendar is connected
                </a>.
              </div>
            ) : calFilters.length === 0 ? (
              <p className="text-sm text-surface-400 py-2">No calendars found.</p>
            ) : (
              <div className="space-y-1">
                {calFilters.map((cal) => (
                  <div key={cal.id} className="flex items-center gap-3 py-2">
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: cal.color ?? '#6B7280' }}
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-surface-700 truncate block">
                        {cal.name}
                        {cal.isPrimary && (
                          <span className="ml-1.5 text-xs text-surface-400">(primary)</span>
                        )}
                      </span>
                    </div>
                    <button
                      onClick={() => void handleToggleCalendar(cal)}
                      disabled={cal.isPrimary || calFilterSaving === cal.id}
                      title={cal.isPrimary ? 'Your primary calendar is always included' : cal.isIncluded ? 'Click to exclude' : 'Click to include'}
                      className={`relative w-10 h-[22px] rounded-full transition-colors flex-shrink-0 ${
                        cal.isPrimary
                          ? 'bg-teal-400 opacity-60 cursor-not-allowed'
                          : cal.isIncluded
                          ? 'bg-teal-500 hover:bg-teal-600 cursor-pointer'
                          : 'bg-surface-300 hover:bg-surface-400 cursor-pointer'
                      }`}
                    >
                      <span
                        className={`absolute top-[3px] w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                          cal.isIncluded ? 'left-[22px]' : 'left-[3px]'
                        }`}
                      />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {!calFiltersError && !calFiltersLoading && calFilters.length > 0 && (
            <p className="text-xs text-surface-400 mt-4">
              Included calendars block off time so tasks won&apos;t be scheduled during those events. Changes take effect on the next sync.
            </p>
          )}
        </div>

        {/* Integrations section */}
        <div id="integrations">
          <h2 className="text-xs font-semibold text-surface-400 uppercase tracking-wider mb-3 px-1">
            Integrations
          </h2>
          <div className="space-y-3">
            <CanvasSettings />
            <GoogleClassroomCard />
          </div>
        </div>
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

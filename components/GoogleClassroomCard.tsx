'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export default function GoogleClassroomCard() {
  const [connected, setConnected]     = useState(false);
  const [scopeMissing, setScopeMissing] = useState(false);
  const [lastSynced, setLastSynced]   = useState<string | null>(null);
  const [syncing, setSyncing]         = useState(false);
  const [syncResult, setSyncResult]   = useState<string | null>(null);
  const [error, setError]             = useState<string | null>(null);
  const [loading, setLoading]         = useState(true);

  useEffect(() => {
    fetch('/api/integrations/classroom/status')
      .then((r) => r.json())
      .then((data: { connected: boolean; reason?: string; lastSynced?: string }) => {
        setConnected(data.connected);
        if (!data.connected && data.reason === 'scope_missing') {
          setScopeMissing(true);
        }
        if (data.lastSynced) setLastSynced(data.lastSynced);
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  const handleReauthorize = async () => {
    // Re-trigger Google OAuth with Classroom scopes added
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
        scopes: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/classroom.courses.readonly https://www.googleapis.com/auth/classroom.coursework.me.readonly',
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    });
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    setError(null);
    try {
      const res = await fetch('/api/integrations/classroom/sync', { method: 'POST' });
      const data = (await res.json()) as { count?: number; error?: string; message?: string };
      if (!res.ok) {
        if (res.status === 401) {
          setScopeMissing(true);
          setConnected(false);
        }
        setError(data.error ?? 'Sync failed');
        return;
      }
      if (data.count === 0) {
        setSyncResult(data.message ?? 'No new assignments found');
      } else {
        setSyncResult(`Imported ${data.count} new assignment${data.count !== 1 ? 's' : ''}`);
      }
      setLastSynced(new Date().toISOString());
    } catch {
      setError('Network error — try again');
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-surface-200 bg-white p-4 flex items-center gap-4 animate-pulse">
        <div className="w-11 h-11 rounded-lg bg-surface-100" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-surface-100 rounded w-1/3" />
          <div className="h-3 bg-surface-100 rounded w-2/3" />
        </div>
        <div className="w-16 h-8 bg-surface-100 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-surface-200 bg-white overflow-hidden">
      {/* Header row */}
      <div className="p-4 flex items-center gap-4">
        {/* Classroom icon */}
        <div className="rounded-lg p-2.5 flex-shrink-0" style={{ backgroundColor: '#F0FBF4' }}>
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none">
            <path d="M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82zM12 3L1 9l11 6 9-4.91V17h2V9L12 3z" fill="#1EA362"/>
          </svg>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-surface-900">Google Classroom</p>
            {connected && (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                Connected
              </span>
            )}
          </div>
          <p className="text-xs text-surface-500 mt-0.5 truncate">
            Auto-import assignments from your courses
          </p>
        </div>

        {/* Action button */}
        {connected ? (
          <button
            onClick={() => void handleSync()}
            disabled={syncing}
            className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white whitespace-nowrap hover:bg-teal-700 disabled:opacity-50 transition-colors"
          >
            {syncing ? 'Syncing...' : 'Sync Now'}
          </button>
        ) : (
          <button
            onClick={() => void handleReauthorize()}
            className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white whitespace-nowrap hover:bg-teal-700 transition-colors"
          >
            {scopeMissing ? 'Authorize' : 'Connect'}
          </button>
        )}
      </div>

      {/* Scope missing note */}
      {!connected && scopeMissing && (
        <div className="px-4 pb-4 pt-0 border-t border-surface-100">
          <p className="pt-3 text-xs text-surface-500">
            TimeSlot needs Classroom permissions. Click Authorize to grant access &mdash; your existing Calendar connection won&apos;t be affected.
          </p>
        </div>
      )}

      {/* Connected details */}
      {connected && (
        <div className="px-4 pb-4 pt-0 border-t border-surface-100">
          <div className="pt-3 space-y-2">
            {lastSynced && (
              <p className="text-xs text-surface-400">
                Last synced: {new Date(lastSynced).toLocaleString()}
              </p>
            )}
            {syncResult && <p className="text-xs text-green-600 font-medium">{syncResult}</p>}
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex items-center justify-between">
              <p className="text-xs text-surface-400">
                Assignments due in the next 2 weeks are imported as tasks.
              </p>
              <button
                onClick={async () => {
                  await fetch('/api/integrations/classroom/sync', { method: 'DELETE' });
                  setSyncResult(null);
                  void handleSync();
                }}
                disabled={syncing}
                className="text-xs text-surface-400 hover:text-teal-600 transition-colors whitespace-nowrap ml-2"
              >
                Re-import all
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error for non-connected */}
      {!connected && error && (
        <div className="px-4 pb-4 pt-0 border-t border-surface-100">
          <p className="pt-3 text-xs text-red-600">{error}</p>
        </div>
      )}
    </div>
  );
}

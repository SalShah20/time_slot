'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export default function CanvasSettings() {
  const [domain, setDomain]           = useState('');
  const [token, setToken]             = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [lastSynced, setLastSynced]   = useState<string | null>(null);
  const [syncing, setSyncing]         = useState(false);
  const [saving, setSaving]           = useState(false);
  const [syncResult, setSyncResult]   = useState<string | null>(null);
  const [error, setError]             = useState<string | null>(null);
  const [loading, setLoading]         = useState(true);
  const [expanded, setExpanded]       = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data } = await supabase
          .from('user_tokens')
          .select('canvas_domain, canvas_last_synced, canvas_token')
          .eq('user_id', user.id)
          .single();
        if ((data as Record<string, unknown> | null)?.canvas_token) {
          setIsConnected(true);
          setDomain(((data as Record<string, unknown>).canvas_domain as string) ?? '');
          setLastSynced(((data as Record<string, unknown>).canvas_last_synced as string) ?? null);
        }
      } catch {
        // non-fatal
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/integrations/canvas/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canvas_token: token, canvas_domain: domain }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Failed to connect Canvas');
        return;
      }
      setIsConnected(true);
      setToken('');
      setExpanded(false);
    } catch {
      setError('Network error — try again');
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    await fetch('/api/integrations/canvas/credentials', { method: 'DELETE' });
    setIsConnected(false);
    setDomain('');
    setLastSynced(null);
    setSyncResult(null);
    setError(null);
    setExpanded(false);
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    setError(null);
    try {
      const res = await fetch('/api/integrations/canvas/sync', { method: 'POST' });
      const data = (await res.json()) as { count?: number; error?: string; message?: string };
      if (!res.ok) {
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
        {/* Canvas icon */}
        <div className="rounded-lg p-2.5 flex-shrink-0" style={{ backgroundColor: '#FFF4EE' }}>
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" fill="#E66000"/>
          </svg>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-surface-900">Canvas LMS</p>
            {isConnected && (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                Connected
              </span>
            )}
          </div>
          <p className="text-xs text-surface-500 mt-0.5 truncate">
            Auto-import upcoming assignments as tasks
          </p>
        </div>

        {/* Action button */}
        {isConnected ? (
          <button
            onClick={() => void handleSync()}
            disabled={syncing}
            className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white whitespace-nowrap hover:bg-teal-700 disabled:opacity-50 transition-colors"
          >
            {syncing ? 'Syncing...' : 'Sync Now'}
          </button>
        ) : (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white whitespace-nowrap hover:bg-teal-700 transition-colors"
          >
            Connect
          </button>
        )}
      </div>

      {/* Expanded connect form */}
      {expanded && !isConnected && (
        <div className="px-4 pb-4 pt-0 border-t border-surface-100 space-y-3">
          <div className="pt-3">
            <label className="block text-xs font-medium text-surface-700 mb-1">
              Institution domain
            </label>
            <input
              type="text"
              placeholder="umn.instructure.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-surface-900 bg-white placeholder:text-surface-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-700 mb-1">
              Canvas API token
            </label>
            <input
              type="password"
              placeholder="Paste your token here"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-surface-900 bg-white placeholder:text-surface-400"
            />
            <p className="text-xs text-surface-400 mt-1">
              Generate in Canvas: Account &rarr; Settings &rarr; New Access Token
            </p>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button
            onClick={() => void handleSave()}
            disabled={!domain || !token || saving}
            className="w-full py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Connecting...' : 'Connect Canvas'}
          </button>
        </div>
      )}

      {/* Connected details */}
      {isConnected && (
        <div className="px-4 pb-4 pt-0 border-t border-surface-100">
          <div className="pt-3 space-y-2">
            <p className="text-xs text-surface-500">
              Connected to <span className="font-medium text-surface-700">{domain}</span>
            </p>
            {lastSynced && (
              <p className="text-xs text-surface-400">
                Last synced: {new Date(lastSynced).toLocaleString()}
              </p>
            )}
            {syncResult && <p className="text-xs text-green-600 font-medium">{syncResult}</p>}
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-surface-400">
                Imports assignments due in the next 2 weeks.
              </p>
              <div className="flex items-center gap-3 flex-shrink-0">
                <button
                  onClick={async () => {
                    await fetch('/api/integrations/canvas/sync', { method: 'DELETE' });
                    setSyncResult(null);
                    void handleSync();
                  }}
                  disabled={syncing}
                  className="text-xs text-surface-400 hover:text-teal-600 transition-colors"
                >
                  Re-import
                </button>
                <button
                  onClick={() => void handleDisconnect()}
                  className="text-xs text-surface-400 hover:text-red-600 transition-colors"
                >
                  Disconnect
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

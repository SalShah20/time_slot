'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

interface Props {
  isPremium: boolean;
}

export default function CanvasSettings({ isPremium }: Props) {
  const [domain, setDomain]           = useState('');
  const [token, setToken]             = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [lastSynced, setLastSynced]   = useState<string | null>(null);
  const [syncing, setSyncing]         = useState(false);
  const [saving, setSaving]           = useState(false);
  const [syncResult, setSyncResult]   = useState<string | null>(null);
  const [error, setError]             = useState<string | null>(null);
  const [loading, setLoading]         = useState(true);

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

  if (!isPremium) {
    return (
      <div className="bg-white rounded-2xl border border-dashed border-teal-300 shadow-sm p-6 text-center">
        <div className="w-10 h-10 bg-teal-50 rounded-lg flex items-center justify-center mx-auto mb-3">
          <svg className="w-5 h-5 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-surface-900">Canvas LMS</h3>
        <p className="text-xs text-surface-500 mt-1">
          Auto-import assignments from Canvas. Available on Premium.
        </p>
        <button className="mt-3 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 transition-colors">
          Upgrade to Premium
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-surface-200 shadow-sm p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-surface-100 rounded w-1/3" />
          <div className="h-3 bg-surface-100 rounded w-2/3" />
          <div className="h-9 bg-surface-100 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-surface-200 shadow-sm p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-surface-900">Canvas LMS</h2>
          <p className="text-sm text-surface-500 mt-0.5">
            Auto-import upcoming assignments as tasks
          </p>
        </div>
        {isConnected && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            Connected
          </span>
        )}
      </div>

      {!isConnected ? (
        <div className="mt-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1.5">
              Institution domain
            </label>
            <input
              type="text"
              placeholder="umn.instructure.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              className="w-full border border-surface-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-surface-900 bg-white placeholder:text-surface-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1.5">
              Canvas API token
            </label>
            <input
              type="password"
              placeholder="Paste your token here"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="w-full border border-surface-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-surface-900 bg-white placeholder:text-surface-400"
            />
            <p className="text-xs text-surface-400 mt-1.5">
              Generate in Canvas: Account &rarr; Settings &rarr; New Access Token
            </p>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button
            onClick={() => void handleSave()}
            disabled={!domain || !token || saving}
            className="w-full py-2.5 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Connecting...' : 'Connect Canvas'}
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-surface-500">
            Connected to <span className="font-medium text-surface-700">{domain}</span>
          </p>
          {lastSynced && (
            <p className="text-xs text-surface-400">
              Last synced: {new Date(lastSynced).toLocaleString()}
            </p>
          )}
          {syncResult && <p className="text-xs text-green-600 font-medium">{syncResult}</p>}
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => void handleSync()}
              disabled={syncing}
              className="flex-1 py-2.5 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
            >
              {syncing ? 'Syncing...' : 'Import Assignments'}
            </button>
            <button
              onClick={() => void handleDisconnect()}
              className="rounded-lg border border-surface-200 px-4 py-2.5 text-sm text-surface-600 hover:bg-surface-50 transition-colors"
            >
              Disconnect
            </button>
          </div>
          <p className="text-xs text-surface-400">
            Imports unsubmitted assignments due in the next 2 weeks. Already-imported assignments are skipped.
          </p>
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import ScheduleView from '@/components/ScheduleView';
import StatsCards from '@/components/StatsCards';
import CornerTimerWidget from '@/components/CornerTimerWidget';
import TimerSelector from '@/components/TimerSelector';
import CompletionPopup from '@/components/CompletionPopup';
import TaskDrawer from '@/components/TaskDrawer';
import TaskEditModal from '@/components/TaskEditModal';
import OnboardingTooltip from '@/components/OnboardingTooltip';
import InstallPrompt from '@/components/InstallPrompt';
import * as timer from '@/lib/timerService';
import { supabase } from '@/lib/supabase';
import type { TaskRow, CompletionStats, CalendarBlock } from '@/types/timer';
import {
  requestPermission,
  checkTaskStartingSoon,
  checkDeadlineApproaching,
  sendMorningSummary,
} from '@/lib/notifications';

export default function Home() {
  const router = useRouter();
  const [user, setUser]                           = useState<User | null>(null);
  const [tasks, setTasks]                         = useState<TaskRow[]>([]);
  // Per-date cache: Record<YYYY-MM-DD, CalendarBlock[]>.
  // Keyed by local date string so navigating back to a previously-viewed date
  // shows cached data instantly while the refresh is in flight (no blank flash).
  const [blocksCache, setBlocksCache]             = useState<Record<string, CalendarBlock[]>>({});
  const [loading, setLoading]                     = useState(true);
  const [completionStats, setCompletionStats]     = useState<CompletionStats | null>(null);
  const [showTimerSelector, setShowTimerSelector] = useState(false);
  const [timerActive, setTimerActive]             = useState(false);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [calendarSyncError, setCalendarSyncError] = useState(false);
  const [calendarSyncing, setCalendarSyncing]     = useState(false);
  const [showDrawer, setShowDrawer]               = useState(false);
  const [editingTask, setEditingTask]             = useState<TaskRow | null>(null);
  const [toast, setToast]                         = useState<string | null>(null);
  const [showUserMenu, setShowUserMenu]           = useState(false);
  const [selectedDate, setSelectedDate]           = useState(new Date());
  const [mobileView, setMobileView]               = useState<'tasks' | 'schedule'>('tasks');

  // Derive the YYYY-MM-DD key and current blocks from the cache.
  // Using local date components (not UTC) so it aligns with how fetchBlocks queries the server.
  const blocksDateKey = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(selectedDate.getDate()).padStart(2, '0')}`;
  const blocks = blocksCache[blocksDateKey] ?? [];

  const userMenuRef         = useRef<HTMLDivElement>(null);
  const hasSyncedRef        = useRef(false);
  const tasksRef            = useRef<TaskRow[]>([]); // always-current copy for notification callbacks
  const selectedDateRef     = useRef(selectedDate);  // always-current date for stable fetchBlocks
  const fetchBlocksAbortRef = useRef<AbortController | null>(null); // cancel stale in-flight fetches

  // Keep selectedDateRef in sync so fetchBlocks (stable identity) always sees the
  // currently-viewed date without needing selectedDate in its useCallback deps.
  useEffect(() => { selectedDateRef.current = selectedDate; }, [selectedDate]);

  // ── Auth ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    // getSession() returns the cached session with full user_metadata (avatar_url, etc.)
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Close user menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Calendar status ─────────────────────────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const justConnected = params.get('calendar') === 'connected';
    if (justConnected) {
      setCalendarConnected(true);
      window.history.replaceState({}, '', '/');
      // Explicitly sync + refresh blocks after OAuth return
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      fetch('/api/calendar/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone: tz }),
      })
        .then(() => fetchBlocks())
        .catch(() => null);
    }
    fetch('/api/calendar/status')
      .then((r) => r.json())
      .then((d) => { setCalendarConnected(!!d.connected); })
      .catch(() => null);
  // fetchBlocks is declared below but is stable (empty deps, never changes identity),
  // so omitting it is safe. Cannot reference it before declaration in the deps array.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync Google Calendar events ──────────────────────────────────────────────
  // Stable identity (no selectedDate dependency) — uses selectedDateRef for the default
  // date so callers that don't pass an explicit date always get the currently-viewed day.
  // AbortController cancels any previous in-flight fetch, so the last call always wins
  // and stale responses can never overwrite newer data.
  const fetchBlocks = useCallback(async (date?: Date) => {
    fetchBlocksAbortRef.current?.abort();
    const controller = new AbortController();
    fetchBlocksAbortRef.current = controller;
    try {
      const d = date ?? selectedDateRef.current;
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch(
        `/api/blocks?date=${dateStr}&timezone=${encodeURIComponent(timezone)}`,
        { signal: controller.signal },
      );
      if (res.ok) {
        const data = await res.json() as CalendarBlock[];
        setBlocksCache((prev) => ({ ...prev, [dateStr]: data }));
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return; // expected — a newer call took over
      console.error('[fetchBlocks]', err);
    }
  }, []); // stable — intentionally no deps; uses refs for mutable values

  const syncCalendar = useCallback(async () => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    try {
      const res = await fetch('/api/calendar/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone: tz }),
      });
      if (res.status === 401) {
        setCalendarSyncError(true);
        return;
      }
      setCalendarSyncError(false);
      await fetchBlocks();

      // After syncing, reschedule any pending tasks that conflict or are past-due
      const rescheduleRes = await fetch('/api/tasks/reschedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone: tz }),
      });
      if (rescheduleRes.ok) {
        const { rescheduled } = await rescheduleRes.json() as { rescheduled: number };
        if (rescheduled > 0) {
          showToast(`${rescheduled} task${rescheduled !== 1 ? 's' : ''} rescheduled to avoid calendar conflicts`);
        }
      }
      // Always refresh task list after sync so the calendar reflects current scheduled times
      await fetchTasks();
    } catch {
      // network error — ignore silently
    }
  // fetchTasks is declared below but is stable (empty deps), safe to omit from deps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchBlocks]);

  const handleManualSync = useCallback(async () => {
    setCalendarSyncing(true);
    try { await syncCalendar(); } finally { setCalendarSyncing(false); }
  }, [syncCalendar]);

  // Initial sync when calendar first connects
  useEffect(() => {
    if (calendarConnected && !hasSyncedRef.current) {
      hasSyncedRef.current = true;
      void syncCalendar();
    }
  }, [calendarConnected, syncCalendar]);

  // Re-sync every 2 minutes while calendar is connected
  useEffect(() => {
    if (!calendarConnected) return;
    const id = setInterval(() => void syncCalendar(), 2 * 60_000);
    return () => clearInterval(id);
  }, [calendarConnected, syncCalendar]);

  // Re-sync immediately when the tab becomes visible again — catches GCal changes
  // made while the app was backgrounded (e.g. meeting added on phone/desktop).
  useEffect(() => {
    if (!calendarConnected) return;
    const lastSyncRef = { t: Date.now() };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastSyncRef.t > 60_000) {
        lastSyncRef.t = Date.now();
        void syncCalendar();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [calendarConnected, syncCalendar]);

  // ── Timer poll ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const check = () => setTimerActive(timer.hasActiveTimer());
    check();
    const id = setInterval(check, 1000);
    return () => clearInterval(id);
  }, []);

  // ── Tasks ───────────────────────────────────────────────────────────────────
  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks');
      if (res.ok) setTasks(await res.json());
    } catch (err) {
      console.error('[fetchTasks]', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load — both callbacks are now stable, so this correctly runs once.
  useEffect(() => {
    void fetchTasks();
    void fetchBlocks();
  }, [fetchTasks, fetchBlocks]);

  // Re-fetch blocks whenever the viewed date changes. Pass date explicitly so the
  // AbortController in fetchBlocks can immediately cancel any prior in-flight request.
  useEffect(() => {
    void fetchBlocks(selectedDate);
  }, [selectedDate, fetchBlocks]);

  // ── Notifications ────────────────────────────────────────────────────────────
  // Keep ref current so intervals/timeouts always see latest tasks
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);

  // Request browser notification permission once on mount
  useEffect(() => { void requestPermission(); }, []);

  // Deadline warnings + morning summary — re-runs when tasks load/change,
  // but localStorage keys prevent double-firing
  useEffect(() => {
    if (tasks.length === 0) return;
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    const now = new Date();
    const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    checkDeadlineApproaching(tasks);
    if (now.getHours() >= 8) sendMorningSummary(tasks, dateKey);
  }, [tasks]);

  // If it's before 8am, schedule the morning summary summary via setTimeout
  useEffect(() => {
    const now = new Date();
    if (now.getHours() >= 8) return; // already handled by the tasks effect above
    const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const msUntil8 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 0, 0).getTime() - now.getTime();
    const id = setTimeout(() => {
      if (Notification.permission === 'granted') sendMorningSummary(tasksRef.current, dateKey);
    }, msUntil8);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll every minute for "task starting soon" (15 min warning)
  useEffect(() => {
    const id = setInterval(() => {
      if (Notification.permission === 'granted') checkTaskStartingSoon(tasksRef.current);
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  // ── Toast helper ────────────────────────────────────────────────────────────
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleTaskCreated = useCallback((task: TaskRow) => {
    setTasks((prev) => [...prev, task]);
    showToast('Task added! Auto-scheduling complete.');
  }, []);

  const handleTasksCreated = useCallback((newTasks: TaskRow[]) => {
    setTasks((prev) => [...prev, ...newTasks]);
    const parentTasks = newTasks.filter((t) => !t.parent_task_id);
    const splitTasks  = parentTasks.filter((t) => (t.total_sessions ?? 1) > 1);
    if (splitTasks.length === 1 && parentTasks.length === 1) {
      const t    = splitTasks[0];
      const days = new Set(newTasks.map((s) => s.scheduled_start?.slice(0, 10)).filter(Boolean)).size;
      showToast(
        `"${t.title}" split into ${t.total_sessions} sessions across ${days} day${days !== 1 ? 's' : ''}`,
      );
    } else if (splitTasks.length > 0) {
      showToast(
        `${parentTasks.length} task${parentTasks.length !== 1 ? 's' : ''} scheduled (${splitTasks.length} split into sessions)`,
      );
    } else {
      showToast(`${parentTasks.length} task${parentTasks.length !== 1 ? 's' : ''} added and scheduled!`);
    }
  }, []);

  const handleComplete = useCallback((stats: CompletionStats) => {
    setCompletionStats(stats);
    void fetchTasks();
  }, [fetchTasks]);

  const handleAddBlock = useCallback(async (block: { title: string; start_time: string; end_time: string }) => {
    const res = await fetch('/api/blocks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(block),
    });
    if (!res.ok) throw new Error('Failed to add block');
    const newBlock: CalendarBlock & { gcal_warning?: boolean } = await res.json();
    const d = new Date(newBlock.start_time);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    setBlocksCache((prev) => ({
      ...prev,
      [key]: [...(prev[key] ?? []), newBlock].sort(
        (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
      ),
    }));
    if (newBlock.gcal_warning) {
      showToast('Block saved locally — Google Calendar sync failed.');
    }
  }, []);

  const handleAddManyBlocks = useCallback(async (blocks: Array<{ title: string; start_time: string; end_time: string }>) => {
    const res = await fetch('/api/blocks/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks }),
    });
    if (!res.ok) throw new Error('Failed to add blocks');
    const { blocks: newBlocks } = await res.json() as { blocks: CalendarBlock[] };
    setBlocksCache((prev) => {
      const next = { ...prev };
      for (const b of newBlocks) {
        const d = new Date(b.start_time);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        next[key] = [...(next[key] ?? []), b].sort(
          (a, c) => new Date(a.start_time).getTime() - new Date(c.start_time).getTime()
        );
      }
      return next;
    });
  }, []);

  const handleDeleteBlock = useCallback(async (id: string) => {
    const res = await fetch(`/api/blocks/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setBlocksCache((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          next[key] = next[key].filter((b) => b.id !== id);
        }
        return next;
      });
    }
  }, []);

  const handleQuickComplete = useCallback(async (taskId: string) => {
    setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, status: 'completed' } : t));
    try {
      await fetch(`/api/tasks/${taskId}/complete`, { method: 'POST' });
      setTimeout(() => {
        setTasks((prev) => prev.filter((t) => t.id !== taskId));
      }, 600); // brief pause so the checkmark animates before disappearing
    } catch {
      void fetchTasks(); // revert on error
    }
  }, [fetchTasks]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  const hasPendingTasks = tasks.some((t) => t.status === 'pending');

  // ── Upcoming task list (left panel) ─────────────────────────────────────────
  const upcomingTasks = tasks
    .filter((t) => {
      if (t.status !== 'pending' && t.status !== 'in_progress') return false;
      // Show non-child tasks (parents + unsplit tasks)
      if (!t.parent_task_id) return true;
      // Show child sessions whose parent is no longer in the active tasks list
      // (e.g. parent was completed but child sessions remain pending)
      return !tasks.some((p) => p.id === t.parent_task_id);
    })
    .sort((a, b) => {
      if (!a.scheduled_start) return 1;
      if (!b.scheduled_start) return -1;
      return new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime();
    });

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  return (
    <div className="h-[100dvh] flex flex-col bg-surface-50 overflow-hidden">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="bg-white border-b border-surface-200 px-6 py-3.5 flex-shrink-0 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-teal-600 rounded-lg flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <span className="hidden sm:block text-xl font-bold text-surface-900">TimeSlot</span>
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-3">
          {/* Google Calendar */}
          {calendarConnected && !calendarSyncError ? (
            <button
              onClick={() => void handleManualSync()}
              disabled={calendarSyncing}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-teal-200 bg-teal-50 rounded-lg text-xs font-medium text-teal-700 hover:bg-teal-100 transition-colors disabled:opacity-60"
              title="Click to resync"
            >
              <svg className={`w-3.5 h-3.5 ${calendarSyncing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                {calendarSyncing
                  ? <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  : <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />}
              </svg>
              {calendarSyncing ? 'Syncing…' : <><span className="hidden sm:inline">Google Calendar</span><span className="sm:hidden">GCal</span></>}
            </button>
          ) : calendarSyncError ? (
            <a
              href="/api/calendar/oauth"
              className="flex items-center gap-1.5 px-3 py-1.5 border border-amber-300 bg-amber-50 rounded-lg text-xs font-medium text-amber-700 hover:bg-amber-100 transition-colors"
              title="Calendar token expired or missing calendar permission — click to reconnect"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              Reconnect Calendar
            </a>
          ) : (
            <a
              href="/api/calendar/oauth"
              className="flex items-center gap-1.5 px-3 py-1.5 border border-surface-200 rounded-lg text-xs font-medium text-surface-600 hover:bg-surface-50 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Connect Google Calendar
            </a>
          )}

          {/* Beta feedback */}
          <a
            href="https://docs.google.com/forms/d/e/1FAIpQLSdM2TcREpoBKsCaZvx6M34kkFYZsyIQboAa7KJWTBOmvRAMpw/viewform?usp=sharing&ouid=116951976494925303286"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden md:flex items-center gap-1.5 px-3 py-1.5 border border-amber-300 bg-amber-50 rounded-lg text-xs font-medium text-amber-700 hover:bg-amber-100 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Feedback Form
          </a>

          {/* Start Timer */}
          <button
            onClick={() => setShowTimerSelector(true)}
            disabled={timerActive || !hasPendingTasks}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 text-white rounded-lg text-xs font-semibold hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title={timerActive ? 'Timer already running' : !hasPendingTasks ? 'Add a task first' : 'Start timing a task'}
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
            {timerActive ? <><span className="hidden sm:inline">Timer </span>Running</> : <><span className="hidden sm:inline">Start </span>Timer</>}
          </button>

          {/* User menu */}
          {user && (
            <div className="relative pl-1 border-l border-surface-200" ref={userMenuRef}>
              <button
                onClick={() => setShowUserMenu((v) => !v)}
                className="flex items-center gap-2 rounded-full focus:outline-none"
              >
                {user.user_metadata?.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={user.user_metadata.avatar_url as string}
                    alt={(user.user_metadata?.full_name as string) ?? 'User'}
                    className="w-7 h-7 rounded-full"
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 text-xs font-semibold">
                    {((user.user_metadata?.full_name as string) ?? user.email ?? 'U').charAt(0).toUpperCase()}
                  </div>
                )}
              </button>

              {showUserMenu && (
                <div className="absolute right-0 top-full mt-2 w-44 bg-white border border-surface-200 rounded-xl shadow-lg py-1 z-50">
                  <div className="px-3 py-2 border-b border-surface-100">
                    <p className="text-xs font-medium text-surface-900 truncate">
                      {(user.user_metadata?.full_name as string) ?? user.email}
                    </p>
                    {user.user_metadata?.full_name && (
                      <p className="text-xs text-surface-500 truncate">{user.email}</p>
                    )}
                  </div>
                  <a
                    href="https://docs.google.com/forms/d/e/1FAIpQLSdM2TcREpoBKsCaZvx6M34kkFYZsyIQboAa7KJWTBOmvRAMpw/viewform?usp=sharing&ouid=116951976494925303286"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full text-left px-3 py-2 text-sm text-surface-700 hover:bg-surface-50 transition-colors"
                  >
                    Feedback Form
                  </a>
                  <button
                    onClick={handleSignOut}
                    className="w-full text-left px-3 py-2 text-sm text-surface-700 hover:bg-surface-50 transition-colors"
                  >
                    Sign out
                  </button>
                  <div className="border-t border-surface-100 px-3 py-2 flex gap-3">
                    <a href="/privacy" className="text-xs text-surface-400 hover:text-surface-600 transition-colors">Privacy</a>
                    <a href="/terms" className="text-xs text-surface-400 hover:text-surface-600 transition-colors">Terms</a>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* ── Stats ─────────────────────────────────────────────────────────── */}
      <StatsCards />

      {/* ── Mobile inline tab switcher ────────────────────────────────────── */}
      <div className="md:hidden flex-shrink-0 bg-white border-b border-surface-200">
        <div className="flex">
          <button
            onClick={() => setMobileView('tasks')}
            className={`flex-1 py-3 flex items-center justify-center gap-1.5 text-sm font-medium relative transition-colors ${
              mobileView === 'tasks' ? 'text-teal-600' : 'text-surface-400'
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            Tasks
            {mobileView === 'tasks' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-600" />
            )}
          </button>
          <button
            onClick={() => setMobileView('schedule')}
            className={`flex-1 py-3 flex items-center justify-center gap-1.5 text-sm font-medium relative transition-colors ${
              mobileView === 'schedule' ? 'text-teal-600' : 'text-surface-400'
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Schedule
            {mobileView === 'schedule' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-600" />
            )}
          </button>
        </div>
      </div>

      {/* ── Main two-column content ───────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden border-t border-surface-200">
        {/* Left: Upcoming task list */}
        <aside className={`w-full md:w-72 flex-shrink-0 bg-white md:border-r border-surface-200 flex-col overflow-hidden ${mobileView === 'tasks' ? 'flex' : 'hidden md:flex'}`}>
          <div className="px-5 py-4 border-b border-surface-100 flex-shrink-0">
            <h2 className="text-base font-bold text-surface-900">Upcoming Tasks</h2>
            <p className="text-xs text-surface-500 mt-0.5">
              {upcomingTasks.length} task{upcomingTasks.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-surface-400 text-sm">
                Loading…
              </div>
            ) : upcomingTasks.length === 0 ? (
              <div className="text-center py-12 px-4">
                <div className="w-10 h-10 bg-surface-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-5 h-5 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                </div>
                <p className="text-sm text-surface-500 font-medium">No tasks yet</p>
                <p className="text-xs text-surface-400 mt-1">Tap + to add your first task</p>
              </div>
            ) : (
              <div className="divide-y divide-surface-100">
                {upcomingTasks.map((task) => {
                  const isDone = task.status === 'completed';
                  return (
                    <div
                      key={task.id}
                      className={`px-5 py-3.5 transition-opacity duration-500 ${isDone ? 'opacity-40' : ''}`}
                    >
                      <div className="flex items-start gap-2.5">
                        {/* Checkmark button */}
                        <button
                          onClick={() => void handleQuickComplete(task.id)}
                          disabled={isDone || task.status === 'in_progress'}
                          title={task.status === 'in_progress' ? 'Stop timer first' : 'Mark complete'}
                          className={`flex-shrink-0 w-7 h-7 md:w-5 md:h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                            isDone
                              ? 'border-green-400 bg-green-400'
                              : task.status === 'in_progress'
                              ? 'border-amber-300 cursor-not-allowed'
                              : 'border-surface-300 hover:border-teal-500 hover:bg-teal-50'
                          }`}
                        >
                          {isDone && (
                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>

                        {/* Clickable task info — opens edit modal */}
                        <button
                          type="button"
                          className="flex-1 min-w-0 text-left"
                          onClick={() => setEditingTask(task)}
                          title="Click to edit task"
                        >
                          <p className={`text-sm font-medium line-clamp-2 ${isDone ? 'line-through text-surface-400' : 'text-surface-900'}`}>
                            {task.title}
                          </p>
                          {task.is_fixed && (
                            <span className="text-xs text-teal-600 flex items-center gap-1">
                              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
                              </svg>
                              Pinned
                            </span>
                          )}
                          {(task.total_sessions ?? 1) > 1 && (
                            <span className="text-xs text-teal-600">
                              {task.total_sessions} sessions
                            </span>
                          )}
                          {task.needs_rescheduling && (
                            <p className="text-xs font-medium text-amber-600 mt-0.5">
                              ⚠ Can&apos;t fit before deadline — reschedule manually
                            </p>
                          )}
                          {task.scheduled_start && (
                            <p className="text-xs text-surface-500 mt-0.5">
                              {formatTime(task.scheduled_start)}
                              {task.scheduled_end && ` – ${formatTime(task.scheduled_end)}`}
                            </p>
                          )}
                          {task.tag && (
                            <span className="text-xs text-teal-600 mt-0.5 inline-block">{task.tag}</span>
                          )}
                        </button>

                        <span className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium mt-0.5 ${
                          task.status === 'in_progress'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-surface-100 text-surface-600'
                        }`}>
                          {task.status === 'in_progress' ? 'Active' : 'Pending'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        {/* Right: Schedule View */}
        <main className={`flex-1 overflow-hidden bg-surface-50 ${mobileView === 'schedule' ? 'block' : 'hidden md:block'}`}>
          <ScheduleView
            tasks={tasks}
            loading={loading}
            blocks={blocks}
            calendarConnected={calendarConnected}
            selectedDate={selectedDate}
            onDateChange={setSelectedDate}
            onAddBlock={handleAddBlock}
            onAddManyBlocks={handleAddManyBlocks}
            onDeleteBlock={handleDeleteBlock}
            onEditTask={setEditingTask}
          />
        </main>
      </div>


      {/* ── FAB ───────────────────────────────────────────────────────────── */}
      <button
        onClick={() => setShowDrawer(true)}
        className={`fixed right-6 z-50 w-14 h-14 bg-teal-600 hover:bg-teal-700 text-white rounded-full shadow-lg flex items-center justify-center transition-all duration-200 ${
          timerActive ? 'bottom-52' : 'bottom-6'
        }`}
        title="Add new task"
        aria-label="Add new task"
      >
        <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
      </button>

      {/* ── Task drawer ───────────────────────────────────────────────────── */}
      <TaskDrawer
        open={showDrawer}
        onClose={() => setShowDrawer(false)}
        onTaskCreated={handleTaskCreated}
        onTasksCreated={handleTasksCreated}
      />

      {/* ── Task edit modal ────────────────────────────────────────────────── */}
      <TaskEditModal
        task={editingTask}
        onClose={() => setEditingTask(null)}
        onSave={() => { setEditingTask(null); void fetchTasks(); void fetchBlocks(); }}
      />

      {/* ── Toast ─────────────────────────────────────────────────────────── */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-surface-900 text-white text-sm px-5 py-2.5 rounded-full shadow-lg z-50 pointer-events-none whitespace-nowrap">
          {toast}
        </div>
      )}

      {/* ── Floating timer ────────────────────────────────────────────────── */}
      <CornerTimerWidget
        onComplete={handleComplete}
        onTimerFinish={fetchTasks}
      />

      {/* ── Timer selector ────────────────────────────────────────────────── */}
      {showTimerSelector && (
        <TimerSelector
          tasks={tasks}
          onStarted={fetchTasks}
          onClose={() => setShowTimerSelector(false)}
        />
      )}

      {/* ── Onboarding ────────────────────────────────────────────────────── */}
      <OnboardingTooltip />

      {/* ── PWA install prompt ────────────────────────────────────────────── */}
      <InstallPrompt />

      {/* ── Completion popup ──────────────────────────────────────────────── */}
      {completionStats && (
        <CompletionPopup
          stats={completionStats}
          onDismiss={() => setCompletionStats(null)}
          onStartNewTask={() => {
            setCompletionStats(null);
            setShowTimerSelector(true);
          }}
        />
      )}
    </div>
  );
}

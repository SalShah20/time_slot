'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import ScheduleView from '@/components/ScheduleView';
import StatsCards from '@/components/StatsCards';
import CornerTimerWidget from '@/components/CornerTimerWidget';
import TimerSelector from '@/components/TimerSelector';
import CompletionPopup from '@/components/CompletionPopup';
import CompletedTasksModal from '@/components/CompletedTasksModal';
import TaskDrawer from '@/components/TaskDrawer';
import TaskEditModal from '@/components/TaskEditModal';
import OnboardingFlow from '@/components/OnboardingFlow';
import InstallPrompt from '@/components/InstallPrompt';
import * as timer from '@/lib/timerService';
import { supabase } from '@/lib/supabase';
import { getTagColor } from '@/lib/tagColors';
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
  const [showCompletedModal, setShowCompletedModal] = useState(false);
  const [taskSearch, setTaskSearch]               = useState('');
  const [showOnboarding, setShowOnboarding]       = useState(false);

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

  // ── Onboarding trigger ──────────────────────────────────────────────────────
  // Show the guided onboarding flow only for truly new users:
  // authenticated, zero tasks, and haven't dismissed onboarding before.
  useEffect(() => {
    if (loading || !user) return;
    if (localStorage.getItem('ts_onboarding_seen')) return;
    if (tasks.length === 0) setShowOnboarding(true);
  }, [loading, user, tasks.length]);

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
      }, 600);
    } catch {
      void fetchTasks();
    }
  }, [fetchTasks]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  const hasPendingTasks = tasks.some((t) => t.status === 'pending');

  // ── Upcoming task list (left panel) ─────────────────────────────────────────
  const activeTasks = tasks
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

  const now = new Date();
  const isOverdue = (t: TaskRow) =>
    t.status === 'pending' && (
      (t.scheduled_end && new Date(t.scheduled_end) < now) ||
      (t.deadline && new Date(t.deadline) < now)
    );

  const overdueTasks  = activeTasks.filter(isOverdue);
  const upcomingTasks = activeTasks.filter((t) => !isOverdue(t));

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  const overdueBy = (task: TaskRow) => {
    const ref = task.deadline && new Date(task.deadline) < now
      ? new Date(task.deadline)
      : new Date(task.scheduled_end!);
    const diff = Date.now() - ref.getTime();
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor(diff / 60_000);
    if (h >= 24) return `${Math.floor(h / 24)}d overdue`;
    if (h >= 1)  return `${h}h overdue`;
    return `${m}m overdue`;
  };

  const handleRescheduleTask = async (taskId: string) => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch('/api/tasks/reschedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone: tz, taskId }),
      });
      if (res.ok) {
        showToast('Task rescheduled!');
        await fetchTasks();
        await fetchBlocks();
      } else {
        const d = await res.json().catch(() => ({})) as { error?: string };
        showToast(d.error ?? 'Failed to reschedule');
      }
    } catch {
      showToast('Failed to reschedule');
    }
  };

  // Filter tasks by search
  const searchLower = taskSearch.toLowerCase();
  const filteredOverdue = searchLower
    ? overdueTasks.filter((t) => t.title.toLowerCase().includes(searchLower))
    : overdueTasks;
  const filteredUpcoming = searchLower
    ? upcomingTasks.filter((t) => t.title.toLowerCase().includes(searchLower))
    : upcomingTasks;
  const totalFiltered = filteredOverdue.length + filteredUpcoming.length;

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
          <div data-onboarding="gcal">
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
            <div className="flex flex-col items-center">
              <a
                href="/api/calendar/oauth"
                className="flex items-center gap-1.5 px-3 py-1.5 border border-surface-200 rounded-lg text-xs font-medium text-surface-600 hover:bg-surface-50 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Connect Google Calendar
              </a>
              <span className="text-xs text-surface-400 mt-1 hidden sm:block">One account at a time</span>
            </div>
          )}
          </div>

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
                    href="/settings"
                    className="block w-full text-left px-3 py-2 text-sm text-surface-700 hover:bg-surface-50 transition-colors"
                  >
                    Settings
                  </a>
                  <a
                    href="https://docs.google.com/forms/d/e/1FAIpQLSdM2TcREpoBKsCaZvx6M34kkFYZsyIQboAa7KJWTBOmvRAMpw/viewform?usp=sharing&ouid=116951976494925303286"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full text-left px-3 py-2 text-sm text-surface-700 hover:bg-surface-50 transition-colors"
                  >
                    Feedback Form
                  </a>
                  {process.env.NODE_ENV === 'development' && (
                    <button
                      onClick={() => {
                        localStorage.removeItem('ts_onboarding_seen');
                        window.location.reload();
                      }}
                      className="w-full text-left px-3 py-2 text-sm text-surface-400 hover:bg-surface-50 transition-colors"
                    >
                      Restart onboarding
                    </button>
                  )}
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
      <StatsCards onCompletedClick={() => setShowCompletedModal(true)} overdueCount={overdueTasks.length} />

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
          {/* Search + header */}
          <div className="px-4 pt-4 pb-2 flex-shrink-0">
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={taskSearch}
                onChange={(e) => setTaskSearch(e.target.value)}
                placeholder="Search tasks..."
                className="w-full pl-8 pr-3 py-2 text-sm bg-surface-50 border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-surface-900 placeholder:text-surface-400"
              />
            </div>
          </div>

          <div className="px-5 py-2 border-b border-surface-100 flex-shrink-0">
            <h2 className="text-sm font-bold text-surface-900">Tasks</h2>
            <p className="text-xs text-surface-500 mt-0.5">
              {totalFiltered} task{totalFiltered !== 1 ? 's' : ''}
              {filteredOverdue.length > 0 && (
                <span className="text-red-500 ml-1">({filteredOverdue.length} overdue)</span>
              )}
            </p>
          </div>

          <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-surface-400 text-sm">
                Loading...
              </div>
            ) : totalFiltered === 0 ? (
              <div className="text-center py-12 px-4">
                <div className="w-12 h-12 bg-teal-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p className="text-sm text-surface-500 font-medium">
                  {taskSearch ? 'No matching tasks' : 'No tasks yet'}
                </p>
                {!taskSearch && (
                  <>
                    <p className="text-xs text-surface-400 mt-1">
                      Tap + to add your first task — AI will schedule it for you.
                    </p>
                    <button
                      onClick={() => setShowDrawer(true)}
                      className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-lg transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                      </svg>
                      Add your first task
                    </button>
                  </>
                )}
              </div>
            ) : (
              <>
                {/* ── Overdue section ──────────────────────────────────────── */}
                {filteredOverdue.length > 0 && (
                  <div>
                    <div className="px-5 py-2.5 bg-red-50/60 border-b border-red-100 flex items-center gap-2">
                      <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="text-red-600 font-semibold text-sm">Overdue</span>
                      <span className="bg-red-100 text-red-600 text-xs font-medium px-2 py-0.5 rounded-full">
                        {filteredOverdue.length}
                      </span>
                    </div>
                    <div className="divide-y divide-red-100">
                      {filteredOverdue.map((task) => {
                        const tagColor = task.tag ? getTagColor(task.tag) : null;
                        return (
                          <div
                            key={task.id}
                            className="px-5 py-3.5 border-l-4 border-red-400 hover:bg-red-50/40 transition-colors"
                          >
                            <div className="flex items-start gap-2.5">
                              <button
                                onClick={() => void handleQuickComplete(task.id)}
                                title="Mark complete"
                                className="flex-shrink-0 w-7 h-7 md:w-5 md:h-5 rounded-full border-2 border-surface-300 hover:border-teal-500 hover:bg-teal-50 flex items-center justify-center transition-colors"
                              />
                              <button
                                type="button"
                                className="flex-1 min-w-0 text-left"
                                onClick={() => setEditingTask(task)}
                                title="Click to edit task"
                              >
                                <p className="text-sm font-medium line-clamp-2 text-surface-900">
                                  {task.title}
                                </p>
                                <span className="text-red-500 text-xs font-medium">
                                  {overdueBy(task)}
                                </span>
                                {tagColor && task.tag && (
                                  <span className={`text-xs px-1.5 py-0.5 rounded-full mt-0.5 ml-1.5 inline-block ${tagColor.bg} ${tagColor.text}`}>
                                    {task.tag}
                                  </span>
                                )}
                              </button>
                              <button
                                onClick={() => void handleRescheduleTask(task.id)}
                                className="flex-shrink-0 text-xs text-surface-400 hover:text-teal-600 underline underline-offset-2 mt-0.5 transition-colors"
                              >
                                Reschedule
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── Upcoming section ─────────────────────────────────────── */}
                {filteredUpcoming.length > 0 && filteredOverdue.length > 0 && (
                  <div className="px-5 py-2.5 bg-surface-50 border-b border-surface-100">
                    <span className="text-surface-600 font-semibold text-sm">Upcoming</span>
                  </div>
                )}
                <div className="divide-y divide-surface-100">
                  {filteredUpcoming.map((task) => {
                    const isDone = task.status === 'completed';
                    const tagColor = task.tag ? getTagColor(task.tag) : null;

                    return (
                      <div
                        key={task.id}
                        className={`px-5 py-3.5 transition-opacity duration-500 ${isDone ? 'opacity-40' : ''}`}
                      >
                        <div className="flex items-start gap-2.5">
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
                                Can&apos;t fit before deadline
                              </p>
                            )}
                            {task.scheduled_start && (
                              <p className="text-xs text-surface-500 mt-0.5 flex items-center gap-1">
                                {task.is_fixed && (
                                  <svg className="w-3 h-3 text-surface-400 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
                                  </svg>
                                )}
                                {formatTime(task.scheduled_start)}
                                {task.scheduled_end && ` – ${formatTime(task.scheduled_end)}`}
                              </p>
                            )}
                            {tagColor && task.tag && (
                              <span className={`text-xs px-1.5 py-0.5 rounded-full mt-0.5 inline-block ${tagColor.bg} ${tagColor.text}`}>
                                {task.tag}
                              </span>
                            )}
                            {task.source === 'canvas' && (
                              <span className="text-xs px-1.5 py-0.5 rounded-full mt-0.5 ml-0.5 inline-block bg-orange-50 text-orange-600">
                                Canvas
                              </span>
                            )}
                            {task.reminder_minutes != null && task.reminder_minutes !== 15 && (
                              <span className="text-xs text-surface-400 flex items-center gap-1 mt-0.5">
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                                </svg>
                                {task.reminder_minutes === 0 ? 'No reminder' : `${task.reminder_minutes}min before`}
                              </span>
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
              </>
            )}
          </div>
        </aside>

        {/* Right: Schedule View */}
        <main className={`flex-1 overflow-hidden bg-surface-50 relative ${mobileView === 'schedule' ? 'block' : 'hidden md:block'}`} data-onboarding="schedule">
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
          {!loading && tasks.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
              <div className="text-center bg-white/80 rounded-2xl p-8">
                <div className="w-12 h-12 bg-teal-50 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-teal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-sm text-surface-500 font-medium">Your schedule is clear</p>
                <p className="text-xs text-surface-400 mt-1">Add tasks and they&apos;ll appear here automatically.</p>
              </div>
            </div>
          )}
        </main>
      </div>


      {/* ── FAB ───────────────────────────────────────────────────────────── */}
      <button
        onClick={() => setShowDrawer(true)}
        data-onboarding="fab"
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
      {showOnboarding && (
        <OnboardingFlow
          calendarConnected={calendarConnected}
          onComplete={() => { setShowOnboarding(false); setShowDrawer(true); }}
          onSkip={() => setShowOnboarding(false)}
        />
      )}

      {/* ── PWA install prompt ────────────────────────────────────────────── */}
      <InstallPrompt />

      {/* ── Completed tasks modal ──────────────────────────────────────── */}
      <CompletedTasksModal
        isOpen={showCompletedModal}
        onClose={() => setShowCompletedModal(false)}
        onTaskUndone={fetchTasks}
      />

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

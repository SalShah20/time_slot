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
import * as timer from '@/lib/timerService';
import { supabase } from '@/lib/supabase';
import type { TaskRow, CompletionStats, CalendarBlock } from '@/types/timer';

export default function Home() {
  const router = useRouter();
  const [user, setUser]                           = useState<User | null>(null);
  const [tasks, setTasks]                         = useState<TaskRow[]>([]);
  const [blocks, setBlocks]                       = useState<CalendarBlock[]>([]);
  const [loading, setLoading]                     = useState(true);
  const [completionStats, setCompletionStats]     = useState<CompletionStats | null>(null);
  const [showTimerSelector, setShowTimerSelector] = useState(false);
  const [timerActive, setTimerActive]             = useState(false);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [showDrawer, setShowDrawer]               = useState(false);
  const [toast, setToast]                         = useState<string | null>(null);
  const [showUserMenu, setShowUserMenu]           = useState(false);

  const userMenuRef  = useRef<HTMLDivElement>(null);
  const hasSyncedRef = useRef(false);

  // ── Auth ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
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
    if (params.get('calendar') === 'connected') {
      setCalendarConnected(true);
      router.replace('/');
      return;
    }
    fetch('/api/calendar/status')
      .then((r) => r.json())
      .then((d) => setCalendarConnected(!!d.connected))
      .catch(() => null);
  }, [router]);

  // ── Sync Google Calendar events once when connected ─────────────────────────
  const fetchBlocks = useCallback(async () => {
    try {
      const res = await fetch('/api/blocks');
      if (res.ok) setBlocks(await res.json());
    } catch (err) {
      console.error('[fetchBlocks]', err);
    }
  }, []);

  useEffect(() => {
    if (calendarConnected && !hasSyncedRef.current) {
      hasSyncedRef.current = true;
      fetch('/api/calendar/sync', { method: 'POST' })
        .then(() => fetchBlocks())
        .catch(() => null);
    }
  }, [calendarConnected, fetchBlocks]);

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

  useEffect(() => {
    void fetchTasks();
    void fetchBlocks();
  }, [fetchTasks, fetchBlocks]);

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
    setBlocks((prev) => [...prev, newBlock].sort(
      (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    ));
    if (newBlock.gcal_warning) {
      showToast('Block saved locally — Google Calendar sync failed.');
    }
  }, []);

  const handleDeleteBlock = useCallback(async (id: string) => {
    const res = await fetch(`/api/blocks/${id}`, { method: 'DELETE' });
    if (res.ok) setBlocks((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  const hasPendingTasks = tasks.some((t) => t.status === 'pending');

  // ── Upcoming task list (left panel) ─────────────────────────────────────────
  const upcomingTasks = tasks
    .filter((t) => t.status === 'pending' || t.status === 'in_progress')
    .sort((a, b) => {
      if (!a.scheduled_start) return 1;
      if (!b.scheduled_start) return -1;
      return new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime();
    });

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  return (
    <div className="h-screen flex flex-col bg-surface-50 overflow-hidden">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="bg-white border-b border-surface-200 px-6 py-3.5 flex-shrink-0 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-teal-600 rounded-lg flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <span className="text-xl font-bold text-surface-900">TimeSlot</span>
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-3">
          {/* Google Calendar */}
          {calendarConnected ? (
            <span className="flex items-center gap-1.5 px-3 py-1.5 border border-teal-200 bg-teal-50 rounded-lg text-xs font-medium text-teal-700">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Google Calendar connected
            </span>
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
            {timerActive ? 'Timer Running' : 'Start Timer'}
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
                  <button
                    onClick={handleSignOut}
                    className="w-full text-left px-3 py-2 text-sm text-surface-700 hover:bg-surface-50 transition-colors"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* ── Stats ─────────────────────────────────────────────────────────── */}
      <StatsCards />

      {/* ── Main two-column content ───────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden border-t border-surface-200">
        {/* Left: Upcoming task list */}
        <aside className="w-72 flex-shrink-0 bg-white border-r border-surface-200 flex flex-col overflow-hidden">
          <div className="px-5 py-4 border-b border-surface-100 flex-shrink-0">
            <h2 className="text-base font-bold text-surface-900">Upcoming Tasks</h2>
            <p className="text-xs text-surface-500 mt-0.5">
              {upcomingTasks.length} task{upcomingTasks.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex-1 overflow-y-auto">
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
                {upcomingTasks.map((task) => (
                  <div key={task.id} className="px-5 py-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-surface-900 truncate">{task.title}</p>
                        {task.scheduled_start && (
                          <p className="text-xs text-surface-500 mt-0.5">
                            {formatTime(task.scheduled_start)}
                            {task.scheduled_end && ` – ${formatTime(task.scheduled_end)}`}
                          </p>
                        )}
                        {task.tag && (
                          <span className="text-xs text-teal-600 mt-0.5 inline-block">{task.tag}</span>
                        )}
                      </div>
                      <span className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium mt-0.5 ${
                        task.status === 'in_progress'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-surface-100 text-surface-600'
                      }`}>
                        {task.status === 'in_progress' ? 'Active' : 'Pending'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* Right: Schedule View */}
        <main className="flex-1 overflow-hidden bg-surface-50">
          <ScheduleView
            tasks={tasks}
            loading={loading}
            blocks={blocks}
            calendarConnected={calendarConnected}
            onAddBlock={handleAddBlock}
            onDeleteBlock={handleDeleteBlock}
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

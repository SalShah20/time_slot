'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import TaskForm from '@/components/TaskForm';
import ScheduleView from '@/components/ScheduleView';
import StatsCards from '@/components/StatsCards';
import CornerTimerWidget from '@/components/CornerTimerWidget';
import TimerSelector from '@/components/TimerSelector';
import CompletionPopup from '@/components/CompletionPopup';
import * as timer from '@/lib/timerService';
import { supabase } from '@/lib/supabase';
import type { TaskRow, CompletionStats } from '@/types/timer';

export default function Home() {
  const router = useRouter();
  const [user, setUser]                         = useState<User | null>(null);
  const [tasks, setTasks]                       = useState<TaskRow[]>([]);
  const [loading, setLoading]                   = useState(true);
  const [completionStats, setCompletionStats]   = useState<CompletionStats | null>(null);
  const [showTimerSelector, setShowTimerSelector] = useState(false);
  const [timerActive, setTimerActive]           = useState(false);
  const [calendarConnected, setCalendarConnected] = useState(false);

  // Load current user on mount
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  // Check Google Calendar connection status; also pick up ?calendar=connected after OAuth redirect
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

  // Poll for active timer state every second (lightweight localStorage check)
  useEffect(() => {
    const check = () => setTimerActive(timer.hasActiveTimer());
    check();
    const id = setInterval(check, 1000);
    return () => clearInterval(id);
  }, []);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks');
      if (res.ok) {
        const data: TaskRow[] = await res.json();
        setTasks(data);
      }
    } catch (err) {
      console.error('[fetchTasks]', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  const handleTaskCreated = useCallback((task: TaskRow) => {
    setTasks((prev) => [...prev, task]);
  }, []);

  const handleComplete = useCallback((stats: CompletionStats) => {
    setCompletionStats(stats);
    void fetchTasks();
  }, [fetchTasks]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  const hasPendingTasks = tasks.some((t) => t.status === 'pending');

  return (
    <div className="h-screen flex flex-col bg-surface-50 overflow-hidden">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
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
          {/* Google Calendar connect / connected indicator */}
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
              title="Connect Google Calendar"
              className="flex items-center gap-1.5 px-3 py-1.5 border border-surface-200 rounded-lg text-xs font-medium text-surface-600 hover:bg-surface-50 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Connect Google Calendar
            </a>
          )}

          {/* Start Timer button */}
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

          {/* User avatar + sign out */}
          {user && (
            <div className="flex items-center gap-2 pl-1 border-l border-surface-200">
              {user.user_metadata?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.user_metadata.avatar_url as string}
                  alt={user.user_metadata?.full_name as string ?? 'User'}
                  className="w-7 h-7 rounded-full"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 text-xs font-semibold">
                  {((user.user_metadata?.full_name as string) ?? user.email ?? 'U').charAt(0).toUpperCase()}
                </div>
              )}
              <button
                onClick={handleSignOut}
                className="text-xs text-surface-500 hover:text-surface-700 transition-colors"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ── Stats Cards ──────────────────────────────────────────────────────── */}
      <StatsCards />

      {/* ── Main two-column content ──────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden border-t border-surface-200">
        {/* Left: Task Form */}
        <aside className="w-80 flex-shrink-0 bg-white border-r border-surface-200 overflow-hidden">
          <TaskForm onTaskCreated={handleTaskCreated} />
        </aside>

        {/* Right: Calendar View */}
        <main className="flex-1 overflow-hidden bg-surface-50">
          <ScheduleView
            tasks={tasks}
            loading={loading}
          />
        </main>
      </div>

      {/* ── Floating timer (only when active) ────────────────────────────────── */}
      <CornerTimerWidget
        onComplete={handleComplete}
        onTimerFinish={fetchTasks}
      />

      {/* ── Timer selector modal ──────────────────────────────────────────────── */}
      {showTimerSelector && (
        <TimerSelector
          tasks={tasks}
          onStarted={fetchTasks}
          onClose={() => setShowTimerSelector(false)}
        />
      )}

      {/* ── Completion popup ──────────────────────────────────────────────────── */}
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

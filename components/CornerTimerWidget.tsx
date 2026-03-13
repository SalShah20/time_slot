'use client';

import { useEffect, useState, useCallback } from 'react';
import type { TimerDisplayState, CompletionStats } from '@/types/timer';
import * as timer from '@/lib/timerService';

// ─── useTimer hook ────────────────────────────────────────────────────────────

function useTimer(onComplete: (stats: CompletionStats) => void) {
  const [display, setDisplay] = useState<TimerDisplayState | null>(null);

  useEffect(() => {
    timer.restoreTimerOnLoad();
    setDisplay(timer.getDisplayState());

    const intervalId = setInterval(() => {
      setDisplay(timer.getDisplayState());
    }, 1000);

    return () => {
      clearInterval(intervalId);
      timer.stopSyncInterval();
    };
  }, []);

  const handlePause = useCallback(() => {
    timer.pauseWork();
    setDisplay(timer.getDisplayState());
  }, []);

  const handleResume = useCallback(() => {
    timer.resumeWork();
    setDisplay(timer.getDisplayState());
  }, []);

  const handleStartBreak = useCallback(() => {
    timer.startBreak();
    setDisplay(timer.getDisplayState());
  }, []);

  const handleEndBreak = useCallback(() => {
    timer.endBreak();
    setDisplay(timer.getDisplayState());
  }, []);

  const handleComplete = useCallback(async () => {
    const stats = await timer.completeTask();
    setDisplay(null);
    if (stats) onComplete(stats);
  }, [onComplete]);

  return { display, handlePause, handleResume, handleStartBreak, handleEndBreak, handleComplete };
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatBreakMinutes(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return `${m}m`;
}

// ─── Circular progress ring ──────────────────────────────────────────────────

const RING_SIZE = 64;
const RING_STROKE = 4;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function ProgressRing({ percent, color }: { percent: number; color: string }) {
  const offset = RING_CIRCUMFERENCE - (Math.min(percent, 100) / 100) * RING_CIRCUMFERENCE;
  return (
    <svg width={RING_SIZE} height={RING_SIZE} className="flex-shrink-0 -rotate-90">
      {/* Background track */}
      <circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth={RING_STROKE}
        className="text-surface-100"
      />
      {/* Filled arc */}
      <circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_RADIUS}
        fill="none"
        stroke={color}
        strokeWidth={RING_STROKE}
        strokeLinecap="round"
        strokeDasharray={RING_CIRCUMFERENCE}
        strokeDashoffset={offset}
        className="transition-[stroke-dashoffset] duration-1000 ease-linear"
      />
    </svg>
  );
}

// ─── CornerTimerWidget ────────────────────────────────────────────────────────

interface Props {
  onComplete: (stats: CompletionStats) => void;
  onTimerFinish: () => void;
}

export default function CornerTimerWidget({ onComplete, onTimerFinish }: Props) {
  const handleComplete = useCallback(
    (stats: CompletionStats) => {
      onComplete(stats);
      onTimerFinish();
    },
    [onComplete, onTimerFinish]
  );

  const { display, handlePause, handleResume, handleStartBreak, handleEndBreak, handleComplete: doComplete } =
    useTimer(handleComplete);

  // Only render when a timer is active
  if (!display) return null;

  const { timerState, taskTitle, estimatedMinutes, workElapsedSeconds, breakElapsedSeconds, totalBreakSeconds } = display;
  const pct = Math.min(100, Math.round((workElapsedSeconds / (estimatedMinutes * 60)) * 100));
  const overTime = workElapsedSeconds > estimatedMinutes * 60;

  const stateLabel =
    timerState === 'WORKING'  ? 'Focusing' :
    timerState === 'PAUSED'   ? 'Paused'   : 'On break';

  const stateTextColor =
    timerState === 'WORKING'  ? 'text-teal-600' :
    timerState === 'PAUSED'   ? 'text-surface-400' : 'text-amber-500';

  const borderColor =
    timerState === 'WORKING'  ? 'border-teal-500' :
    timerState === 'PAUSED'   ? 'border-surface-300' : 'border-amber-400';

  const ringColor =
    timerState === 'ON_BREAK' ? '#fbbf24' : // amber-400
    overTime                  ? '#ef4444' : // red-500
                                '#027381';  // teal-600

  const displayedSeconds = timerState === 'ON_BREAK' ? breakElapsedSeconds : workElapsedSeconds;

  return (
    <div className={`fixed bottom-6 max-md:bottom-20 right-6 z-40 w-72 max-md:w-[calc(100vw-3rem)] bg-white rounded-2xl shadow-2xl border border-surface-200 border-t-2 ${borderColor} overflow-hidden`}>
      <div className="p-4">
        {/* Task title */}
        <p className="text-xs font-medium text-surface-500 truncate mb-3" title={taskTitle}>
          {taskTitle.length > 20 ? taskTitle.slice(0, 20) + '...' : taskTitle}
        </p>

        {/* Ring + Timer + State */}
        <div className="flex items-center gap-3 mb-3">
          <ProgressRing percent={pct} color={ringColor} />
          <div className="flex-1 min-w-0">
            <span className={`text-2xl font-mono font-bold tabular-nums block ${overTime && timerState !== 'ON_BREAK' ? 'text-red-500' : 'text-surface-900'}`}>
              {formatTime(displayedSeconds)}
            </span>
            <span className={`text-xs font-semibold ${stateTextColor}`}>{stateLabel}</span>
            {totalBreakSeconds > 0 && timerState !== 'ON_BREAK' && (
              <span className="text-xs text-surface-400 ml-2">Break: {formatBreakMinutes(totalBreakSeconds)} taken</span>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-1.5">
          {timerState === 'WORKING' && (
            <>
              <button onClick={handlePause}      className="flex-1 py-1.5 text-xs font-medium border border-surface-300 rounded-lg hover:bg-surface-50 transition-colors text-surface-700">Pause</button>
              <button onClick={handleStartBreak} className="flex-1 py-1.5 text-xs font-medium border border-amber-300 text-amber-700 rounded-lg hover:bg-amber-50 transition-colors">Break</button>
              <button onClick={doComplete}        className="flex-1 py-1.5 text-xs font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors">Done</button>
            </>
          )}
          {timerState === 'PAUSED' && (
            <>
              <button onClick={handleResume}     className="flex-1 py-1.5 text-xs font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors">Resume</button>
              <button onClick={handleStartBreak} className="flex-1 py-1.5 text-xs font-medium border border-amber-300 text-amber-700 rounded-lg hover:bg-amber-50 transition-colors">Break</button>
              <button onClick={doComplete}        className="flex-1 py-1.5 text-xs font-medium border border-surface-300 text-surface-700 rounded-lg hover:bg-surface-50 transition-colors">Done</button>
            </>
          )}
          {timerState === 'ON_BREAK' && (
            <button onClick={handleEndBreak} className="flex-1 py-1.5 text-xs font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors">End Break</button>
          )}
        </div>
      </div>
    </div>
  );
}

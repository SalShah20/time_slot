'use client';

import { useEffect, useState, useCallback } from 'react';
import type { TaskStats } from '@/types/timer';

function StatCard({
  label,
  value,
  icon,
  accent,
  onClick,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  accent: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`flex-1 min-w-0 bg-white border border-surface-200 rounded-xl px-2.5 md:px-5 py-2.5 md:py-4 flex items-center gap-2 md:gap-4 ${
        onClick ? 'cursor-pointer hover:bg-surface-50 hover:shadow-md transition-all' : ''
      }`}
    >
      <div className={`w-8 h-8 md:w-10 md:h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${accent}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xl md:text-2xl font-bold text-surface-900 leading-tight">{value}</p>
        <p className="text-[11px] sm:text-xs text-surface-500 font-medium whitespace-nowrap">{label}</p>
      </div>
    </div>
  );
}

interface Props {
  onCompletedClick?: () => void;
  overdueCount?: number;
}

export default function StatsCards({ onCompletedClick, overdueCount = 0 }: Props) {
  const [stats, setStats] = useState<TaskStats>({ total: 0, upcoming: 0, completed: 0 });

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks/stats');
      if (res.ok) setStats(await res.json());
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    void fetchStats();
    const id = setInterval(fetchStats, 30_000);
    return () => clearInterval(id);
  }, [fetchStats]);

  // Build insight string from productivity data
  const insightParts: string[] = [];
  if (stats.avgAccuracy != null && stats.avgAccuracy > 0) {
    const pct = Math.round(Math.abs(1 - stats.avgAccuracy) * 100);
    if (pct > 5) {
      insightParts.push(
        stats.avgAccuracy < 1
          ? `Your tasks take ${pct}% longer than estimated`
          : `Your estimates are ${pct}% longer than actual`
      );
    } else {
      insightParts.push('Your estimates are spot on');
    }
  }
  if (stats.mostProductiveTag && stats.mostProductiveMinutes) {
    const hours = (stats.mostProductiveMinutes / 60).toFixed(1);
    insightParts.push(`Most productive: ${stats.mostProductiveTag} (${hours}h this week)`);
  }

  return (
    <div className="flex-shrink-0 overflow-x-auto px-4 md:px-6 py-3 md:py-4">
      <div className="flex gap-2 md:grid md:grid-cols-3 md:gap-3">
        <StatCard
          label="Total Tasks"
          value={stats.total}
          accent="bg-surface-100"
          icon={
            <svg className="w-4 h-4 md:w-5 md:h-5 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          }
        />
        <div className="relative flex-1 min-w-0">
          <StatCard
            label="Upcoming"
            value={stats.upcoming}
            accent="bg-teal-50"
            icon={
              <svg className="w-4 h-4 md:w-5 md:h-5 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          />
          {overdueCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-medium shadow-sm">
              {overdueCount}
            </span>
          )}
        </div>
        <StatCard
          label="Completed"
          value={stats.completed}
          accent="bg-green-50"
          onClick={onCompletedClick}
          icon={
            <svg className="w-4 h-4 md:w-5 md:h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          }
        />
      </div>
      {insightParts.length > 0 && (
        <p className="text-xs text-surface-400 text-center mt-2 px-4 truncate">
          {insightParts.join(' \u00b7 ')}
        </p>
      )}
    </div>
  );
}

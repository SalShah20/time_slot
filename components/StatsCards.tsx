'use client';

import { useEffect, useState } from 'react';
import type { TaskStats } from '@/types/timer';

function StatCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  accent: string;
}) {
  return (
    <div className="min-w-[140px] md:min-w-0 bg-white border border-surface-200 rounded-xl px-3.5 md:px-5 py-3 md:py-4 flex items-center gap-2.5 md:gap-4">
      <div className={`w-9 h-9 md:w-10 md:h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${accent}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xl md:text-2xl font-bold text-surface-900 leading-tight">{value}</p>
        <p className="text-xs text-surface-500 font-medium truncate">{label}</p>
      </div>
    </div>
  );
}

export default function StatsCards() {
  const [stats, setStats] = useState<TaskStats>({ total: 0, upcoming: 0, completed: 0 });

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch('/api/tasks/stats');
        if (res.ok) setStats(await res.json());
      } catch {
        // non-fatal
      }
    }
    void fetchStats();
    const id = setInterval(fetchStats, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex-shrink-0 overflow-x-auto px-4 md:px-6 py-3 md:py-4">
      <div className="flex md:grid md:grid-cols-3 gap-3">
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
        <StatCard
          label="Completed"
          value={stats.completed}
          accent="bg-green-50"
          icon={
            <svg className="w-4 h-4 md:w-5 md:h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          }
        />
      </div>
    </div>
  );
}

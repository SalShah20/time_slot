'use client';

import { useEffect } from 'react';
import TaskForm from '@/components/TaskForm';
import type { TaskRow } from '@/types/timer';

interface Props {
  open: boolean;
  onClose: () => void;
  onTaskCreated: (task: TaskRow) => void;
}

export default function TaskDrawer({ open, onClose, onTaskCreated }: Props) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleTaskCreated = (task: TaskRow) => {
    onTaskCreated(task);
    onClose();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/30 z-40 transition-opacity duration-300 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl shadow-2xl transition-transform duration-300 ease-out max-h-[90vh] flex flex-col ${
          open ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        {/* Handle bar */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 bg-surface-200 rounded-full" />
        </div>

        {/* Drawer header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-surface-900">Add New Task</h2>
            <p className="text-xs text-surface-500 mt-0.5">Auto-schedules into your free time</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-surface-400 hover:text-surface-600 hover:bg-surface-100 transition-colors text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Form — scrollable */}
        <div className="flex-1 overflow-y-auto pb-8">
          <TaskForm onTaskCreated={handleTaskCreated} hideHeader />
        </div>
      </div>
    </>
  );
}

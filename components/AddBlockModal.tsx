'use client';

import { useState } from 'react';

interface Props {
  onAdd: (block: { title: string; start_time: string; end_time: string }) => Promise<void>;
  onClose: () => void;
}

export default function AddBlockModal({ onAdd, onClose }: Props) {
  const [title, setTitle]         = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime]     = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!title.trim() || !startTime || !endTime) {
      setError('All fields are required');
      return;
    }

    // Build UTC ISO strings from today's date + local time input
    const today = new Date();
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    const startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), sh, sm, 0);
    const endDate   = new Date(today.getFullYear(), today.getMonth(), today.getDate(), eh, em, 0);

    if (endDate <= startDate) {
      setError('End time must be after start time');
      return;
    }

    setLoading(true);
    try {
      await onAdd({
        title: title.trim(),
        start_time: startDate.toISOString(),
        end_time: endDate.toISOString(),
      });
      onClose();
    } catch {
      setError('Failed to add block');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
        <h3 className="text-base font-bold text-surface-900 mb-4">Add Time Block</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-surface-700 mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Lunch, Meeting, Focus time"
              autoFocus
              className="w-full border border-surface-200 rounded-lg px-3 py-2 text-sm text-surface-900 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-teal-400"
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-surface-700 mb-1">Start</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full border border-surface-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-surface-700 mb-1">End</label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full border border-surface-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
              />
            </div>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-surface-200 rounded-lg text-sm font-medium text-surface-600 hover:bg-surface-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Adding…' : 'Add Block'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

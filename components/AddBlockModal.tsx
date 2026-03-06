'use client';

import { useState } from 'react';

type RepeatType = 'none' | 'daily' | 'weekly' | 'custom';

interface BlockPayload {
  title: string;
  start_time: string;
  end_time: string;
}

interface Props {
  selectedDate?: Date;
  onAdd: (block: BlockPayload) => Promise<void>;
  onAddMany?: (blocks: BlockPayload[]) => Promise<void>;
  onClose: () => void;
}

const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const DAY_FULL   = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function roundedNow(): { start: string; end: string } {
  const now = new Date();
  const totalMins = now.getHours() * 60 + now.getMinutes();
  const startMins = Math.ceil(totalMins / 15) * 15;
  const endMins   = startMins + 60;
  const fmt = (m: number) => {
    const h   = Math.floor(m / 60) % 24;
    const min = m % 60;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  };
  return { start: fmt(startMins), end: fmt(endMins) };
}

function formatTime12(time24: string): string {
  if (!time24) return '';
  const [h, m] = time24.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12    = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function calcDuration(start: string, end: string): string {
  if (!start || !end) return '';
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const diff     = eh * 60 + em - (sh * 60 + sm);
  if (diff <= 0) return '';
  const hrs  = Math.floor(diff / 60);
  const mins = diff % 60;
  if (hrs === 0) return `${mins}min`;
  if (mins === 0) return `${hrs}hr`;
  return `${hrs}hr ${mins}min`;
}

function toDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function generateOccurrences(
  baseDate:   Date,
  sh: number, sm: number,
  eh: number, em: number,
  repeat:     RepeatType,
  customDays: number[],
  until:      Date,
): BlockPayload[] {
  const dates: Date[] = [];
  const cap = 90;

  if (repeat === 'daily') {
    const d = new Date(baseDate);
    d.setHours(0, 0, 0, 0);
    while (d <= until && dates.length < cap) {
      dates.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
  } else if (repeat === 'weekly') {
    const d = new Date(baseDate);
    d.setHours(0, 0, 0, 0);
    while (d <= until && dates.length < cap) {
      dates.push(new Date(d));
      d.setDate(d.getDate() + 7);
    }
  } else if (repeat === 'custom' && customDays.length > 0) {
    for (const dayIdx of customDays) {
      const d = new Date(baseDate);
      d.setHours(0, 0, 0, 0);
      const diff = (dayIdx - d.getDay() + 7) % 7;
      d.setDate(d.getDate() + diff);
      while (d <= until && dates.length < cap) {
        dates.push(new Date(d));
        d.setDate(d.getDate() + 7);
      }
    }
    dates.sort((a, b) => a.getTime() - b.getTime());
  }

  return dates.map((date) => ({
    title:      '', // filled in by caller
    start_time: new Date(date.getFullYear(), date.getMonth(), date.getDate(), sh, sm).toISOString(),
    end_time:   new Date(date.getFullYear(), date.getMonth(), date.getDate(), eh, em).toISOString(),
  }));
}

export default function AddBlockModal({ selectedDate, onAdd, onAddMany, onClose }: Props) {
  const base        = selectedDate ?? new Date();
  const defaults    = roundedNow();
  const defaultUntil = new Date(base);
  defaultUntil.setDate(defaultUntil.getDate() + 28);

  const [title,      setTitle]      = useState('');
  const [startTime,  setStartTime]  = useState(defaults.start);
  const [endTime,    setEndTime]    = useState(defaults.end);
  const [repeat,     setRepeat]     = useState<RepeatType>('none');
  const [customDays, setCustomDays] = useState<number[]>([base.getDay()]);
  const [untilDate,  setUntilDate]  = useState(toDateStr(defaultUntil));
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');

  const duration = calcDuration(startTime, endTime);
  const [sh, sm] = startTime ? startTime.split(':').map(Number) : [0, 0];
  const [eh, em] = endTime   ? endTime.split(':').map(Number)   : [0, 0];
  const timeValid    = startTime && endTime && (eh * 60 + em) > (sh * 60 + sm);
  const untilParsed  = untilDate ? new Date(`${untilDate}T23:59:59`) : null;

  const occurrences = (repeat !== 'none' && untilParsed && timeValid)
    ? generateOccurrences(base, sh, sm, eh, em, repeat, customDays, untilParsed)
    : [];

  function repeatSummary(): string {
    if (repeat === 'daily')  return 'every day';
    if (repeat === 'weekly') return `every ${DAY_FULL[base.getDay()]}`;
    if (repeat === 'custom') {
      if (customDays.length === 0) return 'no days selected';
      return [...customDays].sort((a, b) => a - b).map((d) => DAY_FULL[d]).join(', ');
    }
    return '';
  }

  const toggleDay = (d: number) =>
    setCustomDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!title.trim() || !startTime || !endTime) {
      setError('All fields are required');
      return;
    }
    if (!timeValid) {
      setError('End time must be after start time');
      return;
    }
    if (repeat === 'custom' && customDays.length === 0) {
      setError('Select at least one day');
      return;
    }
    if (repeat !== 'none' && !untilDate) {
      setError('Select a repeat end date');
      return;
    }

    setLoading(true);
    try {
      if (repeat === 'none') {
        const s = new Date(base.getFullYear(), base.getMonth(), base.getDate(), sh, sm);
        const e = new Date(base.getFullYear(), base.getMonth(), base.getDate(), eh, em);
        await onAdd({ title: title.trim(), start_time: s.toISOString(), end_time: e.toISOString() });
      } else {
        const blocks = occurrences.map((o) => ({ ...o, title: title.trim() }));
        if (onAddMany) {
          await onAddMany(blocks);
        } else {
          for (const block of blocks) await onAdd(block);
        }
      }
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
      <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4 max-h-[90vh] overflow-y-auto">
        <h3 className="text-base font-bold text-surface-900 mb-4">Add Time Block</h3>
        <form onSubmit={handleSubmit} className="space-y-3">

          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-surface-700 mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Lunch, Meeting, Focus time"
              autoFocus
              className="w-full border border-surface-200 rounded-lg px-3 py-2 text-sm text-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-teal-400"
            />
          </div>

          {/* Start / End */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-surface-700 mb-1">Start</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full border border-surface-200 rounded-lg px-3 py-2.5 text-sm font-semibold text-surface-900 bg-white focus:outline-none focus:ring-2 focus:ring-teal-400 [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:cursor-pointer"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-surface-700 mb-1">End</label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full border border-surface-200 rounded-lg px-3 py-2.5 text-sm font-semibold text-surface-900 bg-white focus:outline-none focus:ring-2 focus:ring-teal-400 [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:cursor-pointer"
              />
            </div>
          </div>

          {/* Time preview */}
          {duration && (
            <p className="text-xs text-teal-700 bg-teal-50 border border-teal-100 rounded-lg px-3 py-2">
              {formatTime12(startTime)} – {formatTime12(endTime)}{' '}
              <span className="text-teal-500">({duration})</span>
            </p>
          )}

          {/* Repeat frequency */}
          <div>
            <label className="block text-xs font-medium text-surface-700 mb-1.5">Repeat</label>
            <div className="flex gap-1.5 flex-wrap">
              {(['none', 'daily', 'weekly', 'custom'] as RepeatType[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRepeat(r)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
                    repeat === r
                      ? 'bg-teal-600 text-white border-teal-600'
                      : 'bg-white text-surface-600 border-surface-200 hover:bg-surface-50'
                  }`}
                >
                  {r === 'none' ? 'None' : r === 'daily' ? 'Daily' : r === 'weekly' ? 'Weekly' : 'Custom days'}
                </button>
              ))}
            </div>
          </div>

          {/* Custom day checkboxes */}
          {repeat === 'custom' && (
            <div>
              <label className="block text-xs font-medium text-surface-700 mb-1.5">Days of the week</label>
              <div className="flex gap-1">
                {DAY_LABELS.map((label, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => toggleDay(idx)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
                      customDays.includes(idx)
                        ? 'bg-teal-600 text-white border-teal-600'
                        : 'bg-white text-surface-500 border-surface-200 hover:bg-surface-50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Until date */}
          {repeat !== 'none' && (
            <div>
              <label className="block text-xs font-medium text-surface-700 mb-1">Repeat until</label>
              <input
                type="date"
                value={untilDate}
                min={toDateStr(base)}
                onChange={(e) => setUntilDate(e.target.value)}
                className="w-full border border-surface-200 rounded-lg px-3 py-2 text-sm text-surface-900 bg-white focus:outline-none focus:ring-2 focus:ring-teal-400"
              />
            </div>
          )}

          {/* Repeat summary */}
          {repeat !== 'none' && occurrences.length > 0 && (
            <p className="text-xs text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
              <span className="font-semibold">{occurrences.length} block{occurrences.length !== 1 ? 's' : ''}</span>
              {' '}— {repeatSummary()} until{' '}
              {new Date(`${untilDate}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </p>
          )}

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
              disabled={loading || (repeat === 'custom' && customDays.length === 0)}
              className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700 disabled:opacity-50 transition-colors"
            >
              {loading
                ? 'Adding…'
                : repeat === 'none'
                ? 'Add Block'
                : `Add ${occurrences.length > 0 ? occurrences.length + ' ' : ''}Block${occurrences.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

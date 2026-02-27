'use client';

import { useEffect, useState } from 'react';

const LS_KEY = 'ts_onboarding_seen';

export default function OnboardingTooltip() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(LS_KEY)) {
      const id = setTimeout(() => setVisible(true), 1500);
      return () => clearTimeout(id);
    }
  }, []);

  function dismiss() {
    localStorage.setItem(LS_KEY, '1');
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed bottom-24 right-6 z-50 w-64 bg-teal-600 text-white rounded-xl shadow-xl p-4">
      {/* Close */}
      <button
        onClick={dismiss}
        className="absolute top-2.5 right-2.5 w-5 h-5 flex items-center justify-center text-teal-200 hover:text-white transition-colors text-lg leading-none"
        aria-label="Dismiss"
      >
        ×
      </button>

      {/* Icon + heading */}
      <div className="flex items-start gap-2.5 mb-2">
        <svg className="w-5 h-5 flex-shrink-0 mt-0.5 text-teal-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        <p className="font-semibold text-sm leading-tight">How TimeSlot works</p>
      </div>

      {/* Steps */}
      <ol className="space-y-1.5 text-sm text-teal-50 ml-1">
        <li className="flex items-start gap-2">
          <span className="flex-shrink-0 w-4 h-4 rounded-full bg-teal-500 text-xs flex items-center justify-center font-bold mt-0.5">1</span>
          Tap <strong className="text-white mx-1">+</strong> and add your tasks to the queue
        </li>
        <li className="flex items-start gap-2">
          <span className="flex-shrink-0 w-4 h-4 rounded-full bg-teal-500 text-xs flex items-center justify-center font-bold mt-0.5">2</span>
          Click <strong className="text-white mx-1">Schedule All</strong> when your list is ready
        </li>
        <li className="flex items-start gap-2">
          <span className="flex-shrink-0 w-4 h-4 rounded-full bg-teal-500 text-xs flex items-center justify-center font-bold mt-0.5">3</span>
          AI fits everything into your free time automatically
        </li>
      </ol>

      <button
        onClick={dismiss}
        className="mt-3 w-full py-1.5 bg-teal-500 hover:bg-teal-400 rounded-lg text-xs font-semibold transition-colors"
      >
        Got it!
      </button>
    </div>
  );
}

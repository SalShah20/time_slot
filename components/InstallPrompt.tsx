'use client';

import { useEffect, useState } from 'react';

const LS_KEY = 'ts_install_dismissed';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Don't show if already running as standalone PWA
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    // Don't show if previously dismissed
    if (localStorage.getItem(LS_KEY)) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShow(true);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  async function handleInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
      setShow(false);
    }
  }

  function handleDismiss() {
    setShow(false);
    localStorage.setItem(LS_KEY, '1');
  }

  if (!show) return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 md:left-auto md:right-6 md:w-80 bg-white rounded-xl shadow-xl border border-surface-200 p-4 z-50">
      {/* Close */}
      <button
        onClick={handleDismiss}
        className="absolute top-2.5 right-2.5 w-6 h-6 flex items-center justify-center text-surface-400 hover:text-surface-600 rounded-full hover:bg-surface-100 transition-colors text-lg leading-none"
        aria-label="Dismiss"
      >
        ×
      </button>

      <div className="flex items-start gap-3 pr-5">
        {/* Icon */}
        <div className="w-10 h-10 flex-shrink-0 bg-teal-100 rounded-lg flex items-center justify-center">
          <svg className="w-5 h-5 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>

        <div className="flex-1">
          <p className="text-sm font-semibold text-surface-900">Install TimeSlot</p>
          <p className="text-xs text-surface-500 mt-0.5">
            Get faster access, offline support, and home screen shortcuts.
          </p>
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleInstall}
              className="px-3 py-1.5 bg-teal-600 text-white text-xs font-semibold rounded-lg hover:bg-teal-700 transition-colors"
            >
              Install
            </button>
            <button
              onClick={handleDismiss}
              className="px-3 py-1.5 text-xs text-surface-500 hover:text-surface-700 transition-colors"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

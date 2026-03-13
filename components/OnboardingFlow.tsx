'use client';

import { useState, useEffect, useMemo } from 'react';

const LS_KEY = 'ts_onboarding_seen';

interface StepConfig {
  id: string;
  target: string | null;
  title: string;
  body: string;
  button: string;
  /** CSS border-radius for the spotlight cutout */
  spotlightRadius: number;
  /** Padding around the target element */
  spotlightPadding: number;
}

const ALL_STEPS: StepConfig[] = [
  {
    id: 'welcome',
    target: null,
    title: 'Welcome to TimeSlot',
    body: 'You brain dump your tasks. We figure out when to do them. Takes about 60 seconds to set up.',
    button: "Let's go \u2192",
    spotlightRadius: 0,
    spotlightPadding: 0,
  },
  {
    id: 'gcal',
    target: 'gcal',
    title: 'Connect your calendar',
    body: 'TimeSlot reads your schedule so tasks never overlap your classes, meetings, or anything else.',
    button: 'Got it \u2192',
    spotlightRadius: 12,
    spotlightPadding: 8,
  },
  {
    id: 'fab',
    target: 'fab',
    title: 'Add your first task',
    body: "Tap + and type anything \u2014 'study for exam tomorrow 2 hours' or 'finish essay by Friday'. One task per line.",
    button: 'Got it \u2192',
    spotlightRadius: 9999,
    spotlightPadding: 10,
  },
  {
    id: 'schedule',
    target: 'schedule',
    title: 'Watch it appear',
    body: 'Your task will show up here, scheduled into your day automatically. No drag and drop. No manual planning.',
    button: 'Start using TimeSlot \u2713',
    spotlightRadius: 16,
    spotlightPadding: 4,
  },
];

interface Props {
  calendarConnected: boolean;
  onComplete: () => void;
  onSkip: () => void;
}

export default function OnboardingFlow({ calendarConnected, onComplete, onSkip }: Props) {
  const steps = useMemo(
    () => ALL_STEPS.filter((s) => !(s.id === 'gcal' && calendarConnected)),
    [calendarConnected],
  );

  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  const current = steps[stepIndex];

  // Measure the target element's position on each step change and on resize/scroll
  useEffect(() => {
    if (!current?.target) {
      setTargetRect(null);
      return;
    }

    const el = document.querySelector(`[data-onboarding="${current.target}"]`);
    if (!el) {
      setTargetRect(null);
      return;
    }

    const measure = () => {
      const r = el.getBoundingClientRect();
      // Hidden elements (display:none) return a zero-size rect — treat as absent
      if (r.width === 0 && r.height === 0) {
        setTargetRect(null);
      } else {
        setTargetRect(r);
      }
    };

    measure();
    // Re-measure after a tick for layout settling (e.g. fonts loading)
    const timer = setTimeout(measure, 60);

    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [current?.target, stepIndex]);

  function handleNext() {
    if (stepIndex + 1 >= steps.length) {
      localStorage.setItem(LS_KEY, '1');
      onComplete();
    } else {
      setStepIndex(stepIndex + 1);
    }
  }

  function handleSkip() {
    localStorage.setItem(LS_KEY, '1');
    onSkip();
  }

  if (!current) return null;

  const pad = current.spotlightPadding;
  const radius = current.spotlightRadius;

  return (
    <div className="fixed inset-0 z-[100]">
      {/* ── Overlay + spotlight ─────────────────────────────────────────── */}
      {targetRect ? (
        <>
          {/* Dark overlay with a bright cutout via box-shadow */}
          <div
            className="fixed"
            style={{
              top: targetRect.top - pad,
              left: targetRect.left - pad,
              width: targetRect.width + pad * 2,
              height: targetRect.height + pad * 2,
              borderRadius: radius,
              boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)',
              zIndex: 100,
            }}
          />
          {/* Pulsing teal ring around the target */}
          <div
            className="fixed pointer-events-none animate-pulse"
            style={{
              top: targetRect.top - pad - 4,
              left: targetRect.left - pad - 4,
              width: targetRect.width + pad * 2 + 8,
              height: targetRect.height + pad * 2 + 8,
              borderRadius: radius,
              border: '3px solid rgb(20, 184, 166)',
              zIndex: 101,
            }}
          />
        </>
      ) : (
        /* Full-screen overlay for the welcome step */
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm"
          style={{ zIndex: 100 }}
        />
      )}

      {/* Invisible click-blocker so nothing underneath is interactive */}
      <div className="fixed inset-0" style={{ zIndex: 99 }} />

      {/* ── Step card ───────────────────────────────────────────────────── */}
      <div
        className="fixed"
        style={{ zIndex: 102, ...getCardPosition(current.id, targetRect) }}
      >
        <div className="bg-white rounded-2xl shadow-2xl p-6 w-80 max-w-[calc(100vw-2rem)]">
          <p className="text-xs text-surface-400 mb-2">
            {stepIndex + 1} of {steps.length}
          </p>
          <h3 className="text-lg font-bold text-surface-900 mb-2">
            {current.title}
          </h3>
          <p className="text-sm text-surface-600 leading-relaxed">
            {current.body}
          </p>
          <div className="flex items-center justify-between mt-5">
            <button
              onClick={handleSkip}
              className="text-sm text-surface-400 hover:text-surface-600 transition-colors"
            >
              Skip
            </button>
            <button
              onClick={handleNext}
              className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              {current.button}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Card positioning — returns inline styles for the step card based on
 * which step is active and where the target element is on screen.
 * ──────────────────────────────────────────────────────────────────────────── */
function getCardPosition(
  stepId: string,
  rect: DOMRect | null,
): React.CSSProperties {
  const isMobile =
    typeof window !== 'undefined' && window.innerWidth < 768;

  // Welcome step or missing target — always center
  if (stepId === 'welcome' || !rect) {
    return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  }

  // Mobile: center horizontally, position relative to target vertically
  if (isMobile) {
    if (stepId === 'fab') {
      return { bottom: 140, left: '50%', transform: 'translateX(-50%)' };
    }
    return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  }

  // Desktop positioning near each target element
  switch (stepId) {
    case 'gcal':
      return {
        top: rect.bottom + 16,
        left: Math.max(16, rect.left),
      };
    case 'fab':
      return {
        bottom:
          (typeof window !== 'undefined' ? window.innerHeight : 800) -
          rect.top +
          16,
        right: 24,
      };
    case 'schedule':
      return {
        top: rect.top + rect.height / 2,
        left: rect.left + rect.width / 2,
        transform: 'translate(-50%, -50%)',
      };
    default:
      return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  }
}

'use client';

import { useConversation } from '@elevenlabs/react';
import { useState, useCallback, useRef } from 'react';

interface VoiceBrainDumpProps {
  onTaskCreated?: () => void;
}

export default function VoiceBrainDump({ onTaskCreated }: VoiceBrainDumpProps) {
  const [lastTask, setLastTask] = useState<string | null>(null);
  const didSaveRef = useRef(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const createTask = useCallback(
    async ({ task_description }: { task_description: string }) => {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

      // Parse the spoken text into structured task(s)
      const parseRes = await fetch('/api/tasks/brain-dump', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: task_description, timezone: tz }),
      });
      if (!parseRes.ok) return 'Failed to parse task.';

      const { tasks } = (await parseRes.json()) as {
        tasks: Array<{
          title: string;
          estimatedMinutes?: number;
          priority?: string;
          tag?: string;
          deadline?: string;
          description?: string;
          isFixed?: boolean;
          fixedStart?: string;
        }>;
      };
      if (!tasks?.length) return 'No task found in that description.';

      // Schedule the parsed task(s)
      const schedRes = await fetch('/api/tasks/batch-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks, timezone: tz }),
      });
      if (!schedRes.ok) return 'Failed to schedule task.';

      didSaveRef.current = true;
      setLastTask(tasks[0].title);
      onTaskCreated?.();
      return 'Task added!';
    },
    [onTaskCreated],
  );

  const conversation = useConversation({
    clientTools: {
      create_task: createTask,
    },
    onError: (error: unknown) => {
      console.error('Voice error:', error);
    },
  });

  const isConnected =
    conversation.status === 'connected' || conversation.status === 'connecting';

  const startSession = async () => {
    didSaveRef.current = false;
    setLastTask(null);
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);

    await navigator.mediaDevices.getUserMedia({ audio: true });
    await conversation.startSession({
      agentId: process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID!,
      connectionType: 'webrtc',
    });
  };

  const endSession = async () => {
    await conversation.endSession();
    if (didSaveRef.current && lastTask) {
      confirmTimerRef.current = setTimeout(() => {
        setLastTask(null);
        didSaveRef.current = false;
      }, 3000);
    }
  };

  // Derive visual state
  const agentSpeaking = isConnected && conversation.isSpeaking;
  const userTurn = isConnected && !conversation.isSpeaking;
  const showConfirmation = !isConnected && lastTask && didSaveRef.current;

  const micIcon = (
    <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 1a4 4 0 00-4 4v7a4 4 0 008 0V5a4 4 0 00-4-4z" />
      <path d="M19 11a7 7 0 01-14 0H3a9 9 0 008 8.94V22h2v-2.06A9 9 0 0021 11h-2z" />
    </svg>
  );
  const speakerIcon = (
    <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 8.14v7.72A4.49 4.49 0 0016.5 12zM14 3.23v2.06a6.51 6.51 0 010 13.42v2.06A8.51 8.51 0 0014 3.23z" />
    </svg>
  );
  const checkIcon = (
    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );

  let buttonClass =
    'w-20 h-20 rounded-full flex items-center justify-center text-white shadow-lg transition-all duration-200 select-none ';
  let icon = micIcon;
  let statusText = 'Tap to speak your task';

  if (userTurn) {
    buttonClass += 'bg-red-500 scale-110 animate-pulse';
    icon = micIcon;
    statusText = 'Listening...';
  } else if (agentSpeaking) {
    buttonClass += 'bg-teal-600 scale-110 ring-4 ring-teal-300/50';
    icon = speakerIcon;
    statusText = 'TimeSlot is talking...';
  } else if (conversation.status === 'connecting') {
    buttonClass += 'bg-teal-600 opacity-70 animate-pulse';
    icon = micIcon;
    statusText = 'Connecting...';
  } else if (showConfirmation) {
    buttonClass += 'bg-teal-600 hover:scale-105';
    icon = checkIcon;
    statusText = '';
  } else {
    buttonClass += 'bg-teal-600 hover:scale-105';
  }

  return (
    <div className="flex flex-col items-center gap-3 py-4">
      <button
        onClick={isConnected ? () => void endSession() : () => void startSession()}
        className={buttonClass}
      >
        {icon}
      </button>
      {showConfirmation ? (
        <p className="text-sm text-teal-700 font-medium text-center px-4 truncate max-w-[260px]">
          Added: &ldquo;{lastTask}&rdquo;
        </p>
      ) : (
        <p className="text-sm text-surface-500 text-center">{statusText}</p>
      )}
    </div>
  );
}

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

  let buttonClass =
    'w-20 h-20 rounded-full flex items-center justify-center text-3xl shadow-lg transition-all duration-200 select-none ';
  let emoji = '\uD83C\uDFA4'; // 🎤
  let statusText = 'Tap to speak your task';

  if (userTurn) {
    // User speaking: pulse red
    buttonClass += 'bg-red-500 scale-110 animate-pulse';
    emoji = '\uD83C\uDFA4'; // 🎤
    statusText = 'Listening...';
  } else if (agentSpeaking) {
    // Agent speaking: teal with ring glow
    buttonClass += 'bg-teal-600 scale-110 ring-4 ring-teal-300/50';
    emoji = '\uD83D\uDD0A'; // 🔊
    statusText = 'TimeSlot is talking...';
  } else if (conversation.status === 'connecting') {
    buttonClass += 'bg-teal-600 opacity-70 animate-pulse';
    emoji = '\u23F3'; // ⏳
    statusText = 'Connecting...';
  } else if (showConfirmation) {
    buttonClass += 'bg-teal-600 hover:scale-105';
    emoji = '\u2705'; // ✅
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
        <span className="leading-none">{emoji}</span>
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

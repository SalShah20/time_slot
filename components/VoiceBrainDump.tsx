'use client';

import { useConversation } from '@11labs/react';
import { useState } from 'react';

interface VoiceBrainDumpProps {
  onTaskExtracted: (taskText: string) => void;
}

export default function VoiceBrainDump({ onTaskExtracted }: VoiceBrainDumpProps) {
  const [status, setStatus] = useState<'idle' | 'listening' | 'processing'>('idle');

  const conversation = useConversation({
    onConnect: () => setStatus('listening'),
    onDisconnect: () => setStatus('idle'),
    onMessage: ({ message, source }) => {
      // When the agent sends a confirmation message, trigger task creation
      if (source === 'ai' && message.includes('Adding it now')) {
        // You'll parse the user's transcript here and call your task API
        onTaskExtracted(message);
      }
    },
    onError: (error) => {
      console.error('Voice error:', error);
      setStatus('idle');
    },
  });

  const startListening = async () => {
    await navigator.mediaDevices.getUserMedia({ audio: true }); // request mic
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (conversation as any).startSession({
      agentId: process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID!,
    });
  };

  const stopListening = () => {
    conversation.endSession();
  };

  return (
    <div className="flex flex-col items-center gap-4 p-6">
      <button
        onClick={status === 'idle' ? startListening : stopListening}
        className={`w-20 h-20 rounded-full flex items-center justify-center text-white text-3xl shadow-lg transition-all ${
          status === 'listening'
            ? 'bg-red-500 scale-110 animate-pulse'
            : 'bg-[#028090] hover:scale-105'
        }`}
      >
        {status === 'listening' ? '⏹' : '🎙️'}
      </button>
      <p className="text-sm text-gray-500">
        {status === 'idle' && 'Tap to speak your task'}
        {status === 'listening' && 'Listening... tap to stop'}
        {status === 'processing' && 'Adding your task...'}
      </p>
    </div>
  );
}

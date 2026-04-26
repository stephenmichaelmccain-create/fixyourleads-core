'use client';

import type { MouseEvent, PointerEvent } from 'react';
import { useEffect, useRef, useState } from 'react';

type SpeakProspectNameButtonProps = {
  name: string;
};

export function SpeakProspectNameButton({ name }: SpeakProspectNameButtonProps) {
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const [isSupported, setIsSupported] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  useEffect(() => {
    setIsSupported(typeof window !== 'undefined' && 'speechSynthesis' in window);

    return () => {
      if (typeof window !== 'undefined' && utteranceRef.current) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  if (!isSupported) {
    return null;
  }

  const blockCardSelection = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const speakName = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(name);
    const availableVoices = window.speechSynthesis.getVoices();
    const preferredVoice =
      availableVoices.find((voice) => voice.lang.toLowerCase().startsWith('en') && voice.localService) ||
      availableVoices.find((voice) => voice.lang.toLowerCase().startsWith('en')) ||
      null;

    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }

    utterance.rate = 0.96;
    utterance.pitch = 1;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    utteranceRef.current = utterance;
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  return (
    <button
      type="button"
      className={`lead-speak-button${isSpeaking ? ' is-speaking' : ''}`}
      aria-label={isSpeaking ? `Stop reading ${name}` : `Read ${name} aloud`}
      title={isSpeaking ? 'Stop reading' : 'Read name aloud'}
      onPointerDown={blockCardSelection}
      onClick={speakName}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M5 15h3.6l4.8 4V5l-4.8 4H5z" />
        <path d="M16.2 9.3a4.4 4.4 0 0 1 0 5.4" />
        <path d="M18.9 6.8a7.8 7.8 0 0 1 0 10.4" />
      </svg>
    </button>
  );
}

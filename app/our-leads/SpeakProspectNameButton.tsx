'use client';

import type { MouseEvent, PointerEvent } from 'react';
import { useEffect, useRef, useState } from 'react';

type SpeakProspectNameButtonProps = {
  name: string;
};

const PREFERRED_VOICE_NAMES = [
  'Google US English',
  'Samantha',
  'Ava',
  'Allison',
  'Aaron',
  'Nicky',
  'Joanna',
  'Matthew',
  'Aria',
  'Jenny',
  'Guy',
  'Daniel'
];

function buildPronunciationText(name: string) {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b&\b/g, ' and ')
    .replace(/\bco\b\.?/gi, ' company')
    .replace(/\binc\b\.?/gi, ' incorporated')
    .replace(/\bllc\b\.?/gi, ' L L C')
    .replace(/\bltd\b\.?/gi, ' limited')
    .replace(/\bpc\b\.?/gi, ' P C')
    .replace(/\bpllc\b\.?/gi, ' P L L C')
    .replace(/\bmd\b\.?/gi, ' M D')
    .replace(/\bpa\b\.?/gi, ' P A')
    .replace(/\beye\s?care\b/gi, ' eye care')
    .replace(/\s*[-/|]\s*/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function pickPreferredVoice(voices: SpeechSynthesisVoice[]) {
  const englishVoices = voices.filter((voice) => voice.lang.toLowerCase().startsWith('en'));

  for (const preferredName of PREFERRED_VOICE_NAMES) {
    const preferredVoice = englishVoices.find((voice) =>
      voice.name.toLowerCase().includes(preferredName.toLowerCase())
    );

    if (preferredVoice) {
      return preferredVoice;
    }
  }

  return (
    englishVoices.find((voice) => voice.localService && /us|en-us/i.test(voice.lang)) ||
    englishVoices.find((voice) => /female|natural|enhanced|premium/i.test(voice.name)) ||
    englishVoices.find((voice) => voice.localService) ||
    englishVoices[0] ||
    null
  );
}

export function SpeakProspectNameButton({ name }: SpeakProspectNameButtonProps) {
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const [isSupported, setIsSupported] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setIsSupported(false);
      return;
    }

    setIsSupported(true);

    const loadVoices = () => {
      setVoices(window.speechSynthesis.getVoices());
    };

    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);

    return () => {
      if (typeof window !== 'undefined' && utteranceRef.current) {
        window.speechSynthesis.cancel();
      }

      window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
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

    const utterance = new SpeechSynthesisUtterance(buildPronunciationText(name));
    const preferredVoice = pickPreferredVoice(voices.length ? voices : window.speechSynthesis.getVoices());

    if (preferredVoice) {
      utterance.voice = preferredVoice;
      utterance.lang = preferredVoice.lang;
    }

    utterance.rate = 0.8;
    utterance.pitch = 1;
    utterance.volume = 1;
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

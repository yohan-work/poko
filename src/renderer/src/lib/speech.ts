import { useSyncExternalStore } from "react";

/**
 * Reading answers aloud with the system voices (Web Speech synthesis, on the Mac itself).
 * Only one answer is read at a time; `speakingId` names it so its button can show "stop".
 */

/** Markdown as it would be read: code left out, marks and link targets dropped. */
export function speakableText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?(```|$)/g, "\n(코드는 생략할게.)\n")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, "")
    .replace(/\|/g, " ")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/[*_~]+/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

let speakingId: string | null = null;
const listeners = new Set<() => void>();

function setSpeaking(id: string | null): void {
  speakingId = id;
  for (const listener of listeners) listener();
}

function synth(): SpeechSynthesis | null {
  return typeof window !== "undefined" && "speechSynthesis" in window
    ? window.speechSynthesis
    : null;
}

// Chromium loads the voice list lazily; asking once at startup has it ready by the first press.
synth()?.getVoices();

const isKorean = (text: string) => /[가-힣]/.test(text);

/** A Korean voice for Korean text, when the Mac has one; otherwise the default voice. */
function voiceFor(text: string, speech: SpeechSynthesis): SpeechSynthesisVoice | null {
  if (!isKorean(text)) return null;
  return speech.getVoices().find((voice) => voice.lang.toLowerCase().startsWith("ko")) ?? null;
}

/** Reads one answer, stopping any other; reading the same one again stops it. */
export function toggleSpeaking(id: string, markdown: string): void {
  const speech = synth();
  if (!speech) return;
  const wasThis = speakingId === id;
  speech.cancel();
  setSpeaking(null);
  if (wasThis) return;
  const text = speakableText(markdown);
  if (!text) return;
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = voiceFor(text, speech);
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  } else if (isKorean(text)) {
    // No voice list yet: the language still lets the Mac pick a Korean voice.
    utterance.lang = "ko-KR";
  }
  const done = () => {
    if (speakingId === id) setSpeaking(null);
  };
  utterance.onend = done;
  utterance.onerror = done;
  setSpeaking(id);
  speech.speak(utterance);
}

export function stopSpeaking(): void {
  synth()?.cancel();
  setSpeaking(null);
}

export const canSpeak = (): boolean => synth() !== null;

/** The id of the answer being read, or null. */
export function useSpeakingId(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => speakingId,
    () => null,
  );
}

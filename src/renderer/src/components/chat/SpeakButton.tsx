import { canSpeak, toggleSpeaking, useSpeakingId } from "../../lib/speech";
import { Icon } from "../Icon";

/** Reads one answer aloud with the Mac's voice; pressed again (or on another answer), it stops. */
export function SpeakButton({ id, text }: { id: string; text: string }) {
  const speaking = useSpeakingId() === id;
  if (!canSpeak()) return null;
  return (
    <button
      className="speak-button"
      type="button"
      aria-pressed={speaking}
      aria-label={speaking ? "읽기 멈추기" : "소리 내어 읽기"}
      title={speaking ? "읽기 멈추기" : "소리 내어 읽기"}
      onClick={() => toggleSpeaking(id, text)}
    >
      <Icon name={speaking ? "stop" : "speaker"} />
      <span>{speaking ? "멈추기" : "읽어 주기"}</span>
    </button>
  );
}

import type { CharacterState } from "../../../../../electron/shared";

interface CharacterProps {
  state: CharacterState;
  /** Rendered width and height in pixels. */
  size?: number;
  /** Shows the short state label under the character. */
  showStatus?: boolean;
}

export const stateLabels: Record<CharacterState, string> = {
  idle: "여기 있어",
  listening: "듣고 있어",
  thinking: "생각하고 있어",
  working: "살펴보고 있어",
  success: "확인했어",
  error: "잠깐 문제가 생겼어",
  approval: "네 확인이 필요해",
};

export function Character({ state, size = 72, showStatus = false }: CharacterProps) {
  return (
    <div className={`character character--${state}`}>
      <svg
        className="character__art"
        role="img"
        aria-label={`Poko ${stateLabels[state]}`}
        width={size}
        height={size}
        viewBox="0 0 100 100"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle className="character__ring" cx="50" cy="50" r="47" />
        <g className="character__body-group">
          <circle className="character__body" cx="50" cy="50" r="40" />
          <g className="character__eyes">
            <path className="character__eye character__eye--left" d="M59.5 29l-2.5 9" />
            <path className="character__eye character__eye--right" d="M73.5 31.5l-2.5 9" />
          </g>
          <path className="character__happy" d="M53 37q4.5-6 9 0M67 39.5q4.5-6 9 0" />
        </g>
      </svg>
      {showStatus && (
        <span className="character__status" aria-live="polite">
          {stateLabels[state]}
        </span>
      )}
    </div>
  );
}

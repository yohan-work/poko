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
        <circle className="character__ring" cx="46" cy="55" r="42" />
        <g className="character__body-group">
          <circle className="character__body" cx="46" cy="55" r="35" />
          <g className="character__eyes">
            <rect className="character__eye" x="34" y="44" width="7.5" height="15" rx="3.75" />
            <rect className="character__eye" x="48" y="44" width="7.5" height="15" rx="3.75" />
          </g>
          <path className="character__happy" d="M34 54q3.75-6 7.5 0M48 54q3.75-6 7.5 0" />
        </g>
        {/* Poko's companion dot: orbits while thinking, blinks for approval, falls on error. */}
        <g className="character__orbit">
          <circle className="character__satellite" cx="81" cy="21" r="7.5" />
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

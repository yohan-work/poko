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
        <circle className="character__ring" cx="50" cy="54" r="37" />
        <g className="character__body-group">
          <circle className="character__body" cx="50" cy="54" r="31" />
          <g className="character__eyes">
            <rect className="character__eye" x="39.4" y="44.3" width="6.6" height="13.3" rx="3.3" />
            <rect className="character__eye" x="51.8" y="44.3" width="6.6" height="13.3" rx="3.3" />
          </g>
          <path className="character__happy" d="M39.4 52.6q3.3-5.3 6.6 0M51.8 52.6q3.3-5.3 6.6 0" />
        </g>
        {/* Poko's companion dot orbits at radius 38 so its whole path stays inside the viewBox. */}
        <g className="character__orbit">
          <circle className="character__satellite" cx="76.9" cy="27.1" r="6.5" />
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

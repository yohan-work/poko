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
        <ellipse className="character__ring" cx="50" cy="55" rx="46" ry="40" />
        <g className="character__body-group">
          <path className="character__sprout" d="M50 21C48 11 53 4 62 2C63 12 58 18 50 21Z" />
          <path
            className="character__body"
            d="M50 20C74 20 88 39 88 61C88 79 72 87 50 87C28 87 12 79 12 61C12 39 26 20 50 20Z"
          />
          <ellipse className="character__cheek" cx="30" cy="66" rx="5.5" ry="3.2" />
          <ellipse className="character__cheek" cx="70" cy="66" rx="5.5" ry="3.2" />
          <g className="character__eyes">
            <ellipse className="character__eye" cx="41" cy="56" rx="4.3" ry="6.2" />
            <ellipse className="character__eye" cx="59" cy="56" rx="4.3" ry="6.2" />
          </g>
          <path className="character__happy" d="M36.5 57.5q4.5-6 9 0M54.5 57.5q4.5-6 9 0" />
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

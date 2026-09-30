import type { CharacterState } from "../../../../../electron/shared";

interface CharacterProps {
  state: CharacterState;
}

const stateLabels: Record<CharacterState, string> = {
  idle: "여기 있어",
  listening: "듣고 있어",
  thinking: "생각하고 있어",
  working: "살펴보고 있어",
  success: "확인했어",
  error: "잠깐 문제가 생겼어",
  approval: "네 확인이 필요해",
};

export function Character({ state }: CharacterProps) {
  return (
    <div className={`character character--${state}`}>
      <svg
        className="character__art"
        role="img"
        aria-label={`Poko ${stateLabels[state]}`}
        viewBox="0 0 192 176"
        xmlns="http://www.w3.org/2000/svg"
      >
        <ellipse className="character__shadow" cx="96" cy="157" rx="44" ry="8" />
        <path
          className="character__body"
          d="M48 87c0-31 20-54 48-54s48 23 48 54v34c0 17-12 27-29 27H77c-17 0-29-10-29-27V87Z"
        />
        <path className="character__tuft" d="M91 38c-3-13 7-24 17-29 2 14-2 24-13 32" />
        <path className="character__arm" d="M51 101c-11 2-17 10-17 19 9 7 20 4 27-4" />
        <path
          className="character__arm character__arm--right"
          d="M141 101c11 2 17 10 17 19-9 7-20 4-27-4"
        />
        <ellipse className="character__cheek" cx="68" cy="103" rx="8" ry="5" />
        <ellipse className="character__cheek" cx="124" cy="103" rx="8" ry="5" />
        <circle className="character__eye character__eye--left" cx="82" cy="89" r="3.5" />
        <circle className="character__eye character__eye--right" cx="110" cy="89" r="3.5" />
        <path className="character__mouth" d="M91 104c3 4 7 4 10 0" />
        <path className="character__brow" d="M76 81l9-2M107 79l9 2" />
        <circle className="character__spark" cx="151" cy="47" r="3" />
      </svg>
      <span className="character__status" aria-live="polite">
        {stateLabels[state]}
      </span>
    </div>
  );
}

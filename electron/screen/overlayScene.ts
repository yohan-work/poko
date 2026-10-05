import type { OverlayScene } from "../shared";
import type { AxElement, Frame, WindowSnapshot } from "./axHelper";
import { listedElements } from "./lookPrompt";

/** Poko points at no more than this many elements per answer. */
export const MAX_POINTS = 3;
const MAX_LABEL = 40;

const roleNames: Record<string, string> = {
  AXButton: "버튼",
  AXLink: "링크",
  AXTextField: "입력창",
  AXTextArea: "입력창",
  AXSearchField: "검색창",
  AXCheckBox: "체크박스",
  AXRadioButton: "선택 버튼",
  AXPopUpButton: "선택 메뉴",
  AXComboBox: "선택 메뉴",
  AXMenuItem: "메뉴",
  AXMenuButton: "메뉴",
  AXTab: "탭",
  AXHeading: "제목",
  AXImage: "이미지",
};

const CITATION = /\[(\d{1,4})\]/g;
/** Fenced blocks and inline code: `items[0]` there is code, not a citation. */
const CODE = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/;

/** Only elements Codex was shown can be cited. */
function listedById(snapshot: WindowSnapshot): Map<number, AxElement> {
  return new Map(listedElements(snapshot).map((element) => [element.id, element]));
}

/** Applies `replace` to the prose of a Markdown answer, leaving code untouched. */
function outsideCode(answer: string, replace: (prose: string) => string): string {
  return answer
    .split(CODE)
    .map((part, index) => (index % 2 === 1 ? part : replace(part)))
    .join("");
}

/** A short, single-line name for an element, from its (untrusted) label or its role. */
export function elementName(element: AxElement): string {
  const label = element.label?.replace(/\s+/g, " ").trim();
  if (label) return label.length <= MAX_LABEL ? label : `${label.slice(0, MAX_LABEL - 1)}…`;
  return roleNames[element.role] ?? "이 부분";
}

/**
 * Elements the answer cited as `[12]`, in order, that Codex was shown and that lie inside the
 * picked window and the display. The limit applies after that filter, so a cited element that
 * is scrolled away never takes the place of one Poko can point at.
 */
export function citedElements(
  answer: string,
  snapshot: WindowSnapshot,
  display: Frame,
): AxElement[] {
  const byId = listedById(snapshot);
  const prose = answer.split(CODE).filter((_, index) => index % 2 === 0);
  const cited: AxElement[] = [];
  for (const match of prose.join("\n").matchAll(CITATION)) {
    const element = byId.get(Number(match[1]));
    const frame = element?.frame;
    if (!element || !frame || frame.width <= 0 || frame.height <= 0) continue;
    if (!overlaps(frame, snapshot.window.frame) || !overlaps(frame, display)) continue;
    if (!cited.includes(element)) cited.push(element);
    if (cited.length === MAX_POINTS) break;
  }
  return cited;
}

/**
 * The chat shows names instead of element numbers. Unknown numbers are left as written.
 * Backticks and brackets are removed from names so a label can't change the Markdown around it.
 */
/** Marks a dropped citation until the spaces before it are removed too. */
const DROPPED = "\u0000";

export function replaceCitations(answer: string, snapshot: WindowSnapshot): string {
  const byId = listedById(snapshot);
  return outsideCode(answer, (prose) =>
    prose
      .replace(CITATION, (whole, id: string) => {
        const element = byId.get(Number(id));
        if (!element) return whole;
        // An element with no name or known role reads as nothing useful ("이 부분"), so the
        // citation is dropped from the text; Poko still flies to it.
        if (!element.label?.trim() && !roleNames[element.role]) return DROPPED;
        return `‘${elementName(element).replace(/[`[\]*_<>]/g, "")}’`;
      })
      // A dropped citation takes the spaces before it along.
      .replace(/[ \t]*\u0000/g, ""),
  );
}

function overlaps(frame: Frame, bounds: Frame): boolean {
  return (
    frame.x < bounds.x + bounds.width &&
    frame.x + frame.width > bounds.x &&
    frame.y < bounds.y + bounds.height &&
    frame.y + frame.height > bounds.y
  );
}

/**
 * The scene for the overlay on one display. Frames become relative to the display. Points
 * outside the window or display are dropped again here, so Poko never points somewhere it
 * didn't look.
 */
export function buildOverlayScene(
  snapshot: WindowSnapshot,
  elements: AxElement[],
  display: Frame,
  /** What Poko says instead of naming the element, for a proposed step. */
  say?: string,
): OverlayScene | null {
  const window = snapshot.window.frame;
  const relative = (frame: Frame): Frame => ({
    x: frame.x - display.x,
    y: frame.y - display.y,
    width: frame.width,
    height: frame.height,
  });
  const points = elements
    .filter(
      (element) =>
        element.frame && overlaps(element.frame, window) && overlaps(element.frame, display),
    )
    .map((element) => ({
      frame: relative(element.frame as Frame),
      say: say ?? `여기야: ${elementName(element)}`,
    }));
  if (points.length === 0) return null;
  return {
    display: { width: display.width, height: display.height },
    origin: relative(window),
    points,
  };
}

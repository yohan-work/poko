import type { OverlayScene } from "../shared";
import type { AxElement, Frame, WindowSnapshot } from "./axHelper";

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

/** A short, single-line name for an element, from its (untrusted) label or its role. */
export function elementName(element: AxElement): string {
  const label = element.label?.replace(/\s+/g, " ").trim();
  if (label) return label.length <= MAX_LABEL ? label : `${label.slice(0, MAX_LABEL - 1)}…`;
  return roleNames[element.role] ?? "이 부분";
}

/** Elements the answer cited as `[12]`, in order, that exist and have a frame on screen. */
export function citedElements(answer: string, snapshot: WindowSnapshot): AxElement[] {
  const byId = new Map(snapshot.elements.map((element) => [element.id, element]));
  const cited: AxElement[] = [];
  for (const match of answer.matchAll(CITATION)) {
    const element = byId.get(Number(match[1]));
    if (!element?.frame || element.frame.width <= 0 || element.frame.height <= 0) continue;
    if (!cited.includes(element)) cited.push(element);
    if (cited.length === MAX_POINTS) break;
  }
  return cited;
}

/**
 * The chat shows names instead of element numbers. Unknown numbers are left as written.
 * Backticks and brackets are removed from names so a label can't change the Markdown around it.
 */
export function replaceCitations(answer: string, snapshot: WindowSnapshot): string {
  const byId = new Map(snapshot.elements.map((element) => [element.id, element]));
  return answer.replace(CITATION, (whole, id: string) => {
    const element = byId.get(Number(id));
    if (!element) return whole;
    return `‘${elementName(element).replace(/[`[\]*_<>]/g, "")}’`;
  });
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
 * The scene for the overlay on one display. Frames become relative to the display, and parts
 * outside the window or display are dropped, so Poko never points somewhere it didn't look.
 */
export function buildOverlayScene(
  snapshot: WindowSnapshot,
  elements: AxElement[],
  display: Frame,
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
      say: `여기야: ${elementName(element)}`,
    }));
  if (points.length === 0) return null;
  return {
    display: { width: display.width, height: display.height },
    origin: relative(window),
    points,
  };
}

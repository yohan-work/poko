import type { ChatAttachment } from "../../../../electron/shared";

export const MAX_FILES = 5;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_BYTES = 200 * 1024;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

/**
 * Reads a file the user dropped or pasted into an attachment, or explains why it can't be
 * attached. Main checks everything again; this keeps the message box honest early.
 */
export async function readAttachment(file: File): Promise<ChatAttachment | { error: string }> {
  const name = file.name || "붙여넣은 이미지.png";
  if (IMAGE_TYPES.has(file.type)) {
    if (file.size > MAX_IMAGE_BYTES) return { error: `${name}: 이미지는 5MB까지 붙일 수 있어.` };
    return { kind: "image", name, mediaType: file.type, data: toBase64(await file.arrayBuffer()) };
  }
  if (file.type.startsWith("image/"))
    return { error: `${name}: PNG, JPEG, GIF, WebP 이미지만 붙일 수 있어.` };
  if (file.size > MAX_TEXT_BYTES)
    return { error: `${name}: 텍스트 파일은 200KB까지 붙일 수 있어.` };
  const text = await file.text();
  if (text.includes("\u0000")) return { error: `${name}: 텍스트 파일이 아니라서 붙일 수 없어.` };
  return { kind: "text", name, mediaType: file.type || "text/plain", data: text };
}

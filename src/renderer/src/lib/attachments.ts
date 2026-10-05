import {
  ATTACHMENT_LIMITS,
  type ChatAttachment,
  cleanAttachmentName,
} from "../../../../electron/shared";

export const MAX_FILES = ATTACHMENT_LIMITS.count;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

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
  const name = cleanAttachmentName(file.name || "붙여넣은 이미지.png");
  if (IMAGE_TYPES.has(file.type)) {
    if (file.size > ATTACHMENT_LIMITS.imageBytes)
      return { error: `${name}: 이미지는 3.5MB까지 붙일 수 있어.` };
    return { kind: "image", name, mediaType: file.type, data: toBase64(await file.arrayBuffer()) };
  }
  if (file.type.startsWith("image/"))
    return { error: `${name}: PNG, JPEG, GIF, WebP 이미지만 붙일 수 있어.` };
  // Up to 4 bytes per character, so anything larger can't fit; the exact check is on characters.
  const tooBig = { error: `${name}: 텍스트 파일은 200KB까지 붙일 수 있어.` };
  if (file.size > ATTACHMENT_LIMITS.textChars * 4) return tooBig;
  const text = await file.text();
  if (text.length > ATTACHMENT_LIMITS.textChars) return tooBig;
  if (text.includes("\u0000")) return { error: `${name}: 텍스트 파일이 아니라서 붙일 수 없어.` };
  return { kind: "text", name, mediaType: file.type || "text/plain", data: text };
}

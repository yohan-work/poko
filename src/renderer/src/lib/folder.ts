/** The last part of a folder path, as the folder button shows it ("/" stays "/"). */
export function folderName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

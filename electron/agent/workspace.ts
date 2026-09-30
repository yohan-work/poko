import { realpath, stat } from "node:fs/promises";

export async function resolveWorkspaceDirectory(workspacePath: string | null): Promise<string> {
  if (!workspacePath) {
    throw new Error("먼저 작업할 폴더를 선택해 줘.");
  }

  try {
    const resolvedPath = await realpath(workspacePath);
    const information = await stat(resolvedPath);
    if (!information.isDirectory()) throw new Error("not a directory");
    return resolvedPath;
  } catch {
    throw new Error("저장된 작업 폴더를 찾지 못했어. 다시 선택해 줘.");
  }
}

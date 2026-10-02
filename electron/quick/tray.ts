import { join } from "node:path";
import { app, Menu, nativeImage, Tray } from "electron";
import type { QuickShortcut } from "../shared";

let tray: Tray | null = null;

/** The menu bar image ships beside the app (extraResources) and lives in resources/ in dev. */
function imagePath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "tray", "trayTemplate.png")
    : join(app.getAppPath(), "resources", "tray", "trayTemplate.png");
}

interface TrayActions {
  ask: () => void;
  open: () => void;
}

/**
 * Poko in the menu bar: ask from anywhere, open the app, or quit. A template image, so macOS
 * tints it for light and dark menu bars. Created once; the menu follows the shortcut setting.
 */
export function showTray(actions: TrayActions, shortcut: QuickShortcut): void {
  if (!tray) {
    const image = nativeImage.createFromPath(imagePath());
    image.setTemplateImage(true);
    tray = new Tray(image);
    tray.setToolTip("Poko");
  }
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "포코에게 묻기",
        // Shown for reference only; the global shortcut itself is registered separately.
        ...(shortcut === "off" ? {} : { accelerator: shortcut, registerAccelerator: false }),
        click: actions.ask,
      },
      { label: "포코 열기", click: actions.open },
      { type: "separator" },
      { label: "종료", role: "quit" },
    ]),
  );
}

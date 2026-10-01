// poko-ax: Poko's macOS window and accessibility helper (Phase 06).
//
//   poko-ax permissions          -> {"accessibility": Bool, "screen": Bool}
//   poko-ax windows              -> {"windows": [{id, pid, owner, bundleId, title, frame}]}
//   poko-ax snapshot <windowId>  -> {"window": {...}, "elements": [...]} or {"error": ...}
//
// Read-only: this helper never performs actions. Output is one JSON object on stdout.

import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

let maxDepth = 40
let maxElements = 400
let maxText = 200

func emit(_ value: Any) {
  if let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
    let text = String(data: data, encoding: .utf8)
  {
    print(text)
  } else {
    print("{\"error\":\"encode_failed\"}")
  }
}

func fail(_ code: String, _ message: String) -> Never {
  emit(["error": code, "message": message])
  exit(1)
}

func rect(_ dict: [String: Any]) -> [String: Double]? {
  guard let x = dict["X"] as? Double, let y = dict["Y"] as? Double,
    let w = dict["Width"] as? Double, let h = dict["Height"] as? Double
  else { return nil }
  return ["x": x, "y": y, "width": w, "height": h]
}

func windowInfos() -> [[String: Any]] {
  let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
  return (CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]]) ?? []
}

func describe(_ info: [String: Any]) -> [String: Any]? {
  guard let id = info[kCGWindowNumber as String] as? Int,
    let pid = info[kCGWindowOwnerPID as String] as? Int32,
    let layer = info[kCGWindowLayer as String] as? Int, layer == 0,
    let bounds = info[kCGWindowBounds as String] as? [String: Any], let frame = rect(bounds),
    frame["width"]! >= 80, frame["height"]! >= 60
  else { return nil }
  var out: [String: Any] = [
    "id": id, "pid": Int(pid), "frame": frame,
    "owner": info[kCGWindowOwnerName as String] as? String ?? "",
    // Titles of other apps need Screen Recording permission; empty without it.
    "title": info[kCGWindowName as String] as? String ?? "",
  ]
  if let bundle = NSRunningApplication(processIdentifier: pid)?.bundleIdentifier {
    out["bundleId"] = bundle
  }
  return out
}

func copy(_ element: AXUIElement, _ attribute: String) -> AnyObject? {
  var value: AnyObject?
  return AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success
    ? value : nil
}

func text(_ element: AXUIElement, _ attribute: String) -> String? {
  guard let value = copy(element, attribute) as? String, !value.isEmpty else { return nil }
  return String(value.prefix(maxText))
}

func frameOf(_ element: AXUIElement) -> [String: Double]? {
  guard let positionValue = copy(element, kAXPositionAttribute),
    let sizeValue = copy(element, kAXSizeAttribute)
  else { return nil }
  var point = CGPoint.zero
  var size = CGSize.zero
  guard AXValueGetValue(positionValue as! AXValue, .cgPoint, &point),
    AXValueGetValue(sizeValue as! AXValue, .cgSize, &size)
  else { return nil }
  return [
    "x": Double(point.x), "y": Double(point.y), "width": Double(size.width),
    "height": Double(size.height),
  ]
}

/// Scale of the screen holding most of the window (CG coordinates are top-left based).
func scaleFor(_ frame: [String: Double]) -> Double {
  guard let primary = NSScreen.screens.first else { return 2 }
  let window = CGRect(
    x: frame["x"]!, y: primary.frame.height - frame["y"]! - frame["height"]!,
    width: frame["width"]!, height: frame["height"]!)
  let best = NSScreen.screens.max { a, b in
    a.frame.intersection(window).width * a.frame.intersection(window).height
      < b.frame.intersection(window).width * b.frame.intersection(window).height
  }
  return Double(best?.backingScaleFactor ?? 2)
}

let interestingRoles: Set<String> = [
  "AXButton", "AXLink", "AXTextField", "AXTextArea", "AXSearchField", "AXCheckBox",
  "AXRadioButton", "AXPopUpButton", "AXComboBox", "AXMenuItem", "AXMenuButton", "AXTab",
  "AXSlider", "AXWebArea", "AXHeading", "AXStaticText", "AXImage", "AXCell", "AXRow",
]

func snapshot(windowId: Int) {
  guard let info = windowInfos().first(where: { ($0[kCGWindowNumber as String] as? Int) == windowId }),
    let described = describe(info)
  else { fail("window_not_found", "The window is no longer on screen.") }
  let pid = Int32(described["pid"] as! Int)
  let target = described["frame"] as! [String: Double]
  let app = AXUIElementCreateApplication(pid)
  AXUIElementSetMessagingTimeout(app, 1.5)
  // Chromium and Electron apps expose web content only when asked; this changes nothing visible.
  AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
  let windows = (copy(app, kAXWindowsAttribute) as? [AXUIElement]) ?? []
  let title = described["title"] as? String ?? ""
  let close: (Double, Double) -> Bool = { abs($0 - $1) <= 2 }
  var matches = windows.filter { window in
    guard let frame = frameOf(window) else { return false }
    return close(frame["x"]!, target["x"]!) && close(frame["y"]!, target["y"]!)
      && close(frame["width"]!, target["width"]!) && close(frame["height"]!, target["height"]!)
  }
  if matches.count > 1, !title.isEmpty {
    matches = matches.filter { (text($0, kAXTitleAttribute) ?? "") == title }
  }
  guard matches.count == 1, let window = matches.first else {
    fail(
      matches.isEmpty ? "window_not_matched" : "window_ambiguous",
      "The picked window could not be matched to exactly one accessibility window.")
  }

  var elements: [[String: Any]] = []
  var queue: [(AXUIElement, [Int], Int)] = [(window, [], 0)]
  var visited = 0
  while !queue.isEmpty, elements.count < maxElements, visited < maxElements * 10 {
    let (element, path, depth) = queue.removeFirst()
    visited += 1
    let role = text(element, kAXRoleAttribute) ?? ""
    let subrole = text(element, kAXSubroleAttribute)
    let label = text(element, kAXTitleAttribute) ?? text(element, kAXDescriptionAttribute)
      ?? text(element, kAXPlaceholderValueAttribute)
    let value = text(element, kAXValueAttribute)
    if !path.isEmpty, interestingRoles.contains(role) || label != nil {
      var settable: DarwinBoolean = false
      AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable)
      var entry: [String: Any] = [
        "id": elements.count, "role": role, "path": path,
        "enabled": (copy(element, kAXEnabledAttribute) as? Bool) ?? true,
        "settable": settable.boolValue,
        "secure": subrole == "AXSecureTextField",
      ]
      if let subrole { entry["subrole"] = subrole }
      if let label { entry["label"] = label }
      if let value, subrole != "AXSecureTextField" { entry["value"] = value }
      if let frame = frameOf(element) { entry["frame"] = frame }
      if let url = copy(element, kAXURLAttribute) as? URL { entry["url"] = url.absoluteString }
      elements.append(entry)
    }
    if depth < maxDepth, let children = copy(element, kAXChildrenAttribute) as? [AXUIElement] {
      for (index, child) in children.enumerated() { queue.append((child, path + [index], depth + 1)) }
    }
  }

  var windowOut = described
  windowOut["scale"] = scaleFor(target)
  emit(["window": windowOut, "elements": elements, "truncated": !queue.isEmpty])
}

let args = CommandLine.arguments
switch args.count > 1 ? args[1] : "" {
case "permissions":
  emit(["accessibility": AXIsProcessTrusted(), "screen": CGPreflightScreenCaptureAccess()])
case "windows":
  emit(["windows": windowInfos().compactMap(describe)])
case "snapshot":
  guard args.count > 2, let id = Int(args[2]) else { fail("usage", "snapshot <windowId>") }
  guard AXIsProcessTrusted() else { fail("no_accessibility", "Accessibility permission is missing.") }
  snapshot(windowId: id)
default:
  fail("usage", "poko-ax permissions | windows | snapshot <windowId>")
}

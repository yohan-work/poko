// poko-ax: Poko's macOS window and accessibility helper (Phase 06).
//
//   poko-ax permissions          -> {"accessibility": Bool, "screen": Bool}
//   poko-ax windows              -> {"windows": [{id, pid, owner, bundleId, title, frame}]}
//   poko-ax snapshot <windowId>  -> {"window": {...}, "elements": [...]} or {"error": ...}
//   poko-ax act <windowId>       -> reads {kind, path, role, label, frame, text?, intent?,
//                                   ignorePid?} from stdin; kind "check" only validates (for
//                                   the action named by `intent`).
//
// Output is one JSON object on stdout. Only `act` changes anything, and only after every check
// below passes; text to type comes on stdin so it never shows in the process list.

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

let minVisible = 4.0

/** The smaller side of the part of `frame` inside `bounds`, or 0 when they don't overlap. */
func visibleSize(_ frame: [String: Double], _ bounds: [String: Double]) -> Double {
  let width = min(frame["x"]! + frame["width"]!, bounds["x"]! + bounds["width"]!)
    - max(frame["x"]!, bounds["x"]!)
  let height = min(frame["y"]! + frame["height"]!, bounds["y"]! + bounds["height"]!)
    - max(frame["y"]!, bounds["y"]!)
  return max(0, min(width, height))
}

let interestingRoles: Set<String> = [
  "AXButton", "AXLink", "AXTextField", "AXTextArea", "AXSearchField", "AXCheckBox",
  "AXRadioButton", "AXPopUpButton", "AXComboBox", "AXMenuItem", "AXMenuButton", "AXTab",
  "AXSlider", "AXWebArea", "AXHeading", "AXStaticText", "AXImage", "AXCell", "AXRow",
]

/// The picked window's process, AX application, and exactly one matching AX window.
func matchWindow(_ windowId: Int) -> ([String: Any], AXUIElement, AXUIElement) {
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
    // Browsers append their name and profile to the AX title ("Page - Chrome - Profile").
    matches = matches.filter {
      let axTitle = text($0, kAXTitleAttribute) ?? ""
      return axTitle == title || axTitle.hasPrefix(title + " - ")
    }
  }
  guard matches.count == 1, let window = matches.first else {
    fail(
      matches.isEmpty ? "window_not_matched" : "window_ambiguous",
      "The picked window could not be matched to exactly one accessibility window.")
  }
  return (described, app, window)
}

func snapshot(windowId: Int) {
  let (described, _, window) = matchWindow(windowId)
  let target = described["frame"] as! [String: Double]

  var elements: [[String: Any]] = []
  // Breadth-first with a read index (removeFirst is O(n)) and a cap on queued elements.
  var queue: [(AXUIElement, [Int], Int)] = [(window, [], 0)]
  var next = 0
  let maxVisited = maxElements * 10
  while next < queue.count, elements.count < maxElements, next < maxVisited {
    let (element, path, depth) = queue[next]
    next += 1
    let role = text(element, kAXRoleAttribute) ?? ""
    let subrole = text(element, kAXSubroleAttribute)
    let label = text(element, kAXTitleAttribute) ?? text(element, kAXDescriptionAttribute)
      ?? text(element, kAXPlaceholderValueAttribute)
    let value = text(element, kAXValueAttribute)
    let frame = frameOf(element)
    // Pages report scrolled-away content too. Only elements visibly inside the window take one
    // of the limited slots, so a long scrolled page still yields what is on screen.
    if !path.isEmpty, let frame, visibleSize(frame, target) >= minVisible,
      interestingRoles.contains(role) || label != nil
    {
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
      entry["frame"] = frame
      if let url = copy(element, kAXURLAttribute) as? URL { entry["url"] = url.absoluteString }
      elements.append(entry)
    }
    // A subtree whose own frame lies wholly outside the window is skipped. Elements without a
    // frame, or with an empty one, are still walked: they may hold visible children.
    let offscreen = frame.map { $0["width"]! > 0 && $0["height"]! > 0 && visibleSize($0, target) <= 0 } ?? false
    if !offscreen, depth < maxDepth, queue.count < maxVisited,
      let children = copy(element, kAXChildrenAttribute) as? [AXUIElement]
    {
      for (index, child) in children.enumerated().prefix(maxVisited - queue.count) {
        queue.append((child, path + [index], depth + 1))
      }
    }
  }

  var windowOut = described
  windowOut["scale"] = scaleFor(target)
  emit(["window": windowOut, "elements": elements, "truncated": next < queue.count])
}

// MARK: - Acting

/// Browsers whose web content Poko may act in. Everything else is look-only.
let actBrowsers: Set<String> = [
  "com.apple.Safari", "com.google.Chrome", "company.thebrowser.Browser", "org.mozilla.firefox",
  "com.microsoft.edgemac",
]
let riskyExtensions: Set<String> = [
  "app", "command", "sh", "pkg", "dmg", "zip", "exe", "msi", "jar", "tool", "mpkg", "scpt",
  "workflow", "terminal", "py", "rb", "pl", "bat", "iso", "tar", "gz", "tgz", "7z", "rar",
]

func isWeb(_ url: URL?) -> Bool {
  guard let scheme = url?.scheme?.lowercased() else { return false }
  return scheme == "http" || scheme == "https"
}

func sameFrame(_ a: [String: Double], _ b: [String: Double]) -> Bool {
  ["x", "y", "width", "height"].allSatisfy { abs(a[$0]! - b[$0]!) <= 2 }
}

func inside(_ inner: [String: Double], _ outer: [String: Double]) -> Bool {
  inner["x"]! >= outer["x"]! - 1 && inner["y"]! >= outer["y"]! - 1
    && inner["x"]! + inner["width"]! <= outer["x"]! + outer["width"]! + 1
    && inner["y"]! + inner["height"]! <= outer["y"]! + outer["height"]! + 1
}

/// The topmost on-screen window at a point, ignoring Poko's own windows.
func topWindow(at point: CGPoint, ignoring ignoredPid: Int?) -> Int? {
  for info in windowInfos() {
    guard let layer = info[kCGWindowLayer as String] as? Int, layer == 0,
      let pid = info[kCGWindowOwnerPID as String] as? Int32, Int(pid) != ignoredPid,
      let bounds = info[kCGWindowBounds as String] as? [String: Any], let frame = rect(bounds),
      (info[kCGWindowAlpha as String] as? Double ?? 1) > 0
    else { continue }
    let box = CGRect(x: frame["x"]!, y: frame["y"]!, width: frame["width"]!, height: frame["height"]!)
    if box.contains(point) { return info[kCGWindowNumber as String] as? Int }
  }
  return nil
}

func act(windowId: Int) {
  let input = FileHandle.standardInput.readDataToEndOfFile()
  guard let request = (try? JSONSerialization.jsonObject(with: input)) as? [String: Any],
    let kind = request["kind"] as? String, ["check", "press", "type", "reveal"].contains(kind),
    let path = request["path"] as? [Int], !path.isEmpty,
    let role = request["role"] as? String,
    let expectedFrame = request["frame"] as? [String: Double]
  else { fail("bad_request", "The action request is malformed.") }
  let label = request["label"] as? String
  let typed = request["text"] as? String
  let ignoredPid = request["ignorePid"] as? Int
  if kind == "type", typed == nil { fail("bad_request", "Typing needs text.") }

  let (described, app, window) = matchWindow(windowId)
  let windowFrame = described["frame"] as! [String: Double]
  guard let bundle = described["bundleId"] as? String, actBrowsers.contains(bundle) else {
    fail("look_only_app", "Poko only acts inside web pages in supported browsers.")
  }

  // Walk the index path from the window. The path names exactly one element; it must still be
  // the same element (role, label, frame), and a web area with an http(s) page must lie on it.
  var element = window
  var webArea: AXUIElement?
  for index in path {
    guard let children = copy(element, kAXChildrenAttribute) as? [AXUIElement], index < children.count
    else { fail("target_gone", "The element is no longer there.") }
    if text(element, kAXRoleAttribute) == "AXWebArea" { webArea = element }
    element = children[index]
  }
  guard let found = frameOf(element), (text(element, kAXRoleAttribute) ?? "") == role,
    (text(element, kAXTitleAttribute) ?? text(element, kAXDescriptionAttribute)
      ?? text(element, kAXPlaceholderValueAttribute)) == label,
    sameFrame(found, expectedFrame)
  else { fail("target_changed", "The element changed since Poko looked.") }
  guard let webArea, isWeb(copy(webArea, kAXURLAttribute) as? URL),
    let webFrame = frameOf(webArea)
  else { fail("not_web_content", "Poko only acts inside http(s) web pages.") }
  if role == "AXLink" {
    guard let url = copy(element, kAXURLAttribute) as? URL, isWeb(url) else {
      fail("unsafe_link", "This link doesn't go to a web page.")
    }
    if riskyExtensions.contains(url.pathExtension.lowercased()) {
      fail("unsafe_link", "This link may download a program or archive.")
    }
  }

  // Visible and on top: fully inside the window and page, the page's own hit test lands on the
  // target (not a modal or sticky header over it), and no other app's window covers it.
  guard inside(found, windowFrame), inside(found, webFrame) else {
    fail("not_visible", "The element isn't fully on screen.")
  }
  let center = CGPoint(x: found["x"]! + found["width"]! / 2, y: found["y"]! + found["height"]! / 2)
  var hit: AXUIElement?
  guard AXUIElementCopyElementAtPosition(app, Float(center.x), Float(center.y), &hit) == .success,
    var probe = hit
  else { fail("covered", "Something covers the element.") }
  var onTarget = false
  for _ in 0..<64 {
    if CFEqual(probe, element) { onTarget = true; break }
    guard let parent = copy(probe, kAXParentAttribute) else { break }
    probe = parent as! AXUIElement
  }
  guard onTarget else { fail("covered", "Something covers the element.") }
  guard topWindow(at: center, ignoring: ignoredPid) == windowId else {
    fail("covered", "Another window covers the element.")
  }

  if kind == "press" || kind == "check" && request["intent"] as? String == "press" {
    // Chrome's web buttons don't list AXPress, and pressing them reports success while nothing
    // happens. Only an element that says it can be pressed is offered.
    var names: CFArray?
    AXUIElementCopyActionNames(element, &names)
    guard ((names as? [String]) ?? []).contains(kAXPressAction as String) else {
      fail("not_pressable", "This browser doesn't let Poko press this element.")
    }
  }
  if kind == "type" || kind == "check" && request["intent"] as? String == "type" {
    var settable: DarwinBoolean = false
    AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable)
    guard settable.boolValue, text(element, kAXSubroleAttribute) != "AXSecureTextField" else {
      fail("not_typable", "Poko can't type into this field.")
    }
  }
  if kind == "check" {
    emit(["ok": true, "frame": found])
    return
  }

  let result: AXError
  switch kind {
  case "press": result = AXUIElementPerformAction(element, kAXPressAction as CFString)
  case "reveal": result = AXUIElementPerformAction(element, "AXScrollToVisible" as CFString)
  default:
    // Safari ignores a new value unless the field has focus inside the page first.
    AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue)
    usleep(100_000)
    result = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, typed! as CFString)
  }
  guard result == .success else { fail("action_failed", "The app didn't accept the action.") }
  var out: [String: Any] = ["ok": true]
  // Read the value back so a field that didn't take the text is reported, not assumed.
  if kind == "type" {
    // Pages update the field asynchronously; give it a moment before reading back.
    var matches = false
    for _ in 0..<10 {
      if (copy(element, kAXValueAttribute) as? String) == typed { matches = true; break }
      usleep(50_000)
    }
    out["valueMatches"] = matches
  }
  emit(out)
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
case "act":
  guard args.count > 2, let id = Int(args[2]) else { fail("usage", "act <windowId>") }
  guard AXIsProcessTrusted() else { fail("no_accessibility", "Accessibility permission is missing.") }
  act(windowId: id)
default:
  fail("usage", "poko-ax permissions | windows | snapshot <windowId> | act <windowId>")
}

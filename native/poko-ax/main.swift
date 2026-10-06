// poko-ax: Poko's macOS window and accessibility helper (Phase 06).
//
//   poko-ax permissions          -> {"accessibility": Bool, "screen": Bool}
//   poko-ax windows              -> {"windows": [{id, pid, owner, bundleId, title, frame}]}
//   poko-ax snapshot <windowId>  -> {"window": {...}, "elements": [...]} or {"error": ...}
//   poko-ax raise <windowId>     -> brings the window to the front
//   poko-ax selection            -> {"text": String?}: the text selected in the focused field of
//                                   the app in front (never Poko's own, never a password field)
//   poko-ax dictate <pid>        -> presses Start Dictation in Poko's own Edit menu (pid must be
//                                   the helper's parent, so it never touches another app)
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

/// Whether the app's own hit test at `point` lands on `element` or one of its descendants.
func hits(_ app: AXUIElement, _ element: AXUIElement, at point: CGPoint) -> Bool {
  var hit: AXUIElement?
  guard AXUIElementCopyElementAtPosition(app, Float(point.x), Float(point.y), &hit) == .success,
    var probe = hit
  else { return false }
  for _ in 0..<64 {
    if CFEqual(probe, element) { return true }
    guard let parent = copy(probe, kAXParentAttribute) else { return false }
    probe = parent as! AXUIElement
  }
  return false
}

/// Points inside `frame` where the page's hit test lands on the target, best first.
func targetPoints(_ app: AXUIElement, _ element: AXUIElement, _ frame: [String: Double]) -> [CGPoint] {
  let point = { (f: [String: Double]) in
    CGPoint(x: f["x"]! + f["width"]! / 2, y: f["y"]! + f["height"]! / 2)
  }
  var candidates = [point(frame)]
  for child in (copy(element, kAXChildrenAttribute) as? [AXUIElement] ?? []).prefix(8) {
    if let childFrame = frameOf(child), childFrame["width"]! >= 4, childFrame["height"]! >= 4,
      inside(childFrame, frame)
    {
      candidates.append(point(childFrame))
    }
  }
  for row in [0.25, 0.5, 0.75] {
    for column in [0.2, 0.4, 0.6, 0.8] {
      candidates.append(
        CGPoint(
          x: frame["x"]! + frame["width"]! * column, y: frame["y"]! + frame["height"]! * row))
    }
  }
  return candidates.filter { hits(app, element, at: $0) }
}

let innerControls: Set<String> = [
  "AXButton", "AXCheckBox", "AXRadioButton", "AXPopUpButton", "AXMenuButton", "AXTextField",
  "AXTextArea", "AXSearchField", "AXComboBox", "AXSlider", "AXMenuItem", "AXTab", "AXSwitch",
]

func linkIsSafe(_ link: AXUIElement) -> Bool {
  guard let url = copy(link, kAXURLAttribute) as? URL, isWeb(url) else { return false }
  return !riskyExtensions.contains(url.pathExtension.lowercased())
}

/// Where a real click at `point` would land. It must be the target or something inside it,
/// and nothing between (a control of its own, or a link that isn't a safe web page) may take
/// the click instead. Returns an error code, or nil when the click lands safely.
func clickRefusal(_ app: AXUIElement, _ element: AXUIElement, at point: CGPoint) -> String? {
  var hit: AXUIElement?
  guard AXUIElementCopyElementAtPosition(app, Float(point.x), Float(point.y), &hit) == .success,
    var probe = hit
  else { return "covered" }
  for _ in 0..<64 {
    if CFEqual(probe, element) { return nil }
    let role = text(probe, kAXRoleAttribute) ?? ""
    if role == "AXLink", !linkIsSafe(probe) { return "unsafe_link" }
    if innerControls.contains(role) { return "inner_control" }
    guard let parent = copy(probe, kAXParentAttribute) else { return "covered" }
    probe = parent as! AXUIElement
  }
  return "covered"
}

let refusalMessages = [
  "covered": "Something covers the element.",
  "unsafe_link": "The click would follow a link that isn't a safe web page.",
  "inner_control": "Another control sits where Poko would click.",
]

/// One left click at `point`, only after the window is in front and the point still lands on
/// the element with no window (Poko's included) above it. The point is checked again after
/// the pointer moves there, since pages show controls on hover. The cursor goes back where it
/// was, and Poko comes back to the front, also when the click is refused.
func mouseClick(
  at point: CGPoint, app: AXUIElement, window: AXUIElement, element: AXUIElement, pid: Int32,
  windowId: Int, returnTo pokoPid: Int?
) {
  let original = CGEvent(source: nil)?.location ?? point
  let source = CGEventSource(stateID: .hidSystemState)
  func post(_ type: CGEventType, _ at: CGPoint) {
    CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: at, mouseButton: .left)?
      .post(tap: .cghidEventTap)
  }
  func finish() {
    if let pokoPid { NSRunningApplication(processIdentifier: Int32(pokoPid))?.activate() }
  }
  func check() {
    if topWindow(at: point, ignoring: nil) != windowId {
      finish()
      fail("covered", "Another window covers the element.")
    }
    if let code = clickRefusal(app, element, at: point) {
      post(.mouseMoved, original)
      finish()
      fail(code, refusalMessages[code] ?? code)
    }
  }

  NSRunningApplication(processIdentifier: pid)?.activate()
  AXUIElementPerformAction(window, kAXRaiseAction as CFString)
  usleep(300_000)
  check()
  post(.mouseMoved, point)
  usleep(250_000)
  check()
  post(.leftMouseDown, point)
  usleep(40_000)
  post(.leftMouseUp, point)
  usleep(40_000)
  post(.mouseMoved, original)
  finish()
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
  var links: [AXUIElement] = []
  for index in path {
    guard let children = copy(element, kAXChildrenAttribute) as? [AXUIElement], index < children.count
    else { fail("target_gone", "The element is no longer there.") }
    let ancestorRole = text(element, kAXRoleAttribute)
    if ancestorRole == "AXWebArea" { webArea = element; links = [] }
    if ancestorRole == "AXLink", webArea != nil { links.append(element) }
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
  // Pressing text or an image inside a link follows that link, so every link on the way to the
  // target is checked, not only a target that is itself a link.
  if role == "AXLink" { links.append(element) }
  for link in links {
    guard let url = copy(link, kAXURLAttribute) as? URL, isWeb(url) else {
      fail("unsafe_link", "This link doesn't go to a web page.")
    }
    if riskyExtensions.contains(url.pathExtension.lowercased()) {
      fail("unsafe_link", "This link may download a program or archive.")
    }
  }

  // Scrolling an element into view is harmless and is how a partly hidden element becomes
  // visible, so `reveal` skips the visibility tests below; press and type need them.
  if kind == "reveal" || kind == "check" && request["intent"] as? String == "reveal" {
    if kind == "check" {
      emit(["ok": true, "frame": found])
      return
    }
    guard AXUIElementPerformAction(element, "AXScrollToVisible" as CFString) == .success else {
      fail("action_failed", "The app didn't accept the action.")
    }
    emit(["ok": true])
    return
  }

  // Visible and on top: fully inside the window and page, the page's own hit test lands on the
  // target (not a modal or sticky header over it), and no other app's window covers it.
  guard inside(found, windowFrame), inside(found, webFrame) else {
    fail("not_visible", "The element isn't fully on screen.")
  }
  // A multi-line link's box can be empty in the middle, so the point is the first of: the
  // center, the centers of its children, then a spread of points that lands on the target.
  // Presses are real mouse clicks (AXPress succeeds on Google's suggestions and Gmail rows
  // without acting), so for a press the point must also be one where nothing inside the target
  // (a star, a checkbox, an unsafe link) would take the click.
  let pressing = kind == "press" || kind == "check" && request["intent"] as? String == "press"
  let points = targetPoints(app, element, found)
  guard let first = points.first else { fail("covered", "Something covers the element.") }
  var center = first
  if pressing {
    guard let safe = points.first(where: { clickRefusal(app, element, at: $0) == nil }) else {
      let code = clickRefusal(app, element, at: first) ?? "covered"
      fail(code, refusalMessages[code] ?? code)
    }
    center = safe
  }
  guard topWindow(at: center, ignoring: ignoredPid) == windowId else {
    fail("covered", "Another window covers the element.")
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
  case "press":
    let pid = Int32(described["pid"] as! Int)
    mouseClick(
      at: center, app: app, window: window, element: element, pid: pid, windowId: windowId,
      returnTo: ignoredPid)
    result = .success
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

/**
 * The text selected in the focused field of the app in front: never Poko's own (the helper's
 * parent) or a password field. Chromium and Electron apps build their accessibility tree only
 * once asked to; if this read had to turn that on, it is turned back off before returning.
 */
func selectedText() -> String? {
  guard AXIsProcessTrusted(), let front = NSWorkspace.shared.frontmostApplication,
    front.processIdentifier != getppid()
  else { return nil }
  let app = AXUIElementCreateApplication(front.processIdentifier)
  // A hung app must not hold the panel's opening.
  AXUIElementSetMessagingTimeout(app, 0.5)
  let manualKey = "AXManualAccessibility" as CFString
  var focused: AnyObject?
  AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute as CFString, &focused)
  var manual: AnyObject?
  AXUIElementCopyAttributeValue(app, manualKey, &manual)
  let turnedOn = focused == nil && (manual as? Bool) != true
  if turnedOn {
    AXUIElementSetAttributeValue(app, manualKey, kCFBooleanTrue)
    // The tree takes a moment to build; wait up to about a second for the focused field.
    for _ in 0..<10 where focused == nil {
      usleep(100_000)
      AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute as CFString, &focused)
    }
  }
  defer {
    if turnedOn { AXUIElementSetAttributeValue(app, manualKey, kCFBooleanFalse) }
  }
  guard let field = focused, CFGetTypeID(field) == AXUIElementGetTypeID() else { return nil }
  let element = field as! AXUIElement
  var owner: pid_t = 0
  AXUIElementGetPid(element, &owner)
  var role: AnyObject?
  AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &role)
  var subrole: AnyObject?
  AXUIElementCopyAttributeValue(element, kAXSubroleAttribute as CFString, &subrole)
  let secure =
    (role as? String) == "AXSecureTextField" || (subrole as? String) == "AXSecureTextField"
  guard owner != getppid(), !secure else { return nil }
  var selected: AnyObject?
  AXUIElementCopyAttributeValue(element, kAXSelectedTextAttribute as CFString, &selected)
  guard let text = selected as? String,
    !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  else { return nil }
  return String(text.prefix(20_000))
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
case "raise":
  // Brings the picked window in front so nothing covers what Poko is about to look at.
  guard args.count > 2, let id = Int(args[2]) else { fail("usage", "raise <windowId>") }
  guard AXIsProcessTrusted() else { fail("no_accessibility", "Accessibility permission is missing.") }
  let (described, _, window) = matchWindow(id)
  NSRunningApplication(processIdentifier: Int32(described["pid"] as! Int))?.activate()
  AXUIElementPerformAction(window, kAXRaiseAction as CFString)
  usleep(300_000)
  emit(["ok": true])
case "selection":
  // Read when the quick panel opens, before it takes focus. Nothing when Accessibility is off.
  emit(["text": selectedText().map { $0 as Any } ?? NSNull()])
case "dictate":
  // AppKit adds Start Dictation to the Edit menu; pressing it starts Dictation in the focused
  // field. Only Poko's own process (the helper's parent) is accepted.
  guard args.count > 2, let pid = Int32(args[2]) else { fail("usage", "dictate <pid>") }
  guard pid == getppid() else { fail("not_parent", "Only Poko's own menu can be pressed.") }
  guard AXIsProcessTrusted() else { fail("no_accessibility", "Accessibility permission is missing.") }
  let poko = AXUIElementCreateApplication(pid)
  func children(_ element: AXUIElement) -> [AXUIElement] {
    var value: AnyObject?
    AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &value)
    return value as? [AXUIElement] ?? []
  }
  var menuBar: AnyObject?
  AXUIElementCopyAttributeValue(poko, kAXMenuBarAttribute as CFString, &menuBar)
  guard let bar = menuBar else { fail("not_found", "Poko has no menu bar.") }
  for top in children(bar as! AXUIElement) {
    for menu in children(top) {
      for item in children(menu) {
        var identifier: AnyObject?
        AXUIElementCopyAttributeValue(item, "AXIdentifier" as CFString, &identifier)
        if identifier as? String == "startDictation:" {
          let result = AXUIElementPerformAction(item, kAXPressAction as CFString)
          if result == .success { emit(["ok": true]) } else { fail("press_failed", "\(result.rawValue)") }
          exit(0)
        }
      }
    }
  }
  fail("not_found", "Start Dictation is not in the Edit menu.")
case "task-processes":
  // Processes left behind by one Poko command task, identified by their sandbox profile.
  guard args.count > 3, args[2].hasPrefix("/"), args[3].hasPrefix("/") else {
    fail("usage", "task-processes <tempDir> <workspace>")
  }
  var found = [pid_t](repeating: 0, count: 4096)
  let count = Int(poko_task_processes(args[2], args[3], &found, Int32(found.count)))
  emit(["pids": found.prefix(count).map { Int($0) }])
case "act":
  guard args.count > 2, let id = Int(args[2]) else { fail("usage", "act <windowId>") }
  guard AXIsProcessTrusted() else { fail("no_accessibility", "Accessibility permission is missing.") }
  act(windowId: id)
default:
  fail("usage", "poko-ax permissions | windows | snapshot <windowId> | act <windowId> | task-processes <tempDir> <workspace>")
}

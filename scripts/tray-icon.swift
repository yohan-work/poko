// Draws Poko's menu bar template image (black on transparent; macOS tints it for light and
// dark menu bars) from the app icon's shapes. Run: swift scripts/tray-icon.swift resources/tray
import AppKit

let output = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "resources/tray"

func draw(size: Int, to path: String) {
  let scale = CGFloat(size) / 18
  let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8,
    samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
    bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  let context = NSGraphicsContext.current!.cgContext
  // Design space: 18 x 18 points, origin top-left.
  context.translateBy(x: 0, y: CGFloat(size))
  context.scaleBy(x: scale, y: -scale)
  context.setFillColor(NSColor.black.cgColor)

  // The speech-bubble body and its tail, filled separately so their overlap stays solid.
  context.fillEllipse(in: CGRect(x: 2.2, y: 4.2, width: 13.0, height: 11.4))
  let tail = CGMutablePath()
  tail.move(to: CGPoint(x: 5.4, y: 11.2))
  tail.addLine(to: CGPoint(x: 2.6, y: 16.6))
  tail.addLine(to: CGPoint(x: 8.8, y: 13.6))
  tail.closeSubpath()
  // Eyes are cut out, so the template keeps Poko's face.
  let eyes = CGMutablePath()
  eyes.addRoundedRect(in: CGRect(x: 6.5, y: 7.6, width: 1.6, height: 3.2), cornerWidth: 0.8, cornerHeight: 0.8)
  eyes.addRoundedRect(in: CGRect(x: 9.7, y: 7.6, width: 1.6, height: 3.2), cornerWidth: 0.8, cornerHeight: 0.8)
  context.addPath(tail)
  context.fillPath()
  context.setBlendMode(.clear)
  context.addPath(eyes)
  context.fillPath()
  context.setBlendMode(.normal)
  // The companion dot.
  context.fillEllipse(in: CGRect(x: 13.4, y: 1.4, width: 3.2, height: 3.2))

  NSGraphicsContext.restoreGraphicsState()
  let data = rep.representation(using: .png, properties: [:])!
  try! data.write(to: URL(fileURLWithPath: path))
}

draw(size: 18, to: "\(output)/trayTemplate.png")
draw(size: 36, to: "\(output)/trayTemplate@2x.png")
print("wrote \(output)/trayTemplate.png and @2x")

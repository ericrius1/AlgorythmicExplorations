import AppKit
import SwiftUI
import MetalKit

final class BonfireView: MTKView {
  weak var renderer: Renderer?
  var settings: Settings!
  weak var settingsHost: NSView?

  override var acceptsFirstResponder: Bool { true }

  override func updateTrackingAreas() {
    trackingAreas.forEach(removeTrackingArea)
    addTrackingArea(NSTrackingArea(
      rect: bounds,
      options: [.mouseMoved, .mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect],
      owner: self))
    super.updateTrackingAreas()
  }

  private func worldPoint(_ e: NSEvent) -> SIMD2<Float> {
    let p = convert(e.locationInWindow, from: nil)
    let cx = Float(p.x / max(bounds.width, 1)) * 2 - 1
    let cy = Float(p.y / max(bounds.height, 1)) * 2 - 1 // view y is already up
    return renderer?.clipToWorld(SIMD2(cx, cy)) ?? .zero
  }

  override func mouseMoved(with e: NSEvent) { renderer?.pointerMoved(worldPoint(e)) }
  override func mouseDragged(with e: NSEvent) { renderer?.pointerMoved(worldPoint(e)) }
  override func mouseExited(with e: NSEvent) { renderer?.pointerLeft() }
  override func mouseDown(with e: NSEvent) { renderer?.setEmit(worldPoint(e), on: true) }
  override func mouseUp(with e: NSEvent) { renderer?.setEmit(.zero, on: false) }

  override func keyDown(with e: NSEvent) {
    switch e.keyCode {
    case 48: settingsHost?.isHidden.toggle()       // tab
    case 49: settings.paused.toggle()              // space
    case 3: window?.toggleFullScreen(nil)          // f
    default: super.keyDown(with: e)
    }
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
  var window: NSWindow!
  var renderer: Renderer!
  let settings = Settings()

  func applicationDidFinishLaunching(_ note: Notification) {
    let rect = NSRect(x: 0, y: 0, width: 1440, height: 900)
    window = NSWindow(
      contentRect: rect,
      styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
      backing: .buffered, defer: false)
    window.title = "Bonfire"
    window.center()
    window.collectionBehavior.insert(.fullScreenPrimary)
    window.titlebarAppearsTransparent = true

    guard let device = MTLCreateSystemDefaultDevice() else {
      fatalError("No Metal device available")
    }
    let view = BonfireView(frame: rect, device: device)
    view.settings = settings
    do {
      renderer = try Renderer(view: view, settings: settings)
    } catch {
      fatalError("Renderer init failed: \(error)")
    }
    view.renderer = renderer
    view.delegate = renderer
    window.contentView = view

    let host = NSHostingView(rootView: SettingsView(settings: settings))
    host.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(host)
    NSLayoutConstraint.activate([
      host.topAnchor.constraint(equalTo: view.topAnchor, constant: 18),
      host.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -18),
    ])
    view.settingsHost = host

    window.makeKeyAndOrderFront(nil)
    window.makeFirstResponder(view)
    NSApp.activate(ignoringOtherApps: true)

    if ProcessInfo.processInfo.environment["BONFIRE_SNAPSHOT"] != nil {
      // headless-ish verification: stay windowed, defeat App Nap so the
      // draw loop runs even when launched from a background terminal
      activity = ProcessInfo.processInfo.beginActivity(
        options: [.userInitiated, .idleDisplaySleepDisabled, .latencyCritical],
        reason: "snapshot")
    } else {
      // straight into fullscreen — that's the brief
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [self] in
        window.toggleFullScreen(nil)
      }
    }
  }

  private var activity: NSObjectProtocol?

  func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)

// minimal menu so Cmd+Q works
let mainMenu = NSMenu()
let appItem = NSMenuItem()
mainMenu.addItem(appItem)
let appMenu = NSMenu()
appMenu.addItem(NSMenuItem(title: "Quit Bonfire", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
appItem.submenu = appMenu
app.mainMenu = mainMenu

app.run()

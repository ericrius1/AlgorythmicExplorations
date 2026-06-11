import Foundation
import Combine

// All tweakables. Renderer reads these every frame (plain Double reads are
// tear-free enough for visuals); only `fps` flows the other way, on main.
final class Settings: ObservableObject {
  static let maxEmbers = 65_536

  @Published var emberCount: Double = 2_500
  @Published var wind: Double = 0.25
  @Published var bounce: Double = 0.7
  @Published var timeOfDay: Double = 0.03   // 0 night … 1 day
  @Published var fireScale: Double = 1.25
  @Published var glow: Double = 1.0
  @Published var emberSize: Double = 0.012

  @Published var exposure: Double = 1.5
  @Published var bloom: Double = 0.35
  @Published var smoke: Double = 0.4
  @Published var nightAir: Double = 0.6     // distance falloff of GI wash at night
  @Published var shimmer: Double = 0.5
  @Published var grain: Double = 0.05
  @Published var vignette: Double = 0.25
  @Published var hdr = true                 // EDR output (XDR displays)

  @Published var renderScale: Double = 0.5  // GI resolution vs drawable
  @Published var raySteps: Double = 40

  @Published var debugMode = 0              // 0 final · 1 scene · 2 occupancy · 3 distance · 4 light only
  @Published var paused = false
  @Published var fps: Double = 0

  init() {
    // env overrides, for headless snapshot debugging
    let env = ProcessInfo.processInfo.environment
    if let v = env["BONFIRE_DEBUG"], let d = Int(v) { debugMode = d }
    if let v = env["BONFIRE_TOD"], let d = Double(v) { timeOfDay = d }
    if let v = env["BONFIRE_SMOKE"], let d = Double(v) { smoke = d }
    if let v = env["BONFIRE_BLOOM"], let d = Double(v) { bloom = d }
    if let v = env["BONFIRE_EMBERS"], let d = Double(v) { emberCount = d }
    if let v = env["BONFIRE_GLOW"], let d = Double(v) { glow = d }
    if let v = env["BONFIRE_NIGHTAIR"], let d = Double(v) { nightAir = d }
  }
}

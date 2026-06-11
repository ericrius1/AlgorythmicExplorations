import SwiftUI

private let debugNames = ["final", "scene", "occupancy", "distance", "light only"]

struct SettingsView: View {
  @ObservedObject var settings: Settings

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text("Bonfire").font(.headline)
        Spacer()
        Text(String(format: "%.0f fps", settings.fps))
          .font(.caption.monospacedDigit())
          .foregroundStyle(.secondary)
      }

      Group {
        logRow("embers", $settings.emberCount, 200...Double(Settings.maxEmbers)) { "\(Int($0))" }
        row("wind", $settings.wind, 0...1.5)
        row("bounce", $settings.bounce, 0...2)
        row("time of day", $settings.timeOfDay, 0...1) { dayName($0) }
        row("fire size", $settings.fireScale, 0.4...2.2)
        row("glow", $settings.glow, 0.3...2.5)
        row("ember size", $settings.emberSize, 0.005...0.03)
      }

      Divider()

      Group {
        row("exposure", $settings.exposure, 0.5...3)
        row("bloom", $settings.bloom, 0...1)
        row("smoke", $settings.smoke, 0...1)
        row("night air", $settings.nightAir, 0...1.5)
        row("heat shimmer", $settings.shimmer, 0...1)
        row("grain", $settings.grain, 0...0.2)
        row("vignette", $settings.vignette, 0...0.6)
        Toggle("HDR (EDR output)", isOn: $settings.hdr)
          .toggleStyle(.switch)
          .controlSize(.mini)
          .font(.caption)
      }

      Divider()

      Group {
        row("render scale", $settings.renderScale, 0.25...1)
        row("ray steps", $settings.raySteps, 16...96) { "\(Int($0))" }
        Picker("view", selection: $settings.debugMode) {
          ForEach(0..<debugNames.count, id: \.self) { Text(debugNames[$0]).tag($0) }
        }
        .pickerStyle(.menu)
        .controlSize(.small)
        .font(.caption)
      }

      Text("tab — hide panel · space — pause · f — fullscreen\ndrag stirs the wind · hold click to shed embers")
        .font(.caption2)
        .foregroundStyle(.secondary)
        .padding(.top, 2)
    }
    .padding(14)
    .frame(width: 300)
    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14))
  }

  private func dayName(_ v: Double) -> String {
    v < 0.25 ? "night" : v < 0.45 ? "late dusk" : v < 0.62 ? "dusk" : v < 0.85 ? "morning" : "day"
  }

  private func row(_ label: String, _ value: Binding<Double>, _ range: ClosedRange<Double>,
                   fmt: @escaping (Double) -> String = { String(format: "%.2f", $0) }) -> some View {
    VStack(alignment: .leading, spacing: 1) {
      HStack {
        Text(label).font(.caption)
        Spacer()
        Text(fmt(value.wrappedValue)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
      }
      Slider(value: value, in: range).controlSize(.mini)
    }
  }

  private func logRow(_ label: String, _ value: Binding<Double>, _ range: ClosedRange<Double>,
                      fmt: @escaping (Double) -> String) -> some View {
    let lo = log(range.lowerBound)
    let hi = log(range.upperBound)
    let mapped = Binding<Double>(
      get: { (log(max(value.wrappedValue, range.lowerBound)) - lo) / (hi - lo) },
      set: { value.wrappedValue = (exp(lo + $0 * (hi - lo))).rounded() })
    return VStack(alignment: .leading, spacing: 1) {
      HStack {
        Text(label).font(.caption)
        Spacer()
        Text(fmt(value.wrappedValue)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
      }
      Slider(value: mapped, in: 0...1).controlSize(.mini)
    }
  }
}

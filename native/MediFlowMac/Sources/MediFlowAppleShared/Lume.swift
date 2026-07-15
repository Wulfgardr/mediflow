// @Codex
// LumeKit: opaque clinical surfaces and platform-native transient chrome for
// the universal Apple app.
import Foundation
import SwiftUI

public enum LumeTone: CaseIterable, Hashable, Sendable {
    case neutral
    case info
    case positive
    case attention
    case critical
}

public enum LumeZone: CaseIterable, Equatable {
    case canvas
    case field
    case focal
    case chrome
}

public struct LumeRegisterPalette: Equatable, Sendable {
    public let canvasHex: String
    public let fieldHex: String
    public let focalHex: String
    public let chromeHex: String
    public let inkPrimaryHex: String
    public let inkMutedHex: String
    public let mineraleHex: String

    public var canvas: Color { Color(lumeHex: canvasHex) }
    public var field: Color { Color(lumeHex: fieldHex) }
    public var focal: Color { Color(lumeHex: focalHex) }
    public var chrome: Color { Color(lumeHex: chromeHex) }
    public var inkPrimary: Color { Color(lumeHex: inkPrimaryHex) }
    public var inkMuted: Color { Color(lumeHex: inkMutedHex) }
    public var minerale: Color { Color(lumeHex: mineraleHex) }

    public func surface(for zone: LumeZone) -> Color {
        switch zone {
        case .canvas: canvas
        case .field: field
        case .focal: focal
        case .chrome: chrome
        }
    }
}

public enum LumePalette {
    public static let giorno = LumeRegisterPalette(
        canvasHex: "#eef0f2",
        fieldHex: "#f5f5f4",
        focalHex: "#fbfaf7",
        chromeHex: "#e6e8eb",
        inkPrimaryHex: "#1a1c1e",
        inkMutedHex: "#5c6772",
        mineraleHex: "#33506b"
    )

    public static let grafite = LumeRegisterPalette(
        canvasHex: "#121417",
        fieldHex: "#191c21",
        focalHex: "#22252b",
        chromeHex: "#0e1013",
        inkPrimaryHex: "#e9ecef",
        inkMutedHex: "#8f9aa6",
        mineraleHex: "#8fb0cc"
    )

    public static let guardia = LumeRegisterPalette(
        canvasHex: "#0c0e12",
        fieldHex: "#14171d",
        focalHex: "#1a1e26",
        chromeHex: "#090b0e",
        inkPrimaryHex: "#e3e8ee",
        inkMutedHex: "#8792a3",
        mineraleHex: "#7fa0bc"
    )

    public static let warningHex = "#9a6a2f"
    public static let criticalHex = "#a33a2f"
    public static let successHex = "#4b6354"
    public static let plumHex = "#555161"

    public static var warning: Color { Color(lumeHex: warningHex) }
    public static var critical: Color { Color(lumeHex: criticalHex) }
    public static var success: Color { Color(lumeHex: successHex) }
    public static var plum: Color { Color(lumeHex: plumHex) }

    /// Resolves a clinical tone to its canonical DTCG value. Neutral and
    /// informational tones follow the active register; clinical signals stay
    /// register-independent. Plum remains outside this mapping until a
    /// structured state explicitly adopts it.
    public static func hex(for tone: LumeTone, using palette: LumeRegisterPalette) -> String {
        switch tone {
        case .neutral: return palette.inkMutedHex
        case .info: return palette.mineraleHex
        case .positive: return successHex
        case .attention: return warningHex
        case .critical: return criticalHex
        }
    }

    /// The exact sRGB value rendered by `tint(for:using:)`; internal so tests
    /// can fail closed on the derived signal, not only on its DTCG seed.
    static func resolvedHex(for tone: LumeTone, using palette: LumeRegisterPalette) -> String {
        let seed = hex(for: tone, using: palette)
        switch tone {
        case .neutral, .info:
            return seed
        case .positive, .attention, .critical:
            return mix(seed, with: palette.inkPrimaryHex, seedWeight: 0.6)
        }
    }

    public static func tint(for tone: LumeTone, using palette: LumeRegisterPalette) -> Color {
        Color(lumeHex: resolvedHex(for: tone, using: palette))
    }

    /// Mirrors the web status derivation: preserve the canonical signal seed,
    /// then mix it with register ink so status text remains readable at night.
    private static func mix(_ seed: String, with ink: String, seedWeight: Double) -> String {
        guard
            let seedRGB = UInt64(seed.dropFirst(), radix: 16),
            let inkRGB = UInt64(ink.dropFirst(), radix: 16)
        else { preconditionFailure("Invalid Lume signal or ink hex") }
        let inkWeight = 1 - seedWeight
        let channel: (Int) -> Int = { shift in
            let seedByte = Double((seedRGB >> shift) & 0xff)
            let inkByte = Double((inkRGB >> shift) & 0xff)
            let weightedValue = seedByte * seedWeight + inkByte * inkWeight
            return Int(weightedValue.rounded())
        }
        return String(format: "#%02x%02x%02x", channel(16), channel(8), channel(0))
    }

    public static func palette(for colorScheme: ColorScheme, isGuardia: Bool) -> LumeRegisterPalette {
        if colorScheme == .dark, isGuardia {
            return guardia
        }
        return colorScheme == .dark ? grafite : giorno
    }

    /// Code-first mirror used by the fail-closed JSON parity test.
    public static let tokenHexValues: [String: String] = [
        "register.giorno.surface.canvas": giorno.canvasHex,
        "register.giorno.surface.field": giorno.fieldHex,
        "register.giorno.surface.focal": giorno.focalHex,
        "register.giorno.surface.chrome": giorno.chromeHex,
        "register.giorno.ink.primary": giorno.inkPrimaryHex,
        "register.giorno.ink.muted": giorno.inkMutedHex,
        "register.giorno.accent.minerale": giorno.mineraleHex,
        "register.grafite.surface.canvas": grafite.canvasHex,
        "register.grafite.surface.field": grafite.fieldHex,
        "register.grafite.surface.focal": grafite.focalHex,
        "register.grafite.surface.chrome": grafite.chromeHex,
        "register.grafite.ink.primary": grafite.inkPrimaryHex,
        "register.grafite.ink.muted": grafite.inkMutedHex,
        "register.grafite.accent.minerale": grafite.mineraleHex,
        "register.guardia.surface.canvas": guardia.canvasHex,
        "register.guardia.surface.field": guardia.fieldHex,
        "register.guardia.surface.focal": guardia.focalHex,
        "register.guardia.surface.chrome": guardia.chromeHex,
        "register.guardia.ink.primary": guardia.inkPrimaryHex,
        "register.guardia.ink.muted": guardia.inkMutedHex,
        "register.guardia.accent.minerale": guardia.mineraleHex,
        "signal.warning": warningHex,
        "signal.critical": criticalHex,
        "signal.success": successHex,
        "signal.plum": plumHex
    ]
}

private extension Color {
    init(lumeHex: String) {
        let value = lumeHex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard value.count == 6, let rgb = UInt64(value, radix: 16) else {
            preconditionFailure("Invalid Lume hex color: \(lumeHex)")
        }
        self.init(
            .sRGB,
            red: Double((rgb >> 16) & 0xff) / 255,
            green: Double((rgb >> 8) & 0xff) / 255,
            blue: Double(rgb & 0xff) / 255,
            opacity: 1
        )
    }
}

private struct LumeGuardiaKey: EnvironmentKey {
    static let defaultValue = false
}

public extension EnvironmentValues {
    /// Contextual night refinement. This is not a user-selectable appearance.
    var lumeGuardia: Bool {
        get { self[LumeGuardiaKey.self] }
        set { self[LumeGuardiaKey.self] = newValue }
    }
}

public extension View {
    /// Activates the contextual guardia register inside a dark hierarchy.
    func lumeGuardia(_ isEnabled: Bool = true) -> some View {
        environment(\.lumeGuardia, isEnabled)
    }
}

public struct LumeSurface: ViewModifier {
    public let zone: LumeZone
    public let cornerRadius: CGFloat

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.lumeGuardia) private var isGuardia
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    @Environment(\.appleReduceMotionOverride) private var reduceMotionOverride

    public init(zone: LumeZone, cornerRadius: CGFloat = 14) {
        self.zone = zone
        self.cornerRadius = cornerRadius
    }

    public func body(content: Content) -> some View {
        let palette = LumePalette.palette(for: colorScheme, isGuardia: isGuardia)
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        let reduceMotion = AppleAppearanceStore.shouldReduceMotion(
            systemReduceMotion: systemReduceMotion,
            override: reduceMotionOverride
        )

        content
            .background {
                ZStack {
                    shape.fill(palette.surface(for: zone))
                    shape
                        .fill(palette.focal)
                        .shadow(color: .black.opacity(0.12), radius: 4, y: 2)
                        .opacity(zone == .focal ? 1 : 0)
                }
            }
            .animation(reduceMotion ? nil : .easeOut(duration: 0.18), value: zone)
    }
}

private struct LumeCardStyleModifier: ViewModifier {
    let zone: LumeZone
    let cornerRadius: CGFloat

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.lumeGuardia) private var isGuardia

    func body(content: Content) -> some View {
        let palette = LumePalette.palette(for: colorScheme, isGuardia: isGuardia)
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)

        content
            .padding(16)
            .modifier(LumeSurface(zone: zone, cornerRadius: cornerRadius))
            .overlay(shape.stroke(palette.inkMuted.opacity(0.28), lineWidth: 0.5))
    }
}

public struct LumeCard<Content: View>: View {
    private let zone: LumeZone
    private let cornerRadius: CGFloat
    private let content: Content

    public init(
        zone: LumeZone = .field,
        cornerRadius: CGFloat = 14,
        @ViewBuilder content: () -> Content
    ) {
        self.zone = zone
        self.cornerRadius = cornerRadius
        self.content = content()
    }

    public var body: some View {
        content.modifier(LumeCardStyleModifier(zone: zone, cornerRadius: cornerRadius))
    }
}

public extension View {
    func lumeSurface(zone: LumeZone, cornerRadius: CGFloat = 14) -> some View {
        modifier(LumeSurface(zone: zone, cornerRadius: cornerRadius))
    }

    /// Compatibility surface for existing clinical cards. It is Lume field.
    func clinicalCardStyle(cornerRadius: CGFloat = 14) -> some View {
        modifier(LumeCardStyleModifier(zone: .field, cornerRadius: cornerRadius))
    }

    /// SF Mono semantics for doses, values, codes, dates, times and identifiers.
    func registro() -> some View {
        monospaced().monospacedDigit()
    }
}

public struct LumeFiloContinuity {
    public let id: AnyHashable
    public let namespace: Namespace.ID
    public let isSource: Bool

    /// Use only for the connector that continues from Quadro to Scheda.
    public init<ID: Hashable>(id: ID, namespace: Namespace.ID, isSource: Bool = true) {
        self.id = AnyHashable(id)
        self.namespace = namespace
        self.isSource = isSource
    }
}

public enum LumeFiloTone {
    case minerale
    case inkMuted
}

private struct FiloPath: Shape {
    let axis: Axis

    func path(in rect: CGRect) -> Path {
        var path = Path()
        switch axis {
        case .horizontal:
            path.move(to: CGPoint(x: rect.minX, y: rect.midY))
            path.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        case .vertical:
            path.move(to: CGPoint(x: rect.midX, y: rect.minY))
            path.addLine(to: CGPoint(x: rect.midX, y: rect.maxY))
        }
        return path
    }
}

public struct Filo: View {
    private let axis: Axis
    private let isConnected: Bool
    private let tone: LumeFiloTone
    private let lineWidth: CGFloat
    private let quadroSchedaContinuity: LumeFiloContinuity?

    @State private var drawProgress: CGFloat = 0
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.lumeGuardia) private var isGuardia
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    @Environment(\.appleReduceMotionOverride) private var reduceMotionOverride

    public init(
        axis: Axis = .vertical,
        isConnected: Bool = true,
        tone: LumeFiloTone = .minerale,
        lineWidth: CGFloat = 1.5,
        quadroSchedaContinuity: LumeFiloContinuity? = nil
    ) {
        self.axis = axis
        self.isConnected = isConnected
        self.tone = tone
        self.lineWidth = min(max(lineWidth, 1), 2)
        self.quadroSchedaContinuity = quadroSchedaContinuity
    }

    public var body: some View {
        linkedPath
            .onAppear { updateProgress(isConnected: isConnected) }
            .onChange(of: isConnected) { updateProgress(isConnected: $0) }
    }

    @ViewBuilder
    private var linkedPath: some View {
        if let continuity = quadroSchedaContinuity {
            strokedPath.matchedGeometryEffect(
                id: continuity.id,
                in: continuity.namespace,
                isSource: continuity.isSource
            )
        } else {
            strokedPath
        }
    }

    private var strokedPath: some View {
        let palette = LumePalette.palette(for: colorScheme, isGuardia: isGuardia)
        let color = tone == .minerale ? palette.minerale : palette.inkMuted

        return FiloPath(axis: axis)
            .trim(from: 0, to: drawProgress)
            .stroke(
                color,
                style: StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round)
            )
    }

    private func updateProgress(isConnected: Bool) {
        let target: CGFloat = isConnected ? 1 : 0
        let reduceMotion = AppleAppearanceStore.shouldReduceMotion(
            systemReduceMotion: systemReduceMotion,
            override: reduceMotionOverride
        )
        if reduceMotion {
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) { drawProgress = target }
        } else {
            withAnimation(.easeOut(duration: 0.2)) { drawProgress = target }
        }
    }
}

public struct RigaLista<Content: View>: View {
    private let isSelected: Bool
    private let content: Content

    public init(isSelected: Bool = false, @ViewBuilder content: () -> Content) {
        self.isSelected = isSelected
        self.content = content()
    }

    public var body: some View {
        content
            .monospacedDigit()
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .padding(.horizontal, 12)
            .lumeSurface(zone: isSelected ? .focal : .field, cornerRadius: 10)
            .contentShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

/* @Codex */
struct LumeRigaListaModifier: ViewModifier {
    let isSelected: Bool

    func body(content: Content) -> some View {
        RigaLista(isSelected: isSelected) { content }
    }
}

private struct LumeInchiostroModifier: ViewModifier {
    let bozza: Bool

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.lumeGuardia) private var isGuardia
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    @Environment(\.appleReduceMotionOverride) private var reduceMotionOverride

    func body(content: Content) -> some View {
        let palette = LumePalette.palette(for: colorScheme, isGuardia: isGuardia)
        let reduceMotion = AppleAppearanceStore.shouldReduceMotion(
            systemReduceMotion: systemReduceMotion,
            override: reduceMotionOverride
        )

        content
            .foregroundStyle(bozza ? palette.inkMuted : palette.inkPrimary)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: bozza)
    }
}

public extension View {
    /// Renders epistemic state through ink. The caller supplies the honest
    /// draft label so wording remains specific to the clinical context.
    func lumeInchiostro(bozza: Bool) -> some View {
        modifier(LumeInchiostroModifier(bozza: bozza))
    }
}

struct LumeGlassModifier<S: Shape>: ViewModifier {
    let shape: S

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.lumeGuardia) private var isGuardia
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    @Environment(\.appleReduceMotionOverride) private var reduceMotionOverride
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    func body(content: Content) -> some View {
        let palette = LumePalette.palette(for: colorScheme, isGuardia: isGuardia)
        let reduceMotion = AppleAppearanceStore.shouldReduceMotion(
            systemReduceMotion: systemReduceMotion,
            override: reduceMotionOverride
        )

        if reduceTransparency {
            content.background(palette.chrome, in: shape)
        } else if #available(iOS 26.0, macOS 26.0, *), !reduceMotion {
            content.glassEffect(.regular, in: shape)
        } else {
            content.background(.regularMaterial, in: shape)
        }
    }
}

public extension View {
    /// Liquid Glass belongs to controls, system chrome and transient overlays.
    /// Reduce Transparency always selects an opaque Lume chrome surface.
    func lumeGlass<S: Shape>(in shape: S = Capsule()) -> some View {
        modifier(LumeGlassModifier(shape: shape))
    }
}

#if DEBUG
private struct LumeKitPreview: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("LumeSurface")
                .frame(maxWidth: .infinity, minHeight: 44)
                .lumeSurface(zone: .canvas)

            LumeCard(zone: .field) {
                Text("LumeCard in penombra")
            }

            RigaLista(isSelected: true) {
                HStack {
                    Text("Pressione")
                    Spacer()
                    Text("120/80 mmHg").registro()
                }
            }

            HStack(spacing: 12) {
                Filo(axis: .horizontal)
                    .frame(width: 100, height: 8)
                Text("Provenienza")
                    .lumeInchiostro(bozza: true)
                Text("Bozza").font(.caption)
            }
        }
        .padding(24)
        .lumeSurface(zone: .chrome, cornerRadius: 20)
        .frame(width: 420)
    }
}

#Preview("LumeKit - giorno") {
    LumeKitPreview()
        .environment(\.colorScheme, .light)
        .lumeGuardia(false)
}

#Preview("LumeKit - grafite") {
    LumeKitPreview()
        .environment(\.colorScheme, .dark)
        .lumeGuardia(false)
}

#Preview("LumeKit - guardia") {
    LumeKitPreview()
        .environment(\.colorScheme, .dark)
        .lumeGuardia()
}
#endif

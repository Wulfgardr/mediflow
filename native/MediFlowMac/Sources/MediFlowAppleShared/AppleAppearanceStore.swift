import SwiftUI

public enum AppleAppearanceTheme: String, CaseIterable, Identifiable {
    case system
    case light
    case dark

    public var id: Self { self }

    public var preferredColorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }

    var title: String {
        switch self {
        case .system: "Sistema"
        case .light: "Chiaro"
        case .dark: "Scuro"
        }
    }
}

@MainActor
public final class AppleAppearanceStore: ObservableObject {
    private enum Key {
        static let theme = "mediflow.apple.appearance.theme"
        static let reduceMotionOverride = "mediflow.apple.appearance.reduce-motion"
        static let privacyShieldEnabled = "mediflow.apple.privacy.shield-enabled"
    }

    @Published public var theme: AppleAppearanceTheme {
        didSet { userDefaults.set(theme.rawValue, forKey: Key.theme) }
    }
    @Published public var reduceMotionOverride: Bool {
        didSet { userDefaults.set(reduceMotionOverride, forKey: Key.reduceMotionOverride) }
    }
    @Published public var privacyShieldEnabled: Bool {
        didSet { userDefaults.set(privacyShieldEnabled, forKey: Key.privacyShieldEnabled) }
    }

    private let userDefaults: UserDefaults

    public init(userDefaults: UserDefaults = .standard) {
        self.userDefaults = userDefaults
        theme = userDefaults.string(forKey: Key.theme).flatMap(AppleAppearanceTheme.init(rawValue:)) ?? .system
        reduceMotionOverride = userDefaults.bool(forKey: Key.reduceMotionOverride)
        privacyShieldEnabled = userDefaults.bool(forKey: Key.privacyShieldEnabled)
    }

    static func shouldReduceMotion(systemReduceMotion: Bool, override: Bool) -> Bool {
        systemReduceMotion || override
    }
}

private struct AppleReduceMotionOverrideKey: EnvironmentKey {
    static let defaultValue = false
}

public extension EnvironmentValues {
    var appleReduceMotionOverride: Bool {
        get { self[AppleReduceMotionOverrideKey.self] }
        set { self[AppleReduceMotionOverrideKey.self] = newValue }
    }
}

private struct AppleMotionReductionModifier: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    @Environment(\.appleReduceMotionOverride) private var reduceMotionOverride

    func body(content: Content) -> some View {
        content.transaction { transaction in
            if AppleAppearanceStore.shouldReduceMotion(
                systemReduceMotion: systemReduceMotion,
                override: reduceMotionOverride
            ) {
                transaction.disablesAnimations = true
            }
        }
    }
}

public extension View {
    func respectsAppleMotionPreference() -> some View {
        modifier(AppleMotionReductionModifier())
    }
}

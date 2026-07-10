// Fase 0: native macOS surface of the universal app. Mounts the shared
// SwiftUI root (size-class aware in later phases) and exposes the home-base
// runtime status in Settings. The Mac IS the home-base: HomeBaseRuntimeSupervisor
// (macOS-only, in MediFlowAppleShared) supervises the bundled WebRuntime.
// WebRuntime bundling + App Sandbox entitlements are a later-phase packaging task.
import MediFlowAppleShared
import SwiftUI

@main
struct MediFlowMacShellApp: App {
    @StateObject private var appearance = AppleAppearanceStore()

    var body: some Scene {
        WindowGroup {
            AppleFoundationMobileRootView(snapshot: .live, appearance: appearance)
                .frame(minWidth: 1120, minHeight: 760)
                .preferredColorScheme(appearance.theme.preferredColorScheme)
        }

        Settings {
            HomeBaseRuntimeStatusView()
                .padding(20)
                .frame(width: 720, height: 520)
                .environment(\.appleReduceMotionOverride, appearance.reduceMotionOverride)
                .respectsAppleMotionPreference()
                .preferredColorScheme(appearance.theme.preferredColorScheme)
        }
    }
}

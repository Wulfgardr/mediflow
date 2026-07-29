// Native macOS surface of the universal app. The window mounts the Mac shell
// (sidebar + detail + menu bar), not the mobile root: the two platforms share
// the workspace model and the clinical views, not the navigation.
// The Mac IS the home-base: HomeBaseRuntimeSupervisor (macOS-only, in
// MediFlowAppleShared) supervises the bundled WebRuntime. WebRuntime bundling +
// App Sandbox entitlements are a later-phase packaging task.
import MediFlowAppleShared
import SwiftUI

@main
struct MediFlowMacShellApp: App {
    @StateObject private var appearance = AppleAppearanceStore()
    @StateObject private var scene = MediFlowMacSceneModel()

    var body: some Scene {
        WindowGroup {
            MediFlowMacRootView(snapshot: .live, scene: scene, appearance: appearance)
                // Measured, not guessed: below ~1100pt the three panes (sections,
                // worklist, chart) can no longer all be laid out and the chart
                // starts to clip at the window edge.
                .frame(minWidth: 1100, minHeight: 680)
                .preferredColorScheme(appearance.theme.preferredColorScheme)
        }
        .defaultSize(width: 1280, height: 840)
        .commands { MediFlowMacCommands(scene: scene) }

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

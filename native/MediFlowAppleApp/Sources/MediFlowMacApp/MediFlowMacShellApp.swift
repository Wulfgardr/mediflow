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

    var body: some Scene {
        WindowGroup {
            MediFlowMacWindow(appearance: appearance)
        }
        .defaultSize(width: 1280, height: 840)
        .commands { MediFlowMacCommands() }

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

/* @Codex */
private struct MediFlowMacWindow: View {
    @StateObject private var scene = MediFlowMacSceneModel()
    @ObservedObject var appearance: AppleAppearanceStore

    var body: some View {
        MediFlowMacRootView(snapshot: .live, scene: scene, appearance: appearance)
            // Measured, not guessed: below ~1100pt the three panes (sections,
            // worklist, chart) can no longer all be laid out and the chart
            // starts to clip at the window edge.
            .frame(minWidth: 1100, minHeight: 680)
            .preferredColorScheme(appearance.theme.preferredColorScheme)
    }
}

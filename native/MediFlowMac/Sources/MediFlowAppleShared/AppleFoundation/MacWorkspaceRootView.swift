#if os(macOS)
import SwiftUI

/* @Codex */
@MainActor
struct ClinicalWorkspaceNavigationAction {
    let section: ClinicalWorkspaceSection
    let canCreatePatient: Bool
    let select: (ClinicalWorkspaceSection) -> Void
    let createPatient: () -> Void
}

struct ClinicalWorkspaceNavigationActionKey: FocusedValueKey {
    typealias Value = ClinicalWorkspaceNavigationAction?
    static var defaultValue: ClinicalWorkspaceNavigationAction? { nil }
}

/* @Codex */
@MainActor
struct ClinicalWorkspaceInspectorAction {
    let isEnabled: Bool
    let isPresented: Bool
    let toggle: () -> Void
}

struct ClinicalWorkspaceInspectorActionKey: FocusedValueKey {
    typealias Value = ClinicalWorkspaceInspectorAction?
    static var defaultValue: ClinicalWorkspaceInspectorAction? { nil }
}

/// The current detail section exposes its own refresh semantics to the menu
/// bar. This keeps ⌘R aligned with the visible workspace instead of treating
/// every section as the patient list.
@MainActor
struct ClinicalWorkspaceRefreshAction {
    let isEnabled: Bool
    let perform: () -> Void
}

struct ClinicalWorkspaceRefreshActionKey: FocusedValueKey {
    typealias Value = ClinicalWorkspaceRefreshAction?
    static var defaultValue: ClinicalWorkspaceRefreshAction? { nil }
}

extension FocusedValues {
    var clinicalWorkspaceNavigationAction: ClinicalWorkspaceNavigationAction? {
        get { self[ClinicalWorkspaceNavigationActionKey.self] ?? nil }
        set { self[ClinicalWorkspaceNavigationActionKey.self] = newValue }
    }

    var clinicalWorkspaceInspectorAction: ClinicalWorkspaceInspectorAction? {
        get { self[ClinicalWorkspaceInspectorActionKey.self] ?? nil }
        set { self[ClinicalWorkspaceInspectorActionKey.self] = newValue }
    }

    var clinicalWorkspaceRefreshAction: ClinicalWorkspaceRefreshAction? {
        get { self[ClinicalWorkspaceRefreshActionKey.self] ?? nil }
        set { self[ClinicalWorkspaceRefreshActionKey.self] = newValue }
    }
}

/// Scene-level state of the macOS app.
///
/// One instance belongs to one window. Commands reach it through focused
/// values, so a second window never inherits the first window's selection.
@MainActor
public final class MediFlowMacSceneModel: ObservableObject {
    @Published public var section: ClinicalWorkspaceSection = .patients
    @Published public var columnVisibility: NavigationSplitViewVisibility = .all

    /// Built after the first frame, never during scene construction.
    ///
    /// `PairedPatientsWorkspaceModel.init` reads the paired snapshot out of the
    /// Keychain. Built eagerly here that read runs before SwiftUI creates the
    /// window, and when macOS decides to show its authorization panel the app
    /// has no window at all until the panel is answered: the user sees a Dock
    /// icon and nothing else, with no statement of what is being waited on.
    @Published private(set) var workspaceModel: PairedPatientsWorkspaceModel?
    let capabilities = ClinicalWorkspaceCapabilitiesStore()

    public init() {
        let overrides = AppleFoundationLaunchOverrides.load()
        if let initial = overrides.initialSection {
            section = ClinicalWorkspaceSection(legacy: initial)
        }
        launchDynamicTypeSizeOverride = overrides.dynamicTypeSizeOverride
    }

    let launchDynamicTypeSizeOverride: DynamicTypeSize?

    /// Called from the root view's `task`, so the window is on screen first.
    func prepareWorkspaceIfNeeded() {
        guard workspaceModel == nil else { return }
        workspaceModel = PairedPatientsWorkspaceModel()
    }

    /// Whether the current section can accept a new patient. The menu item stays
    /// visible but disabled elsewhere, so the shortcut never silently no-ops.
    public var canCreatePatient: Bool {
        guard let workspaceModel, section == .patients else { return false }
        return workspaceModel.canCreatePatient && !workspaceModel.isWorking
    }

    public func createPatient() {
        guard canCreatePatient else { return }
        workspaceModel?.startCreatingPatient()
    }

    public var canRefresh: Bool {
        guard section == .patients, let workspaceModel else { return false }
        return !workspaceModel.isWorking
    }

    public func refresh() {
        guard section == .patients, canRefresh, let workspaceModel else { return }
        Task { await workspaceModel.loadPatients() }
    }

    public func select(_ section: ClinicalWorkspaceSection) {
        self.section = section
    }
}

/// Root scene content of the macOS app.
///
/// This is a Mac window, not an iPad layout in a resizable frame: a
/// `List(selection:)` sidebar with the system's own selection chrome, a detail
/// column that carries the window title and the live connection state, and no
/// custom background competing with the sidebar material.
public struct MediFlowMacRootView: View {
    private let snapshot: AppleFoundationSnapshot
    @ObservedObject private var scene: MediFlowMacSceneModel
    @ObservedObject private var appearance: AppleAppearanceStore
    @Environment(\.dynamicTypeSize) private var inheritedDynamicTypeSize
    @SceneStorage("mediflow.mac.patientInspector.isPresented") private var isInspectorPresented = false

    public init(
        snapshot: AppleFoundationSnapshot,
        scene: MediFlowMacSceneModel,
        appearance: AppleAppearanceStore
    ) {
        self.snapshot = snapshot
        _scene = ObservedObject(wrappedValue: scene)
        _appearance = ObservedObject(wrappedValue: appearance)
    }

    public var body: some View {
        NavigationSplitView(columnVisibility: $scene.columnVisibility) {
            sidebar
        } detail: {
            Group {
                if let workspaceModel = scene.workspaceModel {
                    // The chrome observes the workspace, so the window subtitle
                    // tracks it. Read straight from this view the subtitle went
                    // stale: this view observes the scene, not the workspace, so
                    // twenty loaded patients still read "Non caricato".
                    MacInspectorCommandBridge(
                        workspaceModel: workspaceModel,
                        section: scene.section,
                        isPresented: $isInspectorPresented
                    ) {
                        MacDetailChrome(workspaceModel: workspaceModel, section: scene.section) {
                            detailView(for: scene.section, workspaceModel: workspaceModel)
                        }
                    }
                } else {
                    startupState
                        .navigationTitle(scene.section.title)
                        .navigationSubtitle("Avvio in corso")
                }
            }
        }
        .modifier(MacPatientInspectorPresentationModifier(
            workspaceModel: scene.workspaceModel,
            isPresented: $isInspectorPresented
        ))
        .focusedSceneValue(\.clinicalWorkspaceNavigationAction, navigationAction)
        .task {
            // Keeps the paired-snapshot read out of the scene initialiser, which
            // is the right place for it not to be: a scene initialiser should not
            // perform I/O.
            //
            // Measured, so it is not mistaken for a fix: this does NOT make the
            // window appear before the Keychain panel. `loadSnapshot()` is
            // synchronous on the main actor, and while macOS shows the panel it
            // blocks the run loop before AppKit ever orders the window in — at
            // 10s with the panel up there is still no window. Closing that
            // defect means making the snapshot read genuinely asynchronous in
            // HomeBasePairedStore, which is shared with iOS and is a decision
            // beyond this macOS lane.
            await Task.yield()
            scene.prepareWorkspaceIfNeeded()
        }
        .task(id: scene.workspaceModel?.clinicalWorkspaceConnection?.identity) {
            await scene.capabilities.loadIfNeeded(using: scene.workspaceModel?.clinicalWorkspaceConnection)
            scene.workspaceModel?.updateAvailableCapabilities(scene.capabilities.settledCapabilityKeys)
        }
        .environment(\.appleReduceMotionOverride, appearance.reduceMotionOverride)
        .environment(\.dynamicTypeSize, scene.launchDynamicTypeSizeOverride ?? inheritedDynamicTypeSize)
        .respectsAppleMotionPreference()
        .privacyShield(appearance: appearance)
    }

    /* @Codex */
    private var navigationAction: ClinicalWorkspaceNavigationAction {
        ClinicalWorkspaceNavigationAction(
            section: scene.section,
            canCreatePatient: scene.canCreatePatient,
            select: scene.select,
            createPatient: scene.createPatient
        )
    }

    // MARK: - Sidebar

    private var sidebar: some View {
        // `List(selection:)` with plain rows, not buttons: the system draws the
        // selection, keyboard arrows move it, and VoiceOver reads it as a list.
        // The previous plain-button rows rendered no visible label at all.
        List(selection: $scene.section) {
            Section("Clinica") {
                ForEach(ClinicalWorkspaceSection.clinicalSections) { sidebarRow($0) }
            }
            Section("Consultazione") {
                ForEach(MediFlowMacRootView.referenceSections) { sidebarRow($0) }
            }
            Section("Sistema") {
                ForEach(MediFlowMacRootView.systemSections) { sidebarRow($0) }
            }
            Section("Progetto") {
                ForEach(MediFlowMacRootView.projectSections) { sidebarRow($0) }
            }
        }
        .listStyle(.sidebar)
        .navigationSplitViewColumnWidth(min: 196, ideal: 228, max: 320)
        .navigationTitle("MediFlow")
        .accessibilityIdentifier("clinical-workspace-project-sidebar")
    }

    /// Runtime is the home-base status of this very Mac, so it belongs with the
    /// app's own settings. Panoramica and Tappe are project-state surfaces and
    /// stay grouped apart from the clinical work.
    static let referenceSections: [ClinicalWorkspaceSection] = [.repertori]
    static let systemSections: [ClinicalWorkspaceSection] = [.settings, .host, .runtime]
    static let projectSections: [ClinicalWorkspaceSection] = [.overview, .milestones]

    private func sidebarRow(_ item: ClinicalWorkspaceSection) -> some View {
        Label(item.title, systemImage: item.symbolName)
            .tag(item)
            .accessibilityIdentifier("clinical-workspace-section-\(item.rawValue)-button")
    }

    // MARK: - Detail

    /// Shown only for the frame or two before the workspace exists. It names what
    /// is happening, because the wait can include a system Keychain panel.
    private var startupState: some View {
        VStack(spacing: 10) {
            ProgressView()
            Text("Apertura dell'archivio locale")
                .font(.headline)
            Text("MediFlow sta leggendo le credenziali di collegamento dal portachiavi. Se macOS chiede l'autorizzazione, la finestra resta disponibile.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 420)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityIdentifier("clinical-workspace-startup-view")
    }

    @ViewBuilder
    private func detailView(
        for section: ClinicalWorkspaceSection,
        workspaceModel: PairedPatientsWorkspaceModel
    ) -> some View {
        switch section {
        case .patients:
            PairedPatientsWorkspaceView(model: workspaceModel, capabilities: scene.capabilities)
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("clinical-workspace-patients-view")
        case .agenda:
            AgendaWorkspaceView(capabilities: scene.capabilities, workspaceModel: workspaceModel)
                .accessibilityIdentifier("clinical-workspace-agenda-view")
        case .diary:
            GlobalDiaryWorkspaceView(capabilities: scene.capabilities, workspaceModel: workspaceModel)
                .accessibilityIdentifier("clinical-workspace-diary-view")
        case .analytics:
            PopulationAnalyticsWorkspaceView(capabilities: scene.capabilities, workspaceModel: workspaceModel)
                .accessibilityIdentifier("clinical-workspace-analytics-view")
        case .scales:
            ClinicalScalesWorkspaceView(capabilities: scene.capabilities, workspaceModel: workspaceModel)
                .accessibilityIdentifier("clinical-workspace-scales-view")
        case .settings:
            SettingsWorkspaceView(
                capabilities: scene.capabilities,
                workspaceModel: workspaceModel,
                appearance: appearance
            )
            .accessibilityIdentifier("clinical-workspace-settings-view")
        case .repertori:
            RepertoriWorkspaceView(workspaceModel: workspaceModel)
        case .host:
            HostAdminWorkspaceView(workspaceModel: workspaceModel)
        case .runtime:
            ScrollView {
                HomeBaseRuntimeStatusView()
                    .padding(20)
            }
            .accessibilityIdentifier("apple-foundation-runtime-view")
        case .overview:
            AppleFoundationOverviewView(snapshot: snapshot)
                .padding(20)
                .accessibilityIdentifier("apple-foundation-overview-view")
        case .milestones:
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(snapshot.milestones) { milestone in
                        AppleMilestoneCard(milestone: milestone)
                    }
                }
                .padding(20)
            }
            .accessibilityIdentifier("apple-foundation-milestones-view")
        }
    }
}

/// Window title and subtitle for the detail column.
///
/// Exists as its own view purely so it can observe the workspace: the subtitle
/// has to change when patients load or the connection state moves, and the root
/// view observes the scene rather than the workspace.
private struct MacDetailChrome<Content: View>: View {
    @ObservedObject var workspaceModel: PairedPatientsWorkspaceModel
    let section: ClinicalWorkspaceSection
    @ViewBuilder var content: Content

    var body: some View {
        content
            .navigationTitle(section.title)
            .navigationSubtitle(subtitle)
    }

    /// States the connection, and on the patients section the size of what is
    /// actually on screen. The two are never combined: a loaded list under a
    /// "Non caricato" connection state reads as a contradiction.
    private var subtitle: String {
        let count = workspaceModel.patients.count
        guard section == .patients, count > 0 else {
            return workspaceModel.connectionState.title
        }
        return count == 1 ? "1 paziente" : "\(count) pazienti"
    }
}

/// Menu bar of the macOS app.
///
/// Everything the window can do from a control is also reachable from a menu and
/// a shortcut, which is what makes the app usable from the keyboard and what
/// VoiceOver users navigate first.
public struct MediFlowMacCommands: Commands {
    @Environment(\.openWindow) private var openWindow
    @FocusedValue(\.clinicalWorkspaceNavigationAction) private var navigation
    @FocusedValue(\.clinicalWorkspaceInspectorAction) private var inspector
    @FocusedValue(\.clinicalWorkspaceRefreshAction) private var workspaceRefresh

    public init() {}

    public var body: some Commands {
        CommandGroup(after: .windowList) {
            Button("Nuova finestra MediFlow") {
                openWindow(id: "clinical-workspace-secondary")
            }
        }

        // Replaces "New" wholesale: this app has one creatable thing, and a
        // File > New that opened a second empty window would be a lie.
        CommandGroup(replacing: .newItem) {
            Button("Nuovo paziente") {
                navigation?.select(.patients)
                navigation?.createPatient()
            }
            .keyboardShortcut("n", modifiers: .command)
            .disabled(navigation == nil || (navigation?.section == .patients && navigation?.canCreatePatient == false))
        }

        CommandMenu("Vai") {
            ForEach(Array(ClinicalWorkspaceSection.clinicalSections.enumerated()), id: \.element) { index, item in
                Button(item.title) { navigation?.select(item) }
                    .keyboardShortcut(shortcutKey(for: index), modifiers: .command)
            }
            Divider()
            ForEach(MediFlowMacRootView.referenceSections + MediFlowMacRootView.systemSections) { item in
                Button(item.title) { navigation?.select(item) }
            }
            Divider()
            ForEach(MediFlowMacRootView.projectSections) { item in
                Button(item.title) { navigation?.select(item) }
            }
            Divider()
            Button("Aggiorna") {
                if let workspaceRefresh {
                    workspaceRefresh.perform()
                }
            }
                .keyboardShortcut("r", modifiers: .command)
                .disabled(!(workspaceRefresh?.isEnabled ?? false))
        }

        CommandMenu("Vista") {
            Button(inspector?.isPresented == true ? "Nascondi dettagli paziente" : "Mostra dettagli paziente") {
                inspector?.toggle()
            }
            .keyboardShortcut("i", modifiers: [.command, .option])
            .disabled(!(inspector?.isEnabled ?? false))
        }
    }

    private func shortcutKey(for index: Int) -> KeyEquivalent {
        KeyEquivalent(Character("\(index + 1)"))
    }
}

/* @Codex */
private struct MacInspectorCommandBridge<Content: View>: View {
    @ObservedObject var workspaceModel: PairedPatientsWorkspaceModel
    let section: ClinicalWorkspaceSection
    @Binding var isPresented: Bool
    @ViewBuilder let content: Content

    private var isEnabled: Bool {
        section == .patients && workspaceModel.selectedPatient != nil
    }

    var body: some View {
        content
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        guard isEnabled else { return }
                        isPresented.toggle()
                    } label: {
                        Label("Dettagli paziente", systemImage: "sidebar.trailing")
                    }
                    .help("Mostra o nascondi i dettagli del paziente")
                    .disabled(!isEnabled)
                    .accessibilityValue(isPresented ? "Mostrato" : "Nascosto")
                    .accessibilityIdentifier("clinical-workspace-inspector-toggle")
                }
            }
            .focusedSceneValue(\.clinicalWorkspaceInspectorAction, ClinicalWorkspaceInspectorAction(
                isEnabled: isEnabled,
                isPresented: isPresented,
                toggle: {
                    guard isEnabled else { return }
                    isPresented.toggle()
                }
            ))
            .onChange(of: section) { nextSection in
                if nextSection != .patients { isPresented = false }
            }
    }
}
#endif

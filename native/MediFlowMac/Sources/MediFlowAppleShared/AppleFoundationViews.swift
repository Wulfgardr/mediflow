// Codex: created 2026-04-17
import SwiftUI
import MediFlowCore
#if os(macOS)
import AppKit
#else
import UIKit
#endif

#if os(iOS)
private struct TabBarAccessibilityIdentifierBridge: UIViewRepresentable {
    let identifiersByTitle: [String: String]
    let selection: String

    func makeUIView(context: Context) -> ResolverView {
        ResolverView(identifiersByTitle: identifiersByTitle)
    }

    func updateUIView(_ uiView: ResolverView, context: Context) {
        uiView.identifiersByTitle = identifiersByTitle
        uiView.scheduleUpdate()
    }

    final class ResolverView: UIView {
        var identifiersByTitle: [String: String]

        init(identifiersByTitle: [String: String]) {
            self.identifiersByTitle = identifiersByTitle
            super.init(frame: .zero)
            isAccessibilityElement = false
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) {
            fatalError("init(coder:) has not been implemented")
        }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            scheduleUpdate()
        }

        func scheduleUpdate() {
            for delay in [0.0, 0.25, 1.0, 2.0] {
                DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                    self?.updateTabItems()
                }
            }
        }

        private func updateTabItems() {
            guard let window else { return }

            let resolvedTabBars = tabBars(in: window)
            for tabBar in resolvedTabBars {
                for item in tabBar.items ?? [] {
                    guard
                        let title = item.title,
                        let identifier = identifiersByTitle[title]
                    else { continue }
                    item.accessibilityIdentifier = identifier
                }

                let tabLabels = descendants(of: tabBar).compactMap { $0 as? UILabel }

                for (title, identifier) in identifiersByTitle {
                    // iOS 27 keeps a suppressed rendering copy behind the
                    // interactive tab. UIKit subviews are ordered back-to-front,
                    // so the last matching label belongs to the tappable surface.
                    tabLabels.last { $0.text == title }?
                        .superview?
                        .accessibilityIdentifier = identifier
                }
            }
        }

        private func tabBars(in view: UIView) -> [UITabBar] {
            var result = view is UITabBar ? [view as! UITabBar] : []
            for subview in view.subviews {
                result.append(contentsOf: tabBars(in: subview))
            }
            return result
        }

        private func descendants(of view: UIView) -> [UIView] {
            view.subviews + view.subviews.flatMap(descendants(of:))
        }
    }
}
#endif

public struct AppleFoundationWindowContent: View {
    public let snapshot: AppleFoundationSnapshot

    public init(snapshot: AppleFoundationSnapshot) {
        self.snapshot = snapshot
    }

    public var body: some View {
        AppleFoundationOverviewView(snapshot: snapshot)
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(PlatformColors.chartCardSurface)
    }
}

public struct AppleFoundationOverviewView: View {
    public let snapshot: AppleFoundationSnapshot

    public init(snapshot: AppleFoundationSnapshot) {
        self.snapshot = snapshot
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                safetyNotes
                HomeBaseRuntimeStatusView()
                lanes
                milestones
            }
            .padding(.vertical, 2)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(snapshot.title)
                .font(.largeTitle.weight(.semibold))
            Text(snapshot.summary)
                .font(.body)
                .foregroundStyle(.secondary)
            Text(snapshot.statusLine)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .padding(.top, 2)
        }
    }

    private var safetyNotes: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Guardrail")
                .font(.headline)
            ForEach(snapshot.safetyNotes, id: \.self) { note in
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "checkmark.shield")
                        .foregroundStyle(LumePalette.success)
                        .font(.body)
                    Text(note)
                        .font(.subheadline)
                        .foregroundStyle(.primary)
                }
            }
        }
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) { Rectangle().fill(PlatformColors.separator).frame(height: 1) }
    }

    private var lanes: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Ambiti")
                .font(.headline)
            ForEach(snapshot.lanes) { lane in
                AppleCapabilityLaneCard(lane: lane)
            }
        }
    }

    private var milestones: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Sequenza")
                .font(.headline)
            ForEach(snapshot.milestones) { milestone in
                AppleMilestoneCard(milestone: milestone)
            }
        }
    }
}

public struct AppleCapabilityLaneCard: View {
    public let lane: AppleCapabilityLane

    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(lane: AppleCapabilityLane) {
        self.lane = lane
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                Text(lane.title)
                    .font(.headline)
                Text(lane.summary)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Label(lane.sourceOfTruth, systemImage: "doc.text")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if usesStackedPlatformLayout {
                VStack(alignment: .leading, spacing: 10) {
                    platformStatusSection("macOS", status: lane.macOS)
                    platformStatusSection("iPhone", status: lane.iPhone)
                    platformStatusSection("iPad", status: lane.iPad)
                }
            } else {
                Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 10) {
                    GridRow {
                        platformHeader("macOS")
                        platformHeader("iPhone")
                        platformHeader("iPad")
                    }
                    GridRow {
                        platformStatus(lane.macOS)
                        platformStatus(lane.iPhone)
                        platformStatus(lane.iPad)
                    }
                }
            }

            Label("Next: \(lane.nextIssue)", systemImage: "arrowshape.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) { Rectangle().fill(PlatformColors.separator).frame(height: 1) }
    }

    private func platformHeader(_ title: String) -> some View {
        Text(title)
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func platformStatusSection(_ title: String, status: ApplePlatformStatus) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            platformHeader(title)
            platformStatus(status)
        }
    }

    private func platformStatus(_ status: ApplePlatformStatus) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: status.phase.symbolName)
                    .foregroundStyle(status.phase.tintColor)
                Text(status.phase.title)
                    .font(.caption.weight(.semibold))
            }
            Text(status.detail)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var usesStackedPlatformLayout: Bool {
        #if os(macOS)
        return false
        #else
        return horizontalSizeClass == .compact
        #endif
    }
}

public struct AppleFoundationMobileRootView: View {
    public let snapshot: AppleFoundationSnapshot
    @ObservedObject private var appearance: AppleAppearanceStore
    @Environment(\.dynamicTypeSize) private var inheritedDynamicTypeSize
    private let dynamicTypeSizeOverride: DynamicTypeSize?

    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif
    @State private var section: ClinicalWorkspaceSection
    @State private var showsProjectSurfaces = false
    @State private var showsProjectSidebar = false
    @State private var selectedOtherSection: ClinicalWorkspaceSection?
    // URL intents and project paths belong to this window, never to defaults.
    @State private var projectNavigationPath: [ClinicalWorkspaceSection] = []
    @StateObject private var navigationRouter = ClinicalNavigationRouter()
    @StateObject private var workspaceModel = PairedPatientsWorkspaceModel()
    @StateObject private var capabilitiesStore = ClinicalWorkspaceCapabilitiesStore()

    public init(snapshot: AppleFoundationSnapshot, appearance: AppleAppearanceStore) {
        self.snapshot = snapshot
        _appearance = ObservedObject(wrappedValue: appearance)
        let launchOverrides = AppleFoundationLaunchOverrides.load()
        dynamicTypeSizeOverride = launchOverrides.dynamicTypeSizeOverride
        _section = State(initialValue: launchOverrides.initialSection.map(ClinicalWorkspaceSection.init(legacy:)) ?? .patients)
    }

    #if DEBUG && os(iOS)
    @State private var layoutTestWidth: CGFloat = 400
    private var usesLayoutTestHarness: Bool {
        ProcessInfo.processInfo.environment["MEDIFLOW_APPLE_UITEST_ADAPTIVE_LAYOUT"] == "1"
    }
    #endif

    public var body: some View {
        #if DEBUG && os(iOS)
        if usesLayoutTestHarness {
            GeometryReader { proxy in
                VStack(spacing: 0) {
                    HStack {
                        ForEach([400, 650, 1000], id: \.self) { width in
                            Button("\(width) pt") { layoutTestWidth = CGFloat(width) }
                                .accessibilityIdentifier("layout-test-width-\(width)")
                        }
                    }
                    .frame(height: 44)
                    workspaceBody
                        .environment(\.horizontalSizeClass, layoutTestWidth == 400 ? .compact : .regular)
                        .frame(width: min(layoutTestWidth, proxy.size.width))
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        } else {
            workspaceBody
        }
        #else
        workspaceBody
        #endif
    }

    private var workspaceBody: some View {
        Group {
            #if os(macOS)
            NavigationSplitView {
                projectSidebar
            } detail: {
                detailView(for: section)
                    .inkWorkspaceTitle(section.title)
            }
            #else
            mobileTabWorkspace
                .overlay(alignment: .leading) {
                    if usesSplitLayout && showsProjectSidebar { mobileProjectSidebar }
                }
            #endif
        }
        .task(id: workspaceModel.clinicalWorkspaceConnection?.identity) {
            await capabilitiesStore.loadIfNeeded(using: workspaceModel.clinicalWorkspaceConnection)
            // Hand the answer to the workspace model, which is the object every
            // clinical section observes. Only some of them receive the store, so
            // a gate hanging off the store alone would not redraw their buttons
            // when the answer arrived.
            workspaceModel.updateAvailableCapabilities(capabilitiesStore.settledCapabilityKeys)
        }
        .sheet(isPresented: $showsProjectSurfaces) { projectSurfaceSheet }
        .modifier(ClinicalNavigationReception(
            router: navigationRouter, platform: .mobile, workspace: workspaceModel,
            navigate: navigateFromLink
        ))
        .environment(\.appleReduceMotionOverride, appearance.reduceMotionOverride)
        .environment(\.dynamicTypeSize, dynamicTypeSizeOverride ?? inheritedDynamicTypeSize)
        .respectsAppleMotionPreference()
        .privacyShield(appearance: appearance)
        .tint(PlatformColors.freshInk)
        .foregroundStyle(PlatformColors.ink)
        .inkRegister()
    }

    private var projectSidebar: some View {
        List {
            Section("Clinica") { ForEach(ClinicalWorkspaceSection.clinicalSections) { sidebarButton($0) } }
            Section("Impostazioni") { ForEach(ClinicalWorkspaceSection.settingsSections) { sidebarButton($0) } }
            Section("Progetto") { ForEach(ClinicalWorkspaceSection.projectSections) { sidebarButton($0) } }
        }
        .navigationTitle("MediFlow")
        .accessibilityIdentifier("clinical-workspace-project-sidebar")
    }

    #if os(iOS)
    private var mobileProjectSidebar: some View {
        ZStack(alignment: .leading) {
            Color.black.opacity(0.08)
                .contentShape(Rectangle())
                .onTapGesture { showsProjectSidebar = false }
                .accessibilityLabel("Chiudi navigazione")
                .accessibilityAddTraits(.isButton)
            NavigationStack {
                projectSidebar
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Chiudi") { showsProjectSidebar = false }
                        }
                    }
            }
            .frame(width: 320)
            .shadow(radius: 8)
            .accessibilityAddTraits(.isModal)
        }
    }

    @ToolbarContentBuilder
    private var mobileProjectToolbar: some ToolbarContent {
        if usesSplitLayout {
            ToolbarItem(placement: .topBarLeading) {
                Button("Navigazione", systemImage: "sidebar.left") { showsProjectSidebar = true }
                    .accessibilityIdentifier("clinical-workspace-project-menu-button")
            }
        }
    }

    private var mobileTabWorkspace: some View {
        TabView(selection: Binding(
            get: { [.patients, .agenda, .diary].contains(section) ? section : .settings },
            set: { item in selectSection(item == .settings ? selectedOtherSection ?? .settings : item) }
        )) {
            ForEach([ClinicalWorkspaceSection.patients, .agenda, .diary]) { item in
                Group {
                    if item == .patients {
                        detailView(for: item)
                            .inkWorkspaceTitle(item.title)
                    } else {
                        NavigationStack {
                            detailView(for: item)
                                .inkWorkspaceTitle(item.title)
                                .toolbar { mobileProjectToolbar }
                        }
                    }
                }
                .tag(item)
                .tabItem {
                    Label(item.title, systemImage: item.symbolName)
                }
            }
            NavigationStack {
                compactOtherContent
                    .toolbar { mobileProjectToolbar }
            }
            .tag(ClinicalWorkspaceSection.settings)
            .tabItem { Label("Altro", systemImage: "ellipsis") }
        }
        #if os(iOS)
        .background(
            TabBarAccessibilityIdentifierBridge(
                identifiersByTitle: Dictionary(
                    uniqueKeysWithValues:
                        [ClinicalWorkspaceSection.patients, .agenda, .diary].map {
                            (
                                $0.title,
                                "clinical-workspace-section-\($0.rawValue)-button"
                            )
                        } + [("Altro", "clinical-workspace-section-other-button")]
                ),
                selection: section.rawValue
            )
            .frame(width: 0, height: 0)
            .accessibilityHidden(true)
        )
        #endif
    }
    #endif

    @ViewBuilder
    private var compactOtherContent: some View {
        let selected = selectedOtherSection ?? (![ClinicalWorkspaceSection.patients, .agenda, .diary, .settings].contains(section) ? section : nil)
        if let selected {
            detailView(for: selected)
                .inkWorkspaceTitle(selected.title)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Altro") {
                            selectedOtherSection = nil
                            selectSection(.settings)
                        }
                    }
                }
        } else {
            List([ClinicalWorkspaceSection.analytics, .scales, .settings] + ClinicalWorkspaceSection.projectSections) { item in
                Button {
                    selectedOtherSection = item
                    selectSection(item)
                } label: {
                    Label(item.title, systemImage: item.symbolName)
                        .foregroundStyle(PlatformColors.ink)
                }
                .frame(minHeight: 44)
                .accessibilityIdentifier("clinical-workspace-section-\(item.rawValue)-button")
            }
            .inkWorkspaceTitle("Altro")
        }
    }

    private func sidebarButton(_ item: ClinicalWorkspaceSection) -> some View {
        Button {
            selectedOtherSection = [.patients, .agenda, .diary].contains(item) ? nil : item
            selectSection(item)
            showsProjectSidebar = false
        } label: {
            HStack {
                Label(item.title, systemImage: item.symbolName)
                Spacer(minLength: 12)
                if item == section { Image(systemName: "checkmark") }
            }
            .foregroundStyle(PlatformColors.ink)
            .frame(minHeight: LumeGeometry.rowHeight)
        }
        .buttonStyle(.plain)
        .listRowBackground(item == section ? PlatformColors.selection : Color.clear)
        .accessibilityAddTraits(item == section ? .isSelected : [])
        .accessibilityIdentifier("clinical-workspace-section-\(item.rawValue)-button")
    }

    private var projectSurfaceSheet: some View {
        NavigationStack(path: Binding(
            get: { projectNavigationPath },
            set: { navigationRouter.cancel(); projectNavigationPath = $0 }
        )) {
            List(ClinicalWorkspaceSection.projectSections) { item in
                NavigationLink(value: item) {
                    Label(item.title, systemImage: item.symbolName)
                        .foregroundStyle(PlatformColors.ink)
                }
                .accessibilityIdentifier("clinical-workspace-section-\(item.rawValue)-button")
            }
            .navigationDestination(for: ClinicalWorkspaceSection.self) { item in
                detailView(for: item).inkWorkspaceTitle(item.title)
            }
            .navigationTitle("Progetto")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Chiudi") { showsProjectSurfaces = false } } }
        }
    }

    // Manual navigation cancels an in-flight link. Programmatic navigation
    // uses the same section values, without replacing the workspace or its drafts.
    private func selectSection(_ item: ClinicalWorkspaceSection) {
        navigationRouter.cancel()
        section = item
    }

    private func navigateFromLink(_ area: ClinicalNavigationArea) {
        guard let target = ClinicalWorkspaceSection(rawValue: area.rawValue) else { return }
        if !usesSplitLayout && ClinicalWorkspaceSection.projectSections.contains(target) {
            projectNavigationPath = [target]
            showsProjectSurfaces = true
        } else {
            showsProjectSurfaces = false
            selectedOtherSection = [.patients, .agenda, .diary].contains(target) ? nil : target
            section = target
            showsProjectSidebar = false
        }
    }

    private var usesSplitLayout: Bool {
        #if os(macOS)
        return true
        #else
        #if DEBUG
        if usesLayoutTestHarness { return layoutTestWidth != 400 }
        #endif
        return horizontalSizeClass == .regular
        #endif
    }

    @ViewBuilder
    private func detailView(for section: ClinicalWorkspaceSection) -> some View {
        switch section {
        case .patients:
            PairedPatientsWorkspaceView(model: workspaceModel, capabilities: capabilitiesStore, onShowProject: {
                navigationRouter.cancel()
                if usesSplitLayout {
                    showsProjectSidebar = true
                } else {
                    projectNavigationPath = []
                    showsProjectSurfaces = true
                }
            })
                // Container, so the identifier names this workspace only and is
                // not propagated onto descendants. Without it the identifier was
                // inherited by the safeAreaInset chart header, which made the
                // header's own identifier unreachable from tests.
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("clinical-workspace-patients-view")
        case .agenda:
            AgendaWorkspaceView(capabilities: capabilitiesStore, workspaceModel: workspaceModel)
                .hidden()
                .accessibilityIdentifier("clinical-workspace-agenda-view")
        case .diary:
            GlobalDiaryWorkspaceView(capabilities: capabilitiesStore, workspaceModel: workspaceModel)
                .accessibilityIdentifier("clinical-workspace-diary-view")
        case .analytics:
            PopulationAnalyticsWorkspaceView(capabilities: capabilitiesStore, workspaceModel: workspaceModel)
                .accessibilityIdentifier("clinical-workspace-analytics-view")
        case .scales:
            ClinicalScalesWorkspaceView(capabilities: capabilitiesStore, workspaceModel: workspaceModel)
                .accessibilityIdentifier("clinical-workspace-scales-view")
        case .settings:
            SettingsWorkspaceView(
                capabilities: capabilitiesStore,
                workspaceModel: workspaceModel,
                appearance: appearance
            )
                .accessibilityIdentifier("clinical-workspace-settings-view")
        case .overview:
            AppleFoundationOverviewView(snapshot: snapshot)
                .padding(20)
                .background(PlatformColors.chartCardSurface)
                .accessibilityIdentifier("apple-foundation-overview-view")
        case .repertori:
            // Catalogue browsing is a macOS surface for now; mobile reaches the
            // same data through the therapy and exemption pickers.
            EmptyView()
        case .host:
            // Host administration belongs to the machine that holds the archive.
            // A paired iPhone is not that machine, so this section is never
            // offered here; the case exists only to keep the switch exhaustive.
            EmptyView()
        case .runtime:
            ScrollView {
                HomeBaseRuntimeStatusView()
                    .padding(20)
            }
            .background(PlatformColors.chartCardSurface)
            .accessibilityIdentifier("apple-foundation-runtime-view")
        case .milestones:
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(snapshot.milestones) { milestone in
                        AppleMilestoneCard(milestone: milestone)
                    }
                }
                .padding(20)
            }
            .background(PlatformColors.chartCardSurface)
            .accessibilityIdentifier("apple-foundation-milestones-view")
        }
    }
}

public struct AppleMilestoneCard: View {
    public let milestone: AppleMilestone

    public init(milestone: AppleMilestone) {
        self.milestone = milestone
    }

    public var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: milestone.phase.symbolName)
                .foregroundStyle(milestone.phase.tintColor)
                .font(.title3)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 4) {
                Text(milestone.title)
                    .font(.subheadline.weight(.semibold))
                Text(milestone.summary)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text(milestone.issue)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) { Rectangle().fill(PlatformColors.separator).frame(height: 1) }
    }
}

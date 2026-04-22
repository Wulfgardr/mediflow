// Codex: created 2026-04-17
// @Codex
import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
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
            .background(PlatformColors.groupedBackground)
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
                        .foregroundStyle(.green)
                        .font(.body)
                    Text(note)
                        .font(.subheadline)
                        .foregroundStyle(.primary)
                }
            }
        }
        .cardStyle()
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
        .cardStyle()
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

    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif
    @State private var section: AppleFoundationSection = .overview

    public init(snapshot: AppleFoundationSnapshot) {
        self.snapshot = snapshot
    }

    public var body: some View {
        Group {
            if usesSplitLayout {
                NavigationSplitView {
                    List {
                        ForEach(AppleFoundationSection.allCases) { item in
                            Button {
                                section = item
                            } label: {
                                HStack {
                                    Label(item.title, systemImage: item.symbolName)
                                    Spacer(minLength: 12)
                                    if item == section {
                                        Image(systemName: "checkmark")
                                            .foregroundStyle(.tint)
                                    }
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .navigationTitle("MediFlow")
                } detail: {
                    detailView(for: section)
                        .navigationTitle(section.title)
                }
            } else {
                TabView {
                    NavigationStack {
                        detailView(for: .overview)
                            .navigationTitle(AppleFoundationSection.overview.title)
                    }
                    .tabItem {
                        Label(AppleFoundationSection.overview.title, systemImage: AppleFoundationSection.overview.symbolName)
                    }

                    NavigationStack {
                        detailView(for: .modules)
                            .navigationTitle(AppleFoundationSection.modules.title)
                    }
                    .tabItem {
                        Label(AppleFoundationSection.modules.title, systemImage: AppleFoundationSection.modules.symbolName)
                    }

                    NavigationStack {
                        detailView(for: .milestones)
                            .navigationTitle(AppleFoundationSection.milestones.title)
                    }
                    .tabItem {
                        Label(AppleFoundationSection.milestones.title, systemImage: AppleFoundationSection.milestones.symbolName)
                    }
                }
            }
        }
    }

    private var usesSplitLayout: Bool {
        #if os(macOS)
        return true
        #else
        return horizontalSizeClass == .regular
        #endif
    }

    @ViewBuilder
    private func detailView(for section: AppleFoundationSection) -> some View {
        switch section {
        case .overview:
            AppleFoundationOverviewView(snapshot: snapshot)
                .padding(20)
                .background(PlatformColors.groupedBackground)
        case .modules:
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(snapshot.lanes) { lane in
                        AppleCapabilityLaneCard(lane: lane)
                    }
                }
                .padding(20)
            }
            .background(PlatformColors.groupedBackground)
        case .milestones:
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(snapshot.milestones) { milestone in
                        AppleMilestoneCard(milestone: milestone)
                    }
                }
                .padding(20)
            }
            .background(PlatformColors.groupedBackground)
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
        .cardStyle()
    }
}

private struct CardStyleModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(16)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(PlatformColors.cardBackground)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(Color.primary.opacity(0.06), lineWidth: 1)
            )
    }
}

private extension View {
    func cardStyle() -> some View {
        modifier(CardStyleModifier())
    }
}

private enum PlatformColors {
    static var groupedBackground: Color {
        #if os(macOS)
        return Color(nsColor: .windowBackgroundColor)
        #else
        return Color(uiColor: .systemGroupedBackground)
        #endif
    }

    static var cardBackground: Color {
        #if os(macOS)
        return Color(nsColor: .controlBackgroundColor)
        #else
        return Color(uiColor: .secondarySystemBackground)
        #endif
    }
}

private extension AppleDeliveryPhase {
    var tintColor: Color {
        switch self {
        case .shipping:
            return .green
        case .foundation:
            return .teal
        case .next:
            return .orange
        case .blocked:
            return .red
        }
    }
}

import SwiftUI

/* @Codex */
struct PairedScalesSection: View {
    let entries: [HomeBaseEntrySummary]
    let isWorking: Bool
    let hasSelectedPatient: Bool
    let onRefresh: () -> Void
    let onStartScale: (ClinicalScaleDefinition) -> Void
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.lumeGuardia) private var isGuardia

    private var historyItems: [ScaleHistoryItem] {
        ScaleHistoryPresentation.items(from: entries)
    }

    private var libraryGroups: [ScaleLibraryGroup] {
        var groups: [ScaleLibraryGroup] = []
        for scale in ClinicalScales.all {
            let area = Self.area(for: scale.id)
            if let index = groups.firstIndex(where: { $0.area == area }) {
                groups[index].scales.append(scale)
            } else {
                groups.append(ScaleLibraryGroup(area: area, scales: [scale]))
            }
        }
        return groups
    }

    var body: some View {
        VStack(alignment: .leading, spacing: ClinicalChartMetrics.groupSpacing) {
            header
            library
            history
        }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                ClinicalSectionTitle("Scale", systemImage: "checklist", accent: .scale)
                Text("\(ClinicalScales.all.count) disponibili, \(historyItems.count) registrate")
                    .chartMetadata()
            }
            .fixedSize(horizontal: true, vertical: false)
            Spacer(minLength: 8)
            Button(action: onRefresh) {
                Label("Aggiorna", systemImage: "arrow.clockwise")
            }
            .font(.caption)
            .disabled(isWorking || !hasSelectedPatient)
            .accessibilityIdentifier("homebase-refresh-scales-button")
        }
    }

    /// Five scales, each previously carrying two lines of grey explanation: ten
    /// lines of micro-text before the reader reached anything actionable. The
    /// gloss is now one line and the name is the size of a thing you tap, so the
    /// column reads as a list of five choices rather than a wall of prose.
    ///
    /// "Libreria locale" is dropped: the group headings below already say what
    /// each cluster is, and a heading whose only job is to introduce more
    /// headings is a level of nesting the content does not have.
    private var library: some View {
        VStack(alignment: .leading, spacing: ClinicalChartMetrics.groupSpacing) {
            ForEach(libraryGroups) { group in
                VStack(alignment: .leading, spacing: ClinicalChartMetrics.itemSpacing) {
                    Text(group.area)
                        .chartGroupHeading()
                    ForEach(group.scales) { scale in
                        Button {
                            onStartScale(scale)
                        } label: {
                            scaleLibraryRow(scale)
                        }
                        .buttonStyle(.plain)
                        .disabled(isWorking || !hasSelectedPatient)
                        .accessibilityIdentifier("scale-library-row-\(scale.id)")
                    }
                }
            }
        }
    }

    private func scaleLibraryRow(_ scale: ClinicalScaleDefinition) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(scale.title)
                    .chartRowTitle()
                    .foregroundStyle(.primary)
                Text(scale.scaleDescription)
                    .chartMetadata()
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            Spacer(minLength: 8)
            scaleChip("\(scale.questions.count) domande", tone: .info)
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(.rect(cornerRadius: ClinicalChartMetrics.rowRadius))
        .accessibilityLabel("\(scale.title), \(scale.questions.count) domande")
    }

    private var history: some View {
        VStack(alignment: .leading, spacing: ClinicalChartMetrics.itemSpacing) {
            Text("Storico somministrazioni")
                .chartGroupHeading()
            if historyItems.isEmpty {
                Text("Nessuna scala registrata per questo paziente.")
                    .chartMetadata()
            } else {
                ForEach(historyItems) { item in
                    DisclosureGroup {
                        VStack(alignment: .leading, spacing: ClinicalChartMetrics.itemSpacing) {
                            Text(ClinicalContentRendering.attributedString(from: item.content))
                                .chartProse()
                                .foregroundStyle(.primary)
                            if let interpretation = item.interpretation {
                                Text(interpretation)
                                    .chartMetadata()
                            }
                        }
                        .padding(.top, 6)
                    } label: {
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.title)
                                    .chartRowTitle()
                                // @Codex MF085-002: provenance visible before expanding stored interpretation.
                                if let provenance = item.provenanceLabel {
                                    Text(provenance).chartMetadata()
                                }
                                Text(Self.dateFormatter.string(from: item.date))
                                    .chartMetadata()
                            }
                            Spacer(minLength: 8)
                            scaleChip(item.scoreLabel ?? "Punteggio n.d.", tone: item.provenanceLabel == nil ? .positive : .info)
                        }
                    }
                    .accessibilityIdentifier("scale-history-row-\(item.id)")
                }
            }
        }
    }

    private func scaleChip(_ text: String, tone: VetroTone) -> some View {
        let palette = LumePalette.palette(for: colorScheme, isGuardia: isGuardia)
        let toneColor = LumePalette.tint(for: tone, using: palette)
        return Text(text)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(toneColor)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(palette.field, in: Capsule())
            .overlay(Capsule().strokeBorder(toneColor.opacity(0.4), lineWidth: 0.5))
    }

    static func area(for scaleId: String) -> String {
        switch scaleId {
        case ClinicalScales.tinettiPOMA28ID:
            return "Equilibrio"
        case "adl", "iadl":
            return "Autonomia"
        case "mmse":
            return "Cognitivo"
        case "gds":
            return "Umore"
        default:
            return "Valutazione"
        }
    }

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .short
        return formatter
    }()

    private struct ScaleLibraryGroup: Identifiable {
        let area: String
        var scales: [ClinicalScaleDefinition]
        var id: String { area }
    }
}

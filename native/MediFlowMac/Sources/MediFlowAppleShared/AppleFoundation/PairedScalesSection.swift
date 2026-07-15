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
        VStack(alignment: .leading, spacing: 10) {
            header
            library
            Divider()
            history
        }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Label("Scale", systemImage: "checklist")
                    .font(.subheadline.weight(.semibold))
                Text("\(ClinicalScales.all.count) disponibili, \(historyItems.count) registrate")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            Button(action: onRefresh) {
                Label("Aggiorna", systemImage: "arrow.clockwise")
            }
            .font(.caption)
            .disabled(isWorking || !hasSelectedPatient)
            .accessibilityIdentifier("homebase-refresh-scales-button")
        }
    }

    private var library: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Libreria locale", systemImage: "books.vertical")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            ForEach(libraryGroups) { group in
                VStack(alignment: .leading, spacing: 5) {
                    Text(group.area)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                    ForEach(group.scales) { scale in
                        Button {
                            onStartScale(scale)
                        } label: {
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(scale.title)
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(.primary)
                                    Text(scale.scaleDescription)
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(2)
                                }
                                Spacer(minLength: 8)
                                scaleChip("\(scale.questions.count) domande", tone: .info)
                            }
                            .padding(.vertical, 5)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .buttonStyle(.plain)
                        .disabled(isWorking || !hasSelectedPatient)
                        .accessibilityIdentifier("scale-library-row-\(scale.id)")
                    }
                }
            }
        }
    }

    private var history: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Storico somministrazioni", systemImage: "clock")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            if historyItems.isEmpty {
                Text("Nessuna scala registrata per questo paziente.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(historyItems) { item in
                    DisclosureGroup {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(ClinicalContentRendering.attributedString(from: item.content))
                                .font(.caption)
                                .foregroundStyle(.primary)
                            if let interpretation = item.interpretation {
                                Text(interpretation)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding(.top, 4)
                    } label: {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.title)
                                    .font(.caption.weight(.semibold))
                                Text(Self.dateFormatter.string(from: item.date))
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 8)
                            scaleChip(item.scoreLabel ?? "Punteggio n.d.", tone: .positive)
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
        case "tinetti":
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

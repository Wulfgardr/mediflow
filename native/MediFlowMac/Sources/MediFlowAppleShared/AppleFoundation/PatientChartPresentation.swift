import SwiftUI

enum PatientChartFieldValue: Equatable {
    case recorded(String)
    case missing
    case protected

    static func make(_ value: String?, isProtected: Bool = false) -> Self {
        if isProtected { return .protected }
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
            return .missing
        }
        return .recorded(value)
    }
}

enum PatientStructuredFields {
    static func diagnoses(_ raw: String?) -> StructuredFieldRead<[ClinicalDiagnosis]> {
        DiagnosesCodec.decodeResult(raw)
    }

    static func exemptions(_ raw: String?) -> StructuredFieldRead<[String]> {
        ExemptionCodesCodec.decodeResult(raw)
    }

    static func unreadableMessage(_ field: String) -> String {
        "\(field) presenti ma non leggibili su questo dispositivo."
    }
}

enum PatientChartSummaryCategory: String, CaseIterable, Identifiable {
    case therapies, measures, diary, scales

    var id: String { rawValue }

    var title: String {
        switch self {
        case .therapies: "Terapie attive"
        case .measures: "Misure"
        case .diary: "Diario"
        case .scales: "Scale"
        }
    }

    var destination: PatientWorkspaceSection {
        switch self {
        case .therapies: .therapies
        case .measures: .clinical
        case .diary: .diary
        case .scales: .scales
        }
    }

    func accessibilityLabel(count: ClinicalSignalCount) -> String {
        "Apri \(title), \(count.displayText)"
    }
}

#if os(iOS)
struct PatientChartGroup<Content: View>: View {
    let title: String
    private let content: Content

    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.headline)
                .foregroundStyle(.primary)
                .accessibilityAddTraits(.isHeader)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 16)
        .overlay(alignment: .top) { Divider() }
    }
}

struct PatientChartField: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let label: String
    let value: PatientChartFieldValue
    var isCode = false
    var labelIsCode = false

    var body: some View {
        let columns = horizontalSizeClass == .regular && !dynamicTypeSize.isAccessibilitySize
        let layout = columns
            ? AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 16))
            : AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
        layout {
            Text(label)
                .font(labelIsCode ? .system(.subheadline, design: .monospaced) : .subheadline)
                .foregroundStyle(.secondary)
                .frame(width: columns ? 132 : nil, alignment: .leading)
            Group {
                switch value {
                case .recorded(let text):
                    Text(text)
                        .font(isCode ? .system(.body, design: .monospaced) : .body)
                        .foregroundStyle(.primary)
                        .monospacedDigit()
                case .missing:
                    Text("Non registrato").font(.footnote).foregroundStyle(.secondary)
                case .protected:
                    Label("Dato protetto", systemImage: "lock.fill")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}

struct PatientChartProse: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.body)
            .lineSpacing(3)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
#endif

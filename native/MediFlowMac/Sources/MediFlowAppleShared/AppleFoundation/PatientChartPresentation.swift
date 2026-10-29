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

struct PatientChartSummaryReturn: Hashable {
    let patientID: String
    let category: PatientChartSummaryCategory
}

struct PatientChartReadingAnchor: Equatable {
    let id: String
    let distanceFromTop: CGFloat

    func offset(anchorMinY: CGFloat, insetTop: CGFloat) -> CGFloat {
        anchorMinY - distanceFromTop - insetTop
    }
}

enum PatientChartDisclosure: String, CaseIterable {
    case aiTools, contents, patientInsightDetails, smartImportDetails
}

struct PatientChartReturnState {
    private var pending: [String: PatientChartSummaryCategory] = [:]
    private var positions: [String: PatientChartReadingAnchor] = [:]
    private var disclosures: [String: Set<PatientChartDisclosure>] = [:]

    mutating func record(_ anchor: PatientChartReadingAnchor, patientID: String) { positions[patientID] = anchor }
    func position(patientID: String) -> PatientChartReadingAnchor? { positions[patientID] }

    func isExpanded(_ disclosure: PatientChartDisclosure, patientID: String) -> Bool {
        disclosures[patientID, default: []].contains(disclosure)
    }
    mutating func setExpanded(_ expanded: Bool, disclosure: PatientChartDisclosure, patientID: String) {
        if expanded { disclosures[patientID, default: []].insert(disclosure) }
        else { disclosures[patientID, default: []].remove(disclosure) }
    }
    mutating func leave(patientID: String, category: PatientChartSummaryCategory) { pending[patientID] = category }
    mutating func returnToChart(patientID: String) -> PatientChartSummaryReturn? {
        pending.removeValue(forKey: patientID).map { PatientChartSummaryReturn(patientID: patientID, category: $0) }
    }
}

#if os(iOS)
struct PatientChartGroup<Content: View>: View {
    @Environment(\.patientChartScrollMemory) private var scrollMemory
    @Environment(\.patientChartPatientID) private var patientID
    let title: String
    let anchorID: String
    private let content: Content

    init(_ title: String, anchorID: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.anchorID = anchorID ?? "patient-group-\(title)"
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
        .background {
            if let scrollMemory, let patientID {
                PatientChartScrollAnchor(patientID: patientID, id: anchorID, memory: scrollMemory)
            }
        }
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

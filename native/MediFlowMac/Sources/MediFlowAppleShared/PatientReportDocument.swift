import CoreGraphics
import CoreText
import Foundation
#if os(macOS)
import AppKit
#else
import UIKit
#endif

#if os(macOS)
private typealias ReportFont = NSFont
private typealias ReportColor = NSColor
#else
private typealias ReportFont = UIFont
private typealias ReportColor = UIColor
#endif

/* @Codex */
public struct PatientReportContent: Equatable, Sendable {
    public let title: String
    public let generatedLabel: String
    public let headerRows: [PatientReportLine]
    public let sections: [PatientReportSection]
    public let fileName: String

    public var plainText: String {
        var lines = [title, generatedLabel, ""]
        lines.append(contentsOf: headerRows.flatMap(\.textLines))
        for section in sections {
            lines.append("")
            lines.append(section.title)
            if section.rows.isEmpty {
                lines.append(section.emptyMessage)
            } else {
                lines.append(contentsOf: section.rows.flatMap(\.textLines))
            }
        }
        return lines.joined(separator: "\n")
    }
}

/* @Codex */
public struct PatientReportSection: Equatable, Sendable {
    public let title: String
    public let rows: [PatientReportLine]
    public let emptyMessage: String
}

/* @Codex */
public struct PatientReportLine: Equatable, Sendable {
    public let primary: String
    public let details: [String]

    public init(primary: String, details: [String] = []) {
        self.primary = primary
        self.details = details
    }

    public var textLines: [String] {
        ["- \(primary)"] + details.map { "  \(String($0.prefix(2_000)))" }
    }
}

/* @Codex */
public enum PatientReportDocument {
    public static func build(
        patient: HomeBasePatientDetail,
        entries: [HomeBaseEntrySummary],
        therapies: [HomeBaseTherapySummary],
        checkups: [HomeBaseCheckupSummary],
        observations: [HomeBaseObservationSummary],
        generatedAt: Date,
        referenceDate: Date = Date()
    ) -> PatientReportContent {
        let generatedLabel = "Generato: \(dateTimeLabel(generatedAt))"
        let patientName = [safe(patient.lastName), safe(patient.firstName)]
            .compactMap { $0 }
            .joined(separator: " ")
            .trimmedOrNil ?? "Paziente"

        let headerRows = [
            PatientReportLine(primary: "Nome: \(patientName)"),
            PatientReportLine(primary: "Data di nascita: \(safeDate(patient.birthDate) ?? "Non registrata")"),
            PatientReportLine(primary: "Codice fiscale: \(safe(patient.taxCode) ?? "Non disponibile")"),
            PatientReportLine(primary: "Ambulatorio: \(safe(patient.ambulatoryId) ?? "Non registrato")"),
        ]

        let sections = [
            PatientReportSection(
                title: "Diagnosi ICD",
                rows: diagnosisRows(from: patient.diagnoses),
                emptyMessage: "Nessuna diagnosi registrata."
            ),
            PatientReportSection(
                title: "Esenzioni",
                rows: ExemptionCodesCodec.decode(patient.exemptions)
                    .compactMap { safe($0).map { PatientReportLine(primary: $0) } },
                emptyMessage: "Nessuna esenzione registrata."
            ),
            PatientReportSection(
                title: "Terapie in corso",
                rows: therapyRows(from: therapies),
                emptyMessage: "Nessuna terapia in corso registrata."
            ),
            PatientReportSection(
                title: "Ultime voci diario",
                rows: diaryRows(from: entries),
                emptyMessage: "Nessuna voce diario registrata."
            ),
            PatientReportSection(
                title: "Valutazioni recenti",
                rows: scaleRows(from: entries),
                emptyMessage: "Nessuna valutazione registrata."
            ),
            PatientReportSection(
                title: "Controlli programmati",
                rows: checkupRows(from: checkups, referenceDate: referenceDate),
                emptyMessage: "Nessun controllo programmato."
            ),
            PatientReportSection(
                title: "Osservazioni recenti",
                rows: observationRows(from: observations),
                emptyMessage: "Nessuna osservazione registrata."
            ),
        ]

        return PatientReportContent(
            title: "Report PDF paziente",
            generatedLabel: generatedLabel,
            headerRows: headerRows,
            sections: sections,
            fileName: fileName(patient: patient, generatedAt: generatedAt)
        )
    }

    public static func fileName(patient: HomeBasePatientDetail, generatedAt: Date) -> String {
        let date = fileDateFormatter.string(from: generatedAt)
        let surname = safe(patient.lastName).flatMap(slug)
        return ([["report-paziente"], surname.map { [$0] } ?? [], [date]].flatMap { $0 }.joined(separator: "-")) + ".pdf"
    }

    public static func plainText(fromClinicalMarkup content: String) -> String {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }
        guard !containsCiphertext(trimmed) else { return "" }

        #if os(macOS) || os(iOS)
        let htmlLike = trimmed.localizedCaseInsensitiveContains("<")
        if htmlLike, let data = trimmed.data(using: .utf8) {
            let options: [NSAttributedString.DocumentReadingOptionKey: Any] = [
                .documentType: NSAttributedString.DocumentType.html,
                .characterEncoding: String.Encoding.utf8.rawValue,
            ]
            if let rendered = try? NSAttributedString(data: data, options: options, documentAttributes: nil) {
                let text = normalizeWhitespace(rendered.string)
                if !text.isEmpty { return text }
            }
        }
        #endif

        return normalizeWhitespace(strippingTagsAndEntities(from: trimmed))
    }

    private static func diagnosisRows(from raw: String?) -> [PatientReportLine] {
        DiagnosesCodec.decode(raw).compactMap { diagnosis in
            let code = safe(diagnosis.code)
            let description = safe(diagnosis.description)
            guard code != nil || description != nil else { return nil }
            let system = safe(diagnosis.system) ?? "ICD"
            let primary = [code, description].compactMap { $0 }.joined(separator: " - ")
            var details = ["Sistema: \(system)"]
            if let date = safe(diagnosis.date) { details.append("Data: \(date)") }
            return PatientReportLine(primary: primary, details: details)
        }
    }

    private static func therapyRows(from therapies: [HomeBaseTherapySummary]) -> [PatientReportLine] {
        therapies
            .filter { $0.deletedAt == nil && $0.status == "active" }
            .sorted { $0.drugName.localizedCaseInsensitiveCompare($1.drugName) == .orderedAscending }
            .compactMap { therapy in
                guard let drugName = safe(therapy.drugName) else { return nil }
                var details: [String] = []
                if let principle = safe(therapy.activePrinciple) { details.append("Principio attivo: \(principle)") }
                if let dosage = safe(therapy.dosage) { details.append("Posologia: \(dosage)") }
                if let aic = safe(therapy.aic) { details.append("AIC: \(aic)") }
                if let atc = safe(therapy.atc) { details.append("ATC: \(atc)") }
                if let diagnosisCode = safe(therapy.diagnosisCode) { details.append("Diagnosi collegata: \(diagnosisCode)") }
                if let motivation = safe(therapy.motivation) { details.append("Note: \(motivation)") }
                return PatientReportLine(primary: drugName, details: details)
            }
    }

    private static func diaryRows(from entries: [HomeBaseEntrySummary]) -> [PatientReportLine] {
        entries
            .filter { $0.deletedAt == nil && $0.type != "scale" }
            .sorted { $0.date > $1.date }
            .compactMap { entry in
                let title = safe(entry.title) ?? "Voce diario"
                let content = safe(plainText(fromClinicalMarkup: entry.content))
                var details = ["Data: \(dateTimeLabel(entry.date))"]
                if let type = safe(entry.type) { details.append("Tipo: \(type)") }
                if let content { details.append(content) }
                return PatientReportLine(primary: title, details: details)
            }
    }

    private static func scaleRows(from entries: [HomeBaseEntrySummary]) -> [PatientReportLine] {
        ScaleHistoryPresentation.items(from: entries).compactMap { item in
            guard let title = safe(item.title) else { return nil }
            var details = ["Data: \(dateTimeLabel(item.date))"]
            if let score = safe(item.scoreLabel) { details.append("Punteggio: \(score)") }
            if let interpretation = safe(item.interpretation) { details.append("Interpretazione: \(interpretation)") }
            return PatientReportLine(primary: title, details: details)
        }
    }

    private static func checkupRows(from checkups: [HomeBaseCheckupSummary], referenceDate: Date) -> [PatientReportLine] {
        checkups
            .filter { $0.deletedAt == nil && $0.status == "pending" && $0.date >= referenceDate }
            .sorted { $0.date < $1.date }
            .compactMap { checkup in
                guard let title = safe(checkup.title) else { return nil }
                var details = ["Data: \(dateTimeLabel(checkup.date))"]
                if let notes = safe(checkup.notes) { details.append(notes) }
                return PatientReportLine(primary: title, details: details)
            }
    }

    private static func observationRows(from observations: [HomeBaseObservationSummary]) -> [PatientReportLine] {
        observations
            .filter { $0.deletedAt == nil }
            .sorted { $0.observedAt > $1.observedAt }
            .compactMap { observation in
                guard let display = safe(observation.display) else { return nil }
                var details = ["Data: \(dateTimeLabel(observation.observedAt))"]
                let valueUnit = [safe(observation.value), safe(observation.unitCode)].compactMap { $0 }.joined(separator: " ")
                if !valueUnit.isEmpty { details.append("Valore: \(valueUnit)") }
                if let code = safe(observation.code) { details.append("Codice: \(code)") }
                if let notes = safe(observation.notes) { details.append(notes) }
                return PatientReportLine(primary: display, details: details)
            }
    }

    private static func safe(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
            return nil
        }
        guard !containsCiphertext(trimmed) else { return nil }
        return trimmed
    }

    private static func safeDate(_ date: Date?) -> String? {
        date.map(dateOnlyLabel)
    }

    private static func containsCiphertext(_ value: String) -> Bool {
        value.range(of: #"(^|\s)ENC:[A-Za-z0-9+/=_-]+:"#, options: .regularExpression) != nil
            || value.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("ENC:")
    }

    private static func slug(_ value: String) -> String? {
        let folded = value.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "it_IT"))
        let allowed = folded.unicodeScalars.map { scalar -> String in
            CharacterSet.alphanumerics.contains(scalar) ? String(scalar).lowercased() : "-"
        }
        let collapsed = allowed.joined()
            .replacingOccurrences(of: #"-+"#, with: "-", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return collapsed.trimmedOrNil
    }

    private static func strippingTagsAndEntities(from content: String) -> String {
        content
            .replacingOccurrences(of: #"(?i)<br\s*/?>"#, with: "\n", options: .regularExpression)
            .replacingOccurrences(of: #"(?i)</p\s*>"#, with: "\n", options: .regularExpression)
            .replacingOccurrences(of: #"(?i)</li\s*>"#, with: "\n", options: .regularExpression)
            .replacingOccurrences(of: #"<[^>]+>"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: "&nbsp;", with: " ")
            .replacingOccurrences(of: "&amp;", with: "&")
            .replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
    }

    private static func normalizeWhitespace(_ value: String) -> String {
        value
            .split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: "\n")
            .trimmedOrNil ?? ""
    }

    private static func dateOnlyLabel(_ date: Date) -> String {
        dateOnlyFormatter.string(from: date)
    }

    private static func dateTimeLabel(_ date: Date) -> String {
        dateTimeFormatter.string(from: date)
    }

    private static let dateOnlyFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "it_IT")
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter
    }()

    private static let dateTimeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "it_IT")
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter
    }()

    private static let fileDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()
}

/* @Codex */
public enum PatientReportPDFRenderer {
    public static func render(_ content: PatientReportContent, to directory: URL = FileManager.default.temporaryDirectory) throws -> URL {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent(content.fileName)
        if FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: url)
        }
        try writePDF(content, to: url)
        return url
    }

    private static func writePDF(_ content: PatientReportContent, to url: URL) throws {
        guard let consumer = CGDataConsumer(url: url as CFURL) else {
            throw PatientReportPDFError.cannotCreateFile
        }

        var mediaBox = CGRect(x: 0, y: 0, width: 595.2, height: 841.8)
        guard let context = CGContext(consumer: consumer, mediaBox: &mediaBox, nil) else {
            throw PatientReportPDFError.cannotCreateContext
        }

        let attributed = attributedText(for: content)
        let framesetter = CTFramesetterCreateWithAttributedString(attributed)
        let textRect = CGRect(x: 48, y: 54, width: mediaBox.width - 96, height: mediaBox.height - 108)
        var current = 0
        let total = attributed.length

        repeat {
            context.beginPDFPage(nil)
            context.saveGState()
            context.textMatrix = .identity
            context.translateBy(x: 0, y: mediaBox.height)
            context.scaleBy(x: 1, y: -1)

            let path = CGPath(rect: textRect, transform: nil)
            let frame = CTFramesetterCreateFrame(framesetter, CFRange(location: current, length: total - current), path, nil)
            CTFrameDraw(frame, context)
            let visible = CTFrameGetVisibleStringRange(frame)
            current += visible.length

            context.restoreGState()
            context.endPDFPage()
        } while current < total

        context.closePDF()
    }

    private static func attributedText(for content: PatientReportContent) -> NSAttributedString {
        let result = NSMutableAttributedString()
        append(content.title, to: result, style: .title)
        append(content.generatedLabel, to: result, style: .muted)
        append("", to: result, style: .body)
        for row in content.headerRows {
            append(row.primary, to: result, style: .body)
        }

        for section in content.sections {
            append("", to: result, style: .body)
            append(section.title, to: result, style: .section)
            let rows = section.rows.isEmpty ? [PatientReportLine(primary: section.emptyMessage)] : section.rows
            for row in rows {
                append(row.primary, to: result, style: .rowTitle)
                for detail in row.details {
                    append(detail, to: result, style: .body, indent: 14)
                }
            }
        }
        return result
    }

    private enum TextStyle {
        case title
        case section
        case rowTitle
        case body
        case muted
    }

    private static func append(_ text: String, to result: NSMutableAttributedString, style: TextStyle, indent: CGFloat = 0) {
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineSpacing = 3
        paragraph.paragraphSpacing = style == .section ? 7 : 3
        paragraph.firstLineHeadIndent = indent
        paragraph.headIndent = indent
        let attributes: [NSAttributedString.Key: Any] = [
            .font: font(for: style),
            .foregroundColor: color(for: style),
            .paragraphStyle: paragraph,
        ]
        result.append(NSAttributedString(string: text + "\n", attributes: attributes))
    }

    private static func font(for style: TextStyle) -> ReportFont {
        switch style {
        case .title:
            return ReportFont.systemFont(ofSize: 20, weight: .bold)
        case .section:
            return ReportFont.systemFont(ofSize: 13, weight: .bold)
        case .rowTitle:
            return ReportFont.systemFont(ofSize: 10.5, weight: .semibold)
        case .body, .muted:
            return ReportFont.systemFont(ofSize: 10, weight: .regular)
        }
    }

    private static func color(for style: TextStyle) -> ReportColor {
        switch style {
        case .title:
            return .black
        case .section:
            return ReportColor(red: 0.12, green: 0.25, blue: 0.47, alpha: 1)
        case .rowTitle, .body:
            return ReportColor(red: 0.12, green: 0.12, blue: 0.12, alpha: 1)
        case .muted:
            return ReportColor(red: 0.42, green: 0.42, blue: 0.42, alpha: 1)
        }
    }
}

/* @Codex */
public enum PatientReportPDFError: Error, Equatable {
    case cannotCreateFile
    case cannotCreateContext
}

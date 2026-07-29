import Foundation
#if canImport(AppKit)
import AppKit
#elseif canImport(UIKit)
import UIKit
#endif

/* @Codex */
public enum ClinicalContentRendering {
    private static let supportedHTMLMarkers = [
        "<p", "</p", "<br", "<strong", "</strong", "<b", "</b", "<em", "</em",
        "<i", "</i", "<u", "</u", "<s", "</s", "<ul", "</ul", "<ol", "</ol",
        "<li", "</li", "<h1", "</h1", "<h2", "</h2", "<h3", "</h3", "<blockquote", "</blockquote"
    ]

    @MainActor
    public static func attributedString(from content: String) -> AttributedString {
        guard containsSupportedHTMLMarkup(content), hasBalancedAngleBrackets(content) else {
            return AttributedString(content)
        }

        #if canImport(AppKit) || canImport(UIKit)
        guard let data = content.data(using: .utf8) else { return AttributedString(content) }
        let options: [NSAttributedString.DocumentReadingOptionKey: Any] = [
            .documentType: NSAttributedString.DocumentType.html,
            .characterEncoding: String.Encoding.utf8.rawValue,
        ]
        guard let rendered = try? NSAttributedString(data: data, options: options, documentAttributes: nil),
              !rendered.string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return AttributedString(content)
        }
        return AttributedString(rendered)
        #else
        return AttributedString(content)
        #endif
    }

    public static func containsSupportedHTMLMarkup(_ content: String) -> Bool {
        let lowercased = content.lowercased()
        return supportedHTMLMarkers.contains { lowercased.contains($0) }
    }

    public static func hasBalancedAngleBrackets(_ content: String) -> Bool {
        content.filter { $0 == "<" }.count == content.filter { $0 == ">" }.count
    }
}

/* @Codex */
/// The four S/O/A/P headings, and nothing else.
///
/// This used to insert a gloss beside each letter — "S: motivo della visita,
/// sintomi riferiti, contesto funzionale" and three more like it. That is not a
/// template, it is filler: the clinician has to delete four lines of prose
/// before writing the first real word, and any line left undeleted is saved
/// into the clinical record as though a clinician had written it. A note that
/// says "valutazione clinica da rivedere" under A is worse than an empty A,
/// because it looks like an assessment.
///
/// A template supplies structure. What goes under each heading is the
/// clinician's to write, and the app has no business guessing it.
public enum ClinicalSOAPTemplate {
    public static let html = [
        "<p>S:</p>",
        "<p>O:</p>",
        "<p>A:</p>",
        "<p>P:</p>",
    ].joined()
}

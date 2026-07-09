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
public enum ClinicalSOAPTemplate {
    public static let html = [
        "<p>S: motivo della visita, sintomi riferiti, contesto funzionale</p>",
        "<p>O: parametri, esame obiettivo, elementi documentali</p>",
        "<p>A: valutazione clinica da rivedere</p>",
        "<p>P: piano, follow-up, indicazioni condivise</p>",
    ].joined()
}

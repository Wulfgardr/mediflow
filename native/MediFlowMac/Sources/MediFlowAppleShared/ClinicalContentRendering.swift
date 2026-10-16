import Foundation
import SwiftUI
import MediFlowCore
#if canImport(AppKit)
import AppKit
#elseif canImport(UIKit)
import UIKit
#endif

public enum ClinicalContentRendering {
    public enum ForegroundStyle: Equatable, Sendable {
        case primary, secondary
    }

    private static let supportedHTMLMarkers = [
        "<p", "</p", "<br", "<strong", "</strong", "<b", "</b", "<em", "</em",
        "<i", "</i", "<u", "</u", "<s", "</s", "<ul", "</ul", "<ol", "</ol",
        "<li", "</li", "<h1", "</h1", "<h2", "</h2", "<h3", "</h3", "<blockquote", "</blockquote"
    ]

    @MainActor
    public static func attributedString(from content: String) -> AttributedString {
        AttributedString(nativeAttributedString(from: content))
    }

    @MainActor
    public static func nativeAttributedString(
        from content: String, foregroundStyle: ForegroundStyle = .primary
    ) -> NSAttributedString {
        #if canImport(AppKit) || canImport(UIKit)
        let options: [NSAttributedString.DocumentReadingOptionKey: Any] = [
            .documentType: NSAttributedString.DocumentType.html,
            .characterEncoding: String.Encoding.utf8.rawValue,
        ]
        let rendered: NSAttributedString
        if containsSupportedHTMLMarkup(content), hasBalancedAngleBrackets(content),
           let data = content.data(using: .utf8),
           let imported = try? NSAttributedString(data: data, options: options, documentAttributes: nil),
           !imported.string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            rendered = imported
        } else {
            rendered = NSAttributedString(string: content)
        }
        // Imported HTML carries its own default font; replace only presentation
        // attributes so narrative follows the same local face as plain prose.
        _ = LumeTypography.voice(17)
        let styled = NSMutableAttributedString(attributedString: rendered)
        styled.enumerateAttribute(.font, in: NSRange(location: 0, length: styled.length)) { value, range, _ in
            #if canImport(AppKit)
            let original = value as? NSFont
            let base = NSFont.systemFont(ofSize: 13.5)
            let traits = original?.fontDescriptor.symbolicTraits ?? []
            let font = NSFont(descriptor: base.fontDescriptor.withSymbolicTraits(traits), size: 13.5) ?? base
            let color = foregroundStyle == .secondary ? NSColor.secondaryLabelColor : NSColor.labelColor
            styled.addAttributes([.font: font, .foregroundColor: color], range: range)
            #elseif canImport(UIKit)
            let original = value as? UIFont
            let base = UIFontMetrics(forTextStyle: .body).scaledFont(for: UIFont(name: "Newsreader16pt-Regular", size: 17) ?? UIFont.systemFont(ofSize: 17))
            let traits = original?.fontDescriptor.symbolicTraits ?? []
            let font = UIFont(descriptor: base.fontDescriptor.withSymbolicTraits(traits) ?? base.fontDescriptor, size: base.pointSize)
            let color = foregroundStyle == .secondary ? UIColor.secondaryLabel : UIColor.label
            styled.addAttributes([.font: font, .foregroundColor: color], range: range)
            #endif
        }
        styled.enumerateAttribute(.paragraphStyle, in: NSRange(location: 0, length: styled.length)) { value, range, _ in
            let paragraph = (value as? NSParagraphStyle)?.mutableCopy() as? NSMutableParagraphStyle ?? NSMutableParagraphStyle()
            #if canImport(AppKit)
            paragraph.lineSpacing = 3
            #else
            paragraph.lineSpacing = 5
            #endif
            styled.addAttribute(.paragraphStyle, value: paragraph, range: range)
        }
        let quoteDepths = ClinicalRichTextEditorDocument.load(html: content).blocks.map { block in
            block.containers.filter { if case .blockquote = $0 { return true }; return false }.count
        }
        let text = styled.string as NSString
        var paragraphs: [NSRange] = []
        var cursor = 0
        while cursor < text.length {
            let range = text.paragraphRange(for: NSRange(location: cursor, length: 0))
            paragraphs.append(range)
            cursor = NSMaxRange(range)
        }
        if paragraphs.count == quoteDepths.count {
            for (range, depth) in zip(paragraphs, quoteDepths) where depth > 0 {
                guard let paragraph = (styled.attribute(.paragraphStyle, at: range.location, effectiveRange: nil) as? NSParagraphStyle)?.mutableCopy() as? NSMutableParagraphStyle else { continue }
                let indent = CGFloat(depth) * 20
                paragraph.firstLineHeadIndent += indent
                paragraph.headIndent += indent
                paragraph.tabStops = paragraph.tabStops.map {
                    NSTextTab(textAlignment: $0.alignment, location: $0.location + indent, options: $0.options)
                }
                styled.addAttribute(.paragraphStyle, value: paragraph, range: range)
            }
        }
        return styled
        #else
        return NSAttributedString(string: content)
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

public struct ClinicalContentText: View {
    private let content: String
    private let foregroundStyle: ClinicalContentRendering.ForegroundStyle

    public init(_ content: String, foregroundStyle: ClinicalContentRendering.ForegroundStyle = .primary) {
        self.content = content
        self.foregroundStyle = foregroundStyle
    }

    public var body: some View {
        ClinicalContentPlatformText(content: ClinicalContentRendering.nativeAttributedString(
            from: content, foregroundStyle: foregroundStyle
        ))
    }
}

#if canImport(AppKit)
struct ClinicalContentPlatformText: NSViewRepresentable {
    let content: NSAttributedString

    func makeNSView(context: Context) -> ClinicalContentNativeTextView {
        ClinicalContentNativeTextView()
    }

    func updateNSView(_ view: ClinicalContentNativeTextView, context: Context) {
        view.setContent(content)
    }

    func sizeThatFits(_ proposal: ProposedViewSize, nsView: ClinicalContentNativeTextView, context: Context) -> CGSize? {
        guard let width = proposal.width, width > 0 else { return nil }
        return nsView.fittingSize(for: width)
    }
}

final class ClinicalContentNativeTextView: NSTextView {
    init() {
        let storage = NSTextStorage()
        let manager = NSLayoutManager()
        let container = NSTextContainer(size: .zero)
        storage.addLayoutManager(manager)
        manager.addTextContainer(container)
        super.init(frame: .zero, textContainer: container)
        isEditable = false
        isSelectable = true
        isRichText = true
        drawsBackground = false
        textContainerInset = .zero
        textContainer?.lineFragmentPadding = 0
        textContainer?.widthTracksTextView = false
        isHorizontallyResizable = false
        isVerticallyResizable = true
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func setContent(_ content: NSAttributedString) {
        guard textStorage?.isEqual(to: content) != true else { return }
        textStorage?.setAttributedString(content)
        invalidateIntrinsicContentSize()
    }

    func fittingSize(for width: CGFloat) -> CGSize {
        guard let textContainer, let layoutManager else { return .zero }
        textContainer.containerSize = NSSize(width: width, height: .greatestFiniteMagnitude)
        layoutManager.ensureLayout(for: textContainer)
        return CGSize(width: width, height: ceil(layoutManager.usedRect(for: textContainer).height))
    }
}
#elseif canImport(UIKit)
struct ClinicalContentPlatformText: UIViewRepresentable {
    let content: NSAttributedString

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.isEditable = false
        view.isSelectable = true
        view.isScrollEnabled = false
        view.backgroundColor = .clear
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.adjustsFontForContentSizeCategory = true
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        if view.attributedText?.isEqual(to: content) != true {
            view.attributedText = content
        }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        guard let width = proposal.width, width > 0 else { return nil }
        return uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
    }
}
#endif

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

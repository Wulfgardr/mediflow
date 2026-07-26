import SwiftUI

/// The chart's geometry, in one place.
///
/// Apple's new design system asks nested shapes to be *concentric*: an element
/// sitting inside a rounded container rounds at the container's radius minus the
/// inset between them. Get it wrong and the inner box reads as pasted onto the
/// card instead of resting inside it — which is exactly what the same radius on
/// both produced here.
///
/// Keeping the numbers together is the point: they are one relationship, not a
/// handful of constants, and edited apart they drift out of concentricity
/// silently.
///
/// Cross-platform on purpose. This started life behind `#if os(macOS)`, and the
/// result was that only the Mac ever got a hierarchy: every iOS section stayed a
/// flat run of `.caption` and `.caption2`, where a scale's name was set one
/// point larger than the word classifying it. The relationships below are the
/// same on both platforms; only the absolute sizes differ, because macOS sets
/// its whole interface smaller.
enum ClinicalChartMetrics {
    /// The card. Larger than the previous 14: a wide clinical card carries a
    /// generous corner better, and it leaves room for a real inner radius.
    static let cardRadius: CGFloat = 22

    /// The inset from the card edge to its content.
    static let cardPadding: CGFloat = 16

    /// Concentric by construction. Never hand-written at a call site.
    static var innerRadius: CGFloat { max(cardRadius - cardPadding, 4) }

    /// Row corners inside a list, where the inset is smaller.
    static let rowRadius: CGFloat = 12

    /// An input's corner.
    ///
    /// Text fields were drawing the system's rectangle with barely any corner at
    /// all, next to cards at 22 and pills that are fully round — three different
    /// languages down one column. A single-line input is the same kind of object
    /// as a pill, so it takes the pill's curvature: `Capsule` for one line,
    /// and a continuous radius of this size where the content can wrap and a
    /// capsule would bow around several lines of text.
    static let fieldRadius: CGFloat = 14

    /// Between one group of the chart and the next.
    ///
    /// The card used 8 between groups and 4 inside them. At that ratio proximity
    /// carries no information: a heading sits as close to the previous group's
    /// last line as to its own content, so the eye reads one undifferentiated
    /// column instead of a composed page. Grouping is done by space before it is
    /// done by anything else.
    static let groupSpacing: CGFloat = 20

    /// Between lines that belong together.
    static let itemSpacing: CGFloat = 8

    /// Between one section card and the next.
    #if os(macOS)
    static let sectionSpacing: CGFloat = 16
    #else
    static let sectionSpacing: CGFloat = 14
    #endif
}

/// The chart speaks in four registers, and the difference between them is the
/// hierarchy. Flattened into one — card titles, group headings, row titles and
/// clinical statements all within a point of each other — the card says
/// everything at the same volume and the reader has to do the sorting.
///
/// Reading order, loudest first: card title, then row title and prose at the
/// same weight of attention, with group headings as quiet signposts between
/// them and field labels quieter still. A group heading is deliberately
/// *smaller* than the rows it introduces: uppercase, tracked and secondary, it
/// reads as a label rather than as content, which is the same arrangement iOS
/// uses for grouped lists.
extension View {
    /// Names a card. The loudest thing inside it, and the only thing at this
    /// size, so the eye can find the section boundaries by scanning alone.
    func chartCardTitle() -> some View {
        #if os(macOS)
        font(.subheadline.weight(.semibold))
        #else
        font(.headline)
        #endif
    }

    /// A group heading. Deliberately unlike a field label: a field label is
    /// quiet supporting text, a heading opens a section.
    func chartGroupHeading() -> some View {
        font(.caption.weight(.semibold))
            .textCase(.uppercase)
            .tracking(0.6)
            .foregroundStyle(.secondary)
            .accessibilityAddTraits(.isHeader)
    }

    /// The name of a thing in a list: a scale, a therapy, a document. This is
    /// what the reader is scanning for, and at `.caption` it was the same size
    /// as the metadata underneath it.
    func chartRowTitle() -> some View {
        #if os(macOS)
        font(.callout.weight(.medium))
        #else
        font(.subheadline.weight(.semibold))
        #endif
    }

    /// Prose: clinical narrative, summaries, notes. Given room to breathe,
    /// because it is read as sentences rather than scanned as fields.
    func chartProse() -> some View {
        font(.callout)
            .lineSpacing(2)
            .fixedSize(horizontal: false, vertical: true)
    }

    /// Supporting text under a row: a date, a code, a one-line gloss. Quiet by
    /// design, and the only register that stays this small.
    func chartMetadata() -> some View {
        font(.caption)
            .foregroundStyle(.secondary)
    }

}

/// A named group inside a card: a heading, then the content it introduces.
///
/// Written out at each call site this shape drifted — some groups used 2 points
/// of internal spacing and some 4, some headings carried an icon and some did
/// not, and the two platforms disagreed about the heading's register. One type
/// makes a group one decision.
struct ChartGroup<Content: View>: View {
    private let title: String
    private let systemImage: String?
    private let content: Content

    init(_ title: String, systemImage: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.systemImage = systemImage
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: ClinicalChartMetrics.itemSpacing) {
            Group {
                if let systemImage {
                    Label(title, systemImage: systemImage)
                } else {
                    Text(title)
                }
            }
            .chartGroupHeading()
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

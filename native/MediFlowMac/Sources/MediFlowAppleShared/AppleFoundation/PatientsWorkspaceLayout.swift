import CoreGraphics

/// Layout rule for the patients workspace on iPhone and iPad.
///
/// The arrangement is decided by the width the container actually offers, never
/// by the device name or by the size class alone. A regular size class says
/// "not a phone"; it does not say how much room the workspace got, and on iPad
/// the same app runs at continuously varying widths. Both column floors below
/// are content requirements, not device metrics: the list needs enough room for
/// a patient identity line, and the chart needs enough room for clinical rows
/// that must not truncate.
enum PatientsWorkspaceLayout {
    /// Narrowest list column that still fits the identity line, the scope filter
    /// and the diagnosis summary without truncating them.
    static let minimumListWidth: CGFloat = 320
    /// Widest useful list column: past this the list is just whitespace.
    static let maximumListWidth: CGFloat = 420
    /// Share of the container the list takes between the two floors.
    static let listWidthFraction: CGFloat = 0.42
    /// Narrowest chart column that renders clinical rows without truncating them.
    /// Below this the side-by-side arrangement costs more than it gives.
    static let minimumDetailWidth: CGFloat = 420

    /// Width for the list column inside a container of `containerWidth`.
    static func listWidth(forContainerWidth containerWidth: CGFloat) -> CGFloat {
        let proportional = containerWidth * listWidthFraction
        return min(maximumListWidth, max(minimumListWidth, proportional))
    }

    /// Width left for the chart column once the list and the divider are placed.
    static func detailWidth(forContainerWidth containerWidth: CGFloat) -> CGFloat {
        containerWidth - listWidth(forContainerWidth: containerWidth) - dividerWidth
    }

    static let dividerWidth: CGFloat = 1

    /// Whether list and chart can sit side by side in `containerWidth`.
    ///
    /// Accessibility text sizes always collapse to one column: two columns of
    /// accessibility-sized clinical text are two truncated columns.
    static func usesSideBySide(containerWidth: CGFloat, isAccessibilitySize: Bool) -> Bool {
        guard !isAccessibilitySize else { return false }
        guard containerWidth.isFinite, containerWidth > 0 else { return false }
        return detailWidth(forContainerWidth: containerWidth) >= minimumDetailWidth
    }
}

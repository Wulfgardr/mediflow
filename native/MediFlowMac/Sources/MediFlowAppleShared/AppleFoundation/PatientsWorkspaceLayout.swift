import CoreGraphics

/// Patient-local navigation only. These values are not API routes or capability keys.
enum PatientWorkspaceSection: String, CaseIterable, Identifiable {
    case overview, diary, scales, therapies, clinical, prescriptions, documents

    var id: String { rawValue }

    var title: String {
        switch self {
        case .overview: "Scheda"
        case .diary: "Diario clinico"
        case .scales: "Scale cliniche"
        case .therapies: "Terapie"
        case .clinical: "Controlli e osservazioni"
        case .prescriptions: "Prescrizioni"
        case .documents: "Documenti"
        }
    }

    var symbolName: String {
        switch self {
        case .overview: "person.text.rectangle"
        case .diary: "list.bullet.clipboard"
        case .scales: "list.clipboard"
        case .therapies: "pills"
        case .clinical: "heart.text.square"
        case .prescriptions: "doc.text"
        case .documents: "paperclip"
        }
    }
}

/// Content budgets for the native patient split, independent of device identity.
/// NavigationSplitView owns the actual columns and system separation; these
/// floors decide when the workspace should request a single clinical plane.
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

    /// Minimum separation budget; not a hinge measurement or system divider frame.
    static let dividerWidth: CGFloat = 1

    /// Whether list and chart can sit side by side in `containerWidth`.
    ///
    /// Accessibility text sizes always collapse to one column: two columns of
    /// accessibility-sized clinical text are two truncated columns.
    static func usesSideBySide(
        containerWidth: CGFloat,
        isAccessibilitySize: Bool,
        isCompactHeight: Bool = false
    ) -> Bool {
        // A wide, short viewport still needs one full clinical column.
        // Size class describes available height here, never device identity.
        guard !isAccessibilitySize, !isCompactHeight else { return false }
        guard containerWidth.isFinite, containerWidth > 0 else { return false }
        return detailWidth(forContainerWidth: containerWidth) >= minimumDetailWidth
    }
}

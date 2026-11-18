import AppKit

@MainActor
final class VisitConfirmationPanel: NSObject, NSWindowDelegate {
    private let authentication = VisitAuthentication()
    private let window = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 640, height: 530),
                                 styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
    private var continuation: CheckedContinuation<VisitAuthenticationPolicy?, Never>?
    private lazy var confirm = NSButton(title: "Conferma la visita", target: self, action: #selector(approve))

    private lazy var password = NSButton(title: "Usa la password del Mac", target: self, action: #selector(approveUsingPassword))

    init(_ presentation: VisitConfirmationPresentation) {
        super.init()
        window.title = "MediFlow"
        window.delegate = self
        window.minSize = NSSize(width: 500, height: 340)
        window.becomesKeyOnlyIfNeeded = false

        let heading = NSTextField(labelWithString: presentation.patient)
        heading.font = .systemFont(ofSize: 21, weight: .semibold)
        let fiscalCode = NSTextField(labelWithString: presentation.fiscalCode)
        fiscalCode.font = .monospacedSystemFont(ofSize: 13, weight: .regular)

        let text = NSTextView(frame: NSRect(x: 0, y: 0, width: 600, height: 390))
        text.isEditable = false
        text.isSelectable = true
        text.isAutomaticLinkDetectionEnabled = false
        text.autoresizingMask = [.width]
        text.textContainer?.widthTracksTextView = true
        text.textContainerInset = NSSize(width: 9, height: 10)
        text.textStorage?.setAttributedString(Self.proposals(presentation))

        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.borderType = .bezelBorder
        scroll.documentView = text

        let cancel = NSButton(title: "Annulla", target: self, action: #selector(dismiss))
        cancel.keyEquivalent = "\u{1b}"
        confirm.bezelStyle = .rounded
        password.bezelStyle = .rounded

        let buttons = NSStackView(views: [cancel, password, confirm])
        buttons.alignment = .centerY
        buttons.spacing = 8

        let content = NSStackView(views: [heading, fiscalCode, scroll, buttons])
        content.orientation = .vertical
        content.alignment = .leading
        content.edgeInsets = NSEdgeInsets(top: 20, left: 20, bottom: 16, right: 20)
        content.spacing = 10
        window.contentView = content
        scroll.widthAnchor.constraint(equalTo: content.widthAnchor, constant: -40).isActive = true
    }

    func present() async -> VisitAuthenticationPolicy? {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            window.center()
            window.makeKeyAndOrderFront(nil)
            if #available(macOS 14.0, *) {
                NSApplication.shared.activate()
            } else {
                NSApplication.shared.activate(ignoringOtherApps: true)
            }
        }
    }

    func cancel() {
        authentication.cancel()
        finish(nil)
    }

    func windowWillClose(_ notification: Notification) { cancel() }

    @objc private func dismiss() { cancel() }

    @objc private func approve() { authenticate(useSystemDialog: false) }

    @objc private func approveUsingPassword() { authenticate(useSystemDialog: true) }

    private func authenticate(useSystemDialog: Bool) {
        guard continuation != nil, confirm.isEnabled else { return }
        confirm.isEnabled = false
        password.isEnabled = false
        Task { finish(await authentication.confirm(useSystemDialog: useSystemDialog)) }
    }

    private func finish(_ outcome: VisitAuthenticationPolicy?) {
        guard let continuation else { return }
        self.continuation = nil
        window.orderOut(nil)
        continuation.resume(returning: outcome)
    }

    private static func proposals(_ presentation: VisitConfirmationPresentation) -> NSAttributedString {
        let text = NSMutableAttributedString()
        let headingFont = NSFont.systemFont(ofSize: 15, weight: .semibold)
        let bodyFont = NSFont.systemFont(ofSize: 13)
        let secondary = NSColor.secondaryLabelColor
        for proposal in presentation.proposals {
            text.append(NSAttributedString(string: proposal.title + "\n", attributes: [.font: headingFont, .foregroundColor: NSColor.labelColor]))
            text.append(NSAttributedString(string: proposal.fields.map { $0.label + ": " + $0.value }.joined(separator: "\n") + "\n",
                                           attributes: [.font: bodyFont, .foregroundColor: NSColor.labelColor]))
            text.append(NSAttributedString(string: "In scheda: " + proposal.current + "\n" + proposal.sourceName + "\n" + proposal.sourceQuote + "\n\n",
                                           attributes: [.font: bodyFont, .foregroundColor: secondary]))
        }
        return text
    }
}

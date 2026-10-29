#if os(iOS)
import SwiftUI
import UIKit

private struct PatientChartPatientIDKey: EnvironmentKey {
    static let defaultValue: String? = nil
}
private struct PatientChartScrollMemoryKey: EnvironmentKey {
    static let defaultValue: PatientChartScrollMemory? = nil
}
extension EnvironmentValues {
    var patientChartPatientID: String? {
        get { self[PatientChartPatientIDKey.self] }
        set { self[PatientChartPatientIDKey.self] = newValue }
    }
    var patientChartScrollMemory: PatientChartScrollMemory? {
        get { self[PatientChartScrollMemoryKey.self] }
        set { self[PatientChartScrollMemoryKey.self] = newValue }
    }
}

@MainActor
final class PatientChartScrollMemory: ObservableObject {
    private final class AnchorView { weak var view: UIView?; init(_ view: UIView) { self.view = view } }
    var state = PatientChartReturnState()
    @Published private(set) var resetGeneration = 0
    var isRestoring = false
    var patientID: String?
    weak var scrollView: UIScrollView?
    var geometryChanged: (() -> Void)?
    private var anchors: [String: [String: AnchorView]] = [:]

    func disclosure(_ disclosure: PatientChartDisclosure, patientID: String) -> Binding<Bool> {
        Binding(get: { self.state.isExpanded(disclosure, patientID: patientID) }, set: { expanded in
            self.objectWillChange.send()
            self.state.setExpanded(expanded, disclosure: disclosure, patientID: patientID)
        })
    }
    func register(_ view: UIView, id: String, patientID: String) {
        anchors[patientID, default: [:]][id] = AnchorView(view)
        geometryChanged?()
    }
    func unregister(_ view: UIView, id: String, patientID: String) {
        if anchors[patientID]?[id]?.view === view { anchors[patientID]?[id] = nil }
    }
    func frame(id: String, patientID: String, in scroll: UIScrollView) -> CGRect? {
        guard let view = anchors[patientID]?[id]?.view, view.window != nil, view.isDescendant(of: scroll) else { return nil }
        return view.convert(view.bounds, to: scroll)
    }
    func discardReturn(endingSession: Bool = false) {
        state.discardReturns(endingSession: endingSession)
        isRestoring = false
        resetGeneration &+= 1
    }
    func captureSummary(patientID: String, category: PatientChartSummaryCategory) {
        guard let scroll = scrollView, self.patientID == patientID else { return }
        let id = "patient-summary-\(category.id)"
        guard let frame = frame(id: id, patientID: patientID, in: scroll) else { return }
        state.leave(patientID: patientID, category: category,
            anchor: PatientChartReadingAnchor(id: id,
                distanceFromTop: frame.minY - scroll.contentOffset.y - scroll.adjustedContentInset.top))
    }
}

struct PatientChartScrollAnchor: UIViewRepresentable {
    let patientID: String
    let id: String
    let memory: PatientChartScrollMemory
    func makeUIView(context: Context) -> Marker { Marker(frame: .zero) }
    func updateUIView(_ view: Marker, context: Context) {
        view.changed = { [weak memory, weak view] in
            guard let memory, let view else { return }
            memory.register(view, id: id, patientID: patientID)
        }
        view.removed = { [weak memory, weak view] in
            guard let memory, let view else { return }
            memory.unregister(view, id: id, patientID: patientID)
        }
        view.isUserInteractionEnabled = false
        view.changed?()
    }
    static func dismantleUIView(_ view: Marker, coordinator: ()) { view.removed?(); view.changed = nil; view.removed = nil }
    final class Marker: UIView {
        var changed: (() -> Void)?
        var removed: (() -> Void)?
        override func layoutSubviews() { super.layoutSubviews(); changed?() }
        override func didMoveToWindow() { super.didMoveToWindow(); if window != nil { changed?() } }
    }
}

struct PatientChartScrollRestoration: UIViewRepresentable {
    let patientID: String
    let section: PatientWorkspaceSection
    let memory: PatientChartScrollMemory
    let isCurrent: () -> Bool
    let onRestore: () -> Void
    func makeUIView(context: Context) -> Marker {
        let view = Marker(frame: .zero); view.isUserInteractionEnabled = false; return view
    }
    func makeCoordinator() -> Coordinator { Coordinator() }
    func updateUIView(_ view: Marker, context: Context) {
        let owner = context.coordinator
        if owner.patientID != patientID || owner.section != section {
            owner.needsRestore = section == .overview
            owner.validatedFrame = nil
            owner.reportedRestore = false
            owner.protectedAnchor = section == .overview ? memory.state.position(patientID: patientID) : nil
            if section == .overview { memory.isRestoring = true }
        }
        owner.patientID = patientID; owner.section = section; owner.configuration = self
        view.onConnect = { [weak owner] view in owner?.connect(from: view) }
        owner.connect(from: view)
    }
    static func dismantleUIView(_ view: Marker, coordinator: Coordinator) {
        view.onConnect = nil; coordinator.observations = []; coordinator.configuration = nil
    }
    final class Marker: UIView {
        var onConnect: ((UIView) -> Void)?
        override func didMoveToWindow() { super.didMoveToWindow(); if window != nil { onConnect?(self) } }
    }
    @MainActor
    final class Coordinator {
        var patientID: String?
        var section: PatientWorkspaceSection?
        var configuration: PatientChartScrollRestoration?
        var needsRestore = false
        var scheduled = false
        var validatedFrame: CGRect?
        var protectedAnchor: PatientChartReadingAnchor?
        var reportedRestore = false
        var knownSize = CGSize.zero
        var observations: [NSKeyValueObservation] = []
        weak var scrollView: UIScrollView?

        func connect(from view: UIView) {
            DispatchQueue.main.async { [weak self, weak view] in
                guard let self, let view, let config = self.configuration else { return }
                var ancestor = view.superview
                while let next = ancestor, !(next is UIScrollView) { ancestor = next.superview }
                guard let scroll = ancestor as? UIScrollView else { return }
                config.memory.patientID = config.patientID
                config.memory.scrollView = scroll
                config.memory.geometryChanged = { [weak self] in self?.geometryChanged() }
                if self.scrollView !== scroll {
                    self.scrollView = scroll
                    self.knownSize = scroll.contentSize
                    self.observations = [
                        scroll.observe(\.contentOffset, options: [.new]) { [weak self] scroll, _ in
                            guard let self, let config = self.configuration, self.section == .overview, config.isCurrent() else { return }
                            if scroll.isTracking || scroll.isDragging || scroll.isDecelerating ||
                                (!config.memory.isRestoring && self.knownSize == scroll.contentSize) {
                                self.needsRestore = false; self.protectedAnchor = nil
                                config.memory.isRestoring = false
                            } else if self.protectedAnchor != nil && self.knownSize != scroll.contentSize {
                                self.needsRestore = true; config.memory.isRestoring = true
                                self.scheduleRestore()
                            }
                            self.knownSize = scroll.contentSize
                        },
                        scroll.observe(\.contentSize, options: [.new]) { [weak self] _, _ in self?.geometryChanged() }
                    ]
                }
                self.scheduleRestore()
            }
        }
        func geometryChanged() {
            guard section == .overview, let config = configuration, config.isCurrent(), let scroll = scrollView else { return }
            if let anchor = protectedAnchor,
               let frame = config.memory.frame(id: anchor.id, patientID: config.patientID, in: scroll) {
                let distance = frame.minY - scroll.contentOffset.y - scroll.adjustedContentInset.top
                if frame != validatedFrame || abs(distance - anchor.distanceFromTop) > 1 {
                    needsRestore = true; config.memory.isRestoring = true
                }
            }
            scheduleRestore()
        }
        func scheduleRestore() {
            guard needsRestore, !scheduled else { return }
            scheduled = true
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.scheduled = false
                self.restore()
            }
        }
        func restore() {
            guard needsRestore, let config = configuration, config.isCurrent(), let scroll = scrollView else { return }
            scroll.layoutIfNeeded()
            let minimum = -scroll.adjustedContentInset.top
            guard let anchor = protectedAnchor else {
                scroll.setContentOffset(CGPoint(x: 0, y: minimum), animated: false)
                finish(config); return
            }
            guard let frame = config.memory.frame(id: anchor.id, patientID: config.patientID, in: scroll) else { return }
            let desired = anchor.offset(anchorMinY: frame.minY, insetTop: scroll.adjustedContentInset.top)
            let maximum = max(minimum, scroll.contentSize.height - scroll.bounds.height + scroll.adjustedContentInset.bottom)
            let target = min(maximum, max(minimum, desired))
            if abs(scroll.contentOffset.y - target) > 0.1 { scroll.setContentOffset(CGPoint(x: 0, y: target), animated: false) }
            let distance = frame.minY - scroll.contentOffset.y - scroll.adjustedContentInset.top
            guard abs(distance - anchor.distanceFromTop) <= 1 else { validatedFrame = nil; return }
            if validatedFrame == frame { finish(config) }
            else { validatedFrame = frame; scheduleRestore() }
        }
        func finish(_ config: PatientChartScrollRestoration) {
            needsRestore = false; config.memory.isRestoring = false
            knownSize = scrollView?.contentSize ?? .zero
            if !reportedRestore { reportedRestore = true; config.onRestore() }
        }
    }
}
#endif

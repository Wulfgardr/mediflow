#if os(iOS)
import SwiftUI
import UIKit

@MainActor
final class PatientChartScrollMemory: ObservableObject {
    var state = PatientChartReturnState()
    var isRestoring = false
    weak var scrollView: UIScrollView?

    func capture(patientID: String) {
        guard let scrollView, !isRestoring else { return }
        state.record(scrollView.contentOffset, patientID: patientID)
    }
}

struct PatientChartScrollRestoration: UIViewRepresentable {
    let patientID: String
    let section: PatientWorkspaceSection
    let memory: PatientChartScrollMemory
    let isCurrent: () -> Bool
    let onRestore: () -> Void

    func makeUIView(context: Context) -> Marker {
        let view = Marker(frame: .zero)
        view.isUserInteractionEnabled = false
        return view
    }
    func makeCoordinator() -> Coordinator { Coordinator() }

    func updateUIView(_ view: Marker, context: Context) {
        let coordinator = context.coordinator
        let changed = coordinator.patientID != patientID || coordinator.section != section
        coordinator.patientID = patientID
        coordinator.section = section
        coordinator.configuration = self
        if changed {
            coordinator.needsRestore = section == .overview
            if section == .overview { memory.isRestoring = true }
        }
        view.onConnect = { [weak coordinator] view in coordinator?.connect(from: view) }
        coordinator.connect(from: view)
    }

    static func dismantleUIView(_ view: Marker, coordinator: Coordinator) {
        view.onConnect = nil
        coordinator.observation = nil
        coordinator.configuration = nil
    }

    final class Marker: UIView {
        var onConnect: ((UIView) -> Void)?
        override func didMoveToWindow() {
            super.didMoveToWindow()
            if window != nil { onConnect?(self) }
        }
    }

    @MainActor
    final class Coordinator {
        var patientID: String?
        var section: PatientWorkspaceSection?
        var configuration: PatientChartScrollRestoration?
        var needsRestore = false
        var observation: NSKeyValueObservation?
        weak var scrollView: UIScrollView?

        func connect(from view: UIView) {
            DispatchQueue.main.async { [weak self, weak view] in
                guard let self, let view, let configuration = self.configuration else { return }
                var ancestor = view.superview
                while let candidate = ancestor, !(candidate is UIScrollView) { ancestor = candidate.superview }
                guard let scroll = ancestor as? UIScrollView else { return }
                configuration.memory.scrollView = scroll
                if self.scrollView !== scroll {
                    self.scrollView = scroll
                    self.observation = scroll.observe(\.contentOffset, options: [.new]) { [weak self] scroll, _ in
                        guard let self, let configuration = self.configuration,
                              self.section == .overview, configuration.isCurrent(),
                              !configuration.memory.isRestoring else { return }
                        configuration.memory.state.record(scroll.contentOffset, patientID: configuration.patientID)
                    }
                }
                guard self.needsRestore, configuration.isCurrent() else { return }
                self.needsRestore = false
                scroll.layoutIfNeeded()
                let minimum = -scroll.adjustedContentInset.top
                let maximum = max(minimum, scroll.contentSize.height - scroll.bounds.height + scroll.adjustedContentInset.bottom)
                var position = configuration.memory.state.position(patientID: configuration.patientID)
                    ?? CGPoint(x: 0, y: minimum)
                position.y = min(maximum, max(minimum, position.y))
                scroll.setContentOffset(position, animated: false)
                configuration.memory.isRestoring = false
                configuration.onRestore()
            }
        }
    }
}
#endif

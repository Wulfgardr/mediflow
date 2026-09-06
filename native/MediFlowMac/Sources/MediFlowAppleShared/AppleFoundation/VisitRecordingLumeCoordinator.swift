/* @Codex */
import Combine
import Foundation
import MediFlowCore

#if os(macOS)
struct VisitRecordingOwnerBinding: Equatable, Sendable {
    let patientID: String
    let patientVersion: Int
    let ambulatoryID: String

    var isValid: Bool {
        !patientID.isEmpty && patientVersion > 0 && !ambulatoryID.isEmpty
    }

    var captureBinding: VisitRecordingBinding {
        VisitRecordingBinding(patientRef: patientID, revision: patientVersion)
    }
}

enum VisitRecordingLumeState: Equatable {
    case disclosure
    case requestingPermission
    case installationRequired
    case installing
    case ready
    case starting
    case recording
    case finalizing
    case transcriptReview
    case completed
    case permissionDenied
    case unavailable
    case denied(VisitRecordingDenial)
}

typealias VisitRecordingOwnerReader = @MainActor () -> VisitRecordingOwnerBinding?
typealias VisitRecordingSelectionReader = @MainActor () -> VisitRecordingSelectionReference?
typealias VisitRecordingLumeCaptureFactory = @MainActor (
    VisitRecordingSelectionReference,
    VisitRecordingPreflight,
    @escaping VisitRecordingSelectionReader
) -> VisitRecordingCaptureController?

@MainActor
final class VisitRecordingLumeCoordinator: ObservableObject {
    struct TranscriptReplacement: Equatable {
        let existingText: String
        let reviewText: String
    }

    @Published private(set) var state: VisitRecordingLumeState = .disclosure
    @Published var reviewText = ""

    private(set) var consumerGeneration: UInt64
    @Published private(set) var isReleasingResources = false

    private static var nextConsumerGeneration: UInt64 = 0
    private static weak var processLeaseOwner: VisitRecordingLumeCoordinator?
    private let makePreflight: @MainActor () -> VisitRecordingPreflight?
    private let makeCapture: VisitRecordingLumeCaptureFactory
    private var ownerBinding: VisitRecordingOwnerBinding?
    private var currentOwner: VisitRecordingOwnerReader?
    private var preflight: VisitRecordingPreflight?
    private var capture: VisitRecordingCaptureController?
    private var observationTask: Task<Void, Never>?
    private var holdsProcessLease = false
    private var terminal = false

    convenience init() {
        self.init(
            generation: Self.claimConsumerGeneration(),
            makePreflight: { VisitRecordingPreflight.liveIfAvailable() },
            makeCapture: { reference, preflight, current in
                VisitRecordingCaptureController.liveIfAvailable(
                    selectionReference: reference,
                    preflight: preflight,
                    currentSelectionReference: current
                )
            }
        )
    }

    init(
        generation: UInt64,
        makePreflight: @escaping @MainActor () -> VisitRecordingPreflight?,
        makeCapture: @escaping VisitRecordingLumeCaptureFactory
    ) {
        consumerGeneration = generation
        self.makePreflight = makePreflight
        self.makeCapture = makeCapture
    }

    func acceptDisclosure(
        for binding: VisitRecordingOwnerBinding?,
        currentBinding: @escaping VisitRecordingOwnerReader
    ) async {
        guard state == .disclosure, !terminal else { return }
        guard consumerGeneration > 0, let binding, binding.isValid,
              currentBinding() == binding else {
            await retire(as: .staleBinding)
            return
        }
        ownerBinding = binding
        currentOwner = currentBinding
        guard let preflight = makePreflight() else {
            await becomeUnavailable()
            return
        }
        self.preflight = preflight
        state = .requestingPermission
        await preflight.acceptDisclosureAndPrepare()
        await reconcilePreflight(preflight)
    }

    func installAssets() async {
        guard state == .installationRequired, !terminal, let preflight else { return }
        guard isCurrentOwner else { await retire(as: .staleBinding); return }
        state = .installing
        await preflight.installAssetsAfterExplicitRequest()
        await reconcilePreflight(preflight)
    }

    func start() async {
        guard state == .ready, !terminal, let ownerBinding, let preflight else { return }
        guard isCurrentOwner else { await retire(as: .staleBinding); return }
        guard claimProcessLease() else {
            await retire(as: .failed)
            return
        }
        let reference = VisitRecordingSelectionReference(
            binding: ownerBinding.captureBinding,
            generation: consumerGeneration
        )
        let selectionReader: VisitRecordingSelectionReader = { [weak self] in
            guard let self, self.isCurrentOwner else { return nil }
            return reference
        }
        guard let capture = makeCapture(reference, preflight, selectionReader) else {
            await becomeUnavailable()
            return
        }
        self.capture = capture
        state = .starting
        await capture.start()
        await reconcileCapture(capture)
    }

    func stop() async {
        guard state == .recording, !terminal, let capture else { return }
        guard isCurrentOwner else { await retire(as: .staleBinding); return }
        state = .finalizing
        await capture.stop()
        await reconcileCapture(capture)
    }

    func ownerDidChange(to binding: VisitRecordingOwnerBinding?) async {
        guard let ownerBinding else { return }
        guard binding != ownerBinding || !isCurrentOwner else { return }
        await retire(as: .staleBinding)
    }

    func cancelForLifecycle() async {
        guard ownerBinding != nil || capture != nil || preflight != nil else { return }
        await retire(as: .cancelled)
    }

    func suspendForNavigation() async {
        guard !terminal, ownerBinding != nil else { return }
        guard isCurrentOwner else { await retire(as: .staleBinding); return }
        if state == .transcriptReview {
            // Only a finalized review survives navigation. No destination is
            // invoked, and preservation never marks the review completed.
            await releaseOwnedResources(preservingReview: true)
        } else {
            await cancelForLifecycle()
        }
    }

    var hasPendingReview: Bool { state == .transcriptReview && isCurrentOwner }

    var canBeginNewSession: Bool { terminal && !isReleasingResources && !holdsProcessLease }

    @discardableResult
    func beginNewSessionAfterExplicitRequest() -> Bool {
        guard canBeginNewSession else { return false }
        let generation = Self.claimConsumerGeneration()
        guard generation > 0 else { return false }
        consumerGeneration = generation
        terminal = false
        reviewText = ""
        state = .disclosure
        return true
    }

    func canTransferTranscript(maxCharacters: Int) -> Bool {
        state == .transcriptReview && isCurrentOwner && maxCharacters > 0
            && !reviewText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && reviewText.count <= maxCharacters
            && reviewText.utf8.count <= VisitRecordingLimits.standard.maxTranscriptUTF8Bytes
    }

    var reviewTextUTF8ByteCount: Int { reviewText.utf8.count }

    @discardableResult
    func transferTranscript(
        maxCharacters: Int,
        existingTranscript: String,
        confirmedReplacement: TranscriptReplacement? = nil,
        into destination: (String) -> Void
    ) async -> Bool {
        guard canTransferTranscript(maxCharacters: maxCharacters), !terminal else { return false }
        let text = reviewText
        guard existingTranscript.isEmpty || existingTranscript == text
            || confirmedReplacement == TranscriptReplacement(existingText: existingTranscript, reviewText: text)
        else { return false }
        terminal = true
        state = .completed
        observationTask?.cancel()
        // An identical value must not invalidate an existing manual review.
        if existingTranscript != text { destination(text) }
        reviewText = ""
        await releaseOwnedResources()
        return true
    }

    private var isCurrentOwner: Bool {
        guard !terminal, let ownerBinding, let currentOwner else { return false }
        return currentOwner() == ownerBinding
    }

    private func reconcilePreflight(_ candidate: VisitRecordingPreflight) async {
        guard preflight === candidate, !terminal else {
            await candidate.releaseReservation()
            return
        }
        guard isCurrentOwner else { await retire(as: .staleBinding); return }
        switch candidate.state {
        case .installationRequired:
            state = .installationRequired
        case .ready:
            state = .ready
        case .permissionDenied:
            terminal = true
            state = .permissionDenied
            await releaseOwnedResources()
        case .unavailable, .released:
            await becomeUnavailable()
        case .awaitingAcceptedDisclosure, .requestingPermission, .checkingAssets, .installing:
            await becomeUnavailable()
        }
    }

    private func reconcileCapture(_ candidate: VisitRecordingCaptureController) async {
        guard capture === candidate, !terminal else {
            await candidate.dispose()
            return
        }
        switch candidate.session.phase {
        case .recording:
            state = .recording
            if observationTask == nil { beginObservingCapture(candidate) }
        case .finalizing:
            state = .finalizing
        case .transcriptReview:
            guard isCurrentOwner, let transcript = candidate.session.transcript,
                  !transcript.isEmpty else {
                await retire(as: .staleBinding)
                return
            }
            observationTask?.cancel()
            observationTask = nil
            reviewText = transcript
            state = .transcriptReview
        case let .denied(denial):
            await retire(as: denial)
        case .completed:
            terminal = true
            state = .completed
            await releaseOwnedResources()
        case .unavailable, .disclosure, .permissionRequired, .preparingAssets,
             .ready, .draftReview:
            await retire(as: .failed)
        }
    }

    private func beginObservingCapture(_ candidate: VisitRecordingCaptureController) {
        observationTask?.cancel()
        observationTask = Task { @MainActor [weak self, weak candidate] in
            while !Task.isCancelled, let self, let candidate,
                  self.capture === candidate, !self.terminal {
                do { try await Task.sleep(nanoseconds: 100_000_000) }
                catch { return }
                await self.reconcileCapture(candidate)
            }
        }
    }

    private func becomeUnavailable() async {
        guard !terminal else { return }
        terminal = true
        state = .unavailable
        reviewText = ""
        await releaseOwnedResources()
    }

    private func retire(as denial: VisitRecordingDenial) async {
        guard !terminal else { return }
        terminal = true
        state = .denied(denial)
        reviewText = ""
        observationTask?.cancel()
        observationTask = nil
        await releaseOwnedResources()
    }

    private func releaseOwnedResources(preservingReview: Bool = false) async {
        let ownedCapture = capture
        let ownedPreflight = preflight
        capture = nil
        preflight = nil
        if !preservingReview {
            ownerBinding = nil
            currentOwner = nil
        }
        observationTask?.cancel()
        observationTask = nil
        // A second disappearance must not release the process lease while the
        // first resource disposal is still in flight.
        guard ownedCapture != nil || ownedPreflight != nil else { return }
        isReleasingResources = true
        defer { isReleasingResources = false }
        await ownedCapture?.dispose()
        await ownedPreflight?.releaseReservation()
        releaseProcessLease()
    }

    private func claimProcessLease() -> Bool {
        if let owner = Self.processLeaseOwner {
            guard owner === self else { return false }
        } else {
            Self.processLeaseOwner = self
        }
        holdsProcessLease = true
        return true
    }

    private func releaseProcessLease() {
        guard holdsProcessLease else { return }
        holdsProcessLease = false
        if Self.processLeaseOwner === self {
            Self.processLeaseOwner = nil
        }
    }

    private static func claimConsumerGeneration() -> UInt64 {
        guard nextConsumerGeneration < UInt64.max else { return 0 }
        nextConsumerGeneration += 1
        return nextConsumerGeneration
    }
}
#endif

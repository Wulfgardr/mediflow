/* @Codex */
import Crypto
import Foundation
public struct VisitRecordingBinding: Equatable, Sendable {
    public let patientRef: String
    public let revision: Int
    public init(patientRef: String, revision: Int) {
        self.patientRef = patientRef
        self.revision = revision
    }
}
public enum VisitRecordingPhase: Equatable, Sendable {
    case unavailable
    case disclosure
    case permissionRequired
    case preparingAssets
    case ready
    case recording
    case finalizing
    case transcriptReview
    case draftReview
    case completed
    case denied(VisitRecordingDenial)
}
public enum VisitRecordingDenial: CaseIterable, Equatable, Sendable {
    case permissionDenied
    case interrupted
    case assetUnavailable
    case staleBinding
    case bufferExceeded
    case sessionDurationExceeded
    case transcriptExceeded
    case invalidUsage
    case cancelled
    case failed
}
public struct VisitRecordingUsage: Equatable, Sendable {
    public let bufferedAudioSeconds: Double
    public let bufferedAudioBytes: Int
    public let elapsedSeconds: Double
    public let transcriptUTF8Bytes: Int
    public init(
        bufferedAudioSeconds: Double,
        bufferedAudioBytes: Int,
        elapsedSeconds: Double,
        transcriptUTF8Bytes: Int
    ) {
        self.bufferedAudioSeconds = bufferedAudioSeconds
        self.bufferedAudioBytes = bufferedAudioBytes
        self.elapsedSeconds = elapsedSeconds
        self.transcriptUTF8Bytes = transcriptUTF8Bytes
    }
}
public struct VisitRecordingLimits: Equatable, Sendable {
    public static let standard = VisitRecordingLimits(
        maxBufferedAudioSeconds: 4,
        maxBufferedAudioBytes: 8 * 1_024 * 1_024,
        maxDurationSeconds: 90 * 60,
        maxTranscriptUTF8Bytes: 256 * 1_024
    )
    public let maxBufferedAudioSeconds: Double
    public let maxBufferedAudioBytes: Int
    public let maxDurationSeconds: Double
    public let maxTranscriptUTF8Bytes: Int
    public func denial(for usage: VisitRecordingUsage) -> VisitRecordingDenial? {
        guard usage.bufferedAudioSeconds.isFinite, usage.elapsedSeconds.isFinite,
              usage.bufferedAudioSeconds >= 0, usage.bufferedAudioBytes >= 0,
              usage.elapsedSeconds >= 0, usage.transcriptUTF8Bytes >= 0 else {
            return .invalidUsage
        }
        if usage.bufferedAudioSeconds > maxBufferedAudioSeconds
            || usage.bufferedAudioBytes > maxBufferedAudioBytes {
            return .bufferExceeded
        }
        if usage.elapsedSeconds > maxDurationSeconds { return .sessionDurationExceeded }
        if usage.transcriptUTF8Bytes > maxTranscriptUTF8Bytes { return .transcriptExceeded }
        return nil
    }
}
public enum VisitRecordingEvent: Equatable, Sendable {
    case presentDisclosure
    case acceptDisclosure
    case permissionGranted
    case permissionDenied
    case assetsReady
    case start
    case stop
    case publishTranscript(text: String, isFinal: Bool, currentBinding: VisitRecordingBinding)
    case deriveDraft
    case reviewDraft
    case editTranscript(String)
    case complete(currentBinding: VisitRecordingBinding)
}
public enum VisitRecordingContractError: Error, Equatable, Sendable {
    case invalidTransition
    case nonFinalTranscript
    case reviewRequired
}
public struct VisitRecordingSession: Equatable, Sendable {
    public let binding: VisitRecordingBinding
    public private(set) var phase: VisitRecordingPhase = .unavailable
    public private(set) var transcript: String?
    public private(set) var transcriptDigest: String?
    public private(set) var draftTranscriptDigest: String?
    private var reviewedTranscriptDigest: String?
    public var hasCurrentDraft: Bool {
        transcriptDigest != nil && draftTranscriptDigest == transcriptDigest
    }
    public var isCurrentDraftReviewed: Bool {
        hasCurrentDraft && reviewedTranscriptDigest == transcriptDigest
    }
    public init(binding: VisitRecordingBinding) {
        self.binding = binding
    }
    public mutating func cleanup(as denial: VisitRecordingDenial) {
        clearEphemeralReviewContent()
        switch phase {
        case .denied, .completed: return
        default: phase = .denied(denial)
        }
    }
    private mutating func clearEphemeralReviewContent() {
        transcript = nil
        transcriptDigest = nil
        draftTranscriptDigest = nil
        reviewedTranscriptDigest = nil
    }
    public mutating func apply(_ event: VisitRecordingEvent) throws {
        switch (phase, event) {
        case (.unavailable, .presentDisclosure): phase = .disclosure
        case (.disclosure, .acceptDisclosure): phase = .permissionRequired
        case (.permissionRequired, .permissionGranted): phase = .preparingAssets
        case (.permissionRequired, .permissionDenied): phase = .denied(.permissionDenied)
        case (.preparingAssets, .assetsReady): phase = .ready
        case (.ready, .start): phase = .recording
        case (.recording, .stop): phase = .finalizing
        case let (.finalizing, .publishTranscript(text, isFinal, currentBinding)):
            guard isFinal else { throw VisitRecordingContractError.nonFinalTranscript }
            guard currentBinding == binding else {
                phase = .denied(.staleBinding)
                return
            }
            transcript = text
            transcriptDigest = Self.digest(text)
            phase = .transcriptReview
        case (.transcriptReview, .deriveDraft):
            draftTranscriptDigest = transcriptDigest
            reviewedTranscriptDigest = nil
            phase = .draftReview
        case (.draftReview, .reviewDraft):
            reviewedTranscriptDigest = transcriptDigest
        case let (.transcriptReview, .editTranscript(text)),
             let (.draftReview, .editTranscript(text)):
            transcript = text
            transcriptDigest = Self.digest(text)
            draftTranscriptDigest = nil
            reviewedTranscriptDigest = nil
            phase = .transcriptReview
        case let (.draftReview, .complete(currentBinding)):
            guard currentBinding == binding else {
                cleanup(as: .staleBinding)
                return
            }
            guard isCurrentDraftReviewed else { throw VisitRecordingContractError.reviewRequired }
            clearEphemeralReviewContent()
            phase = .completed
        default: throw VisitRecordingContractError.invalidTransition
        }
    }
    private static func digest(_ text: String) -> String {
        let alphabet = Array("0123456789abcdef")
        return SHA256.hash(data: Data(text.utf8)).reduce(into: "") { hex, byte in
            hex.append(alphabet[Int(byte >> 4)])
            hex.append(alphabet[Int(byte & 15)])
        }
    }
}

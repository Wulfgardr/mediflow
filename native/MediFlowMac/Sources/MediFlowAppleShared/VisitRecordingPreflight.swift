/* @Codex */
import Foundation

#if os(macOS)
import AVFAudio
import Speech
#endif

public enum VisitRecordingAssetStatus: Equatable, Sendable {
    case unsupported
    case supported
    case downloading
    case installed
}

public enum VisitRecordingPreflightFailure: Equatable, Sendable {
    case speechUnavailable
    case unsupportedItalianLocale
    case assetUnsupported
    case assetDownloading
    case installationRequestUnavailable
    case installationFailed
    case reservationLimitReached
    case reservationFailed
    case reservationReleaseFailed
}

public enum VisitRecordingPreflightState: Equatable, Sendable {
    case awaitingAcceptedDisclosure
    case requestingPermission
    case permissionDenied
    case checkingAssets
    case installationRequired
    case installing
    case ready
    case unavailable(VisitRecordingPreflightFailure)
    case released
}

@MainActor
protocol VisitRecordingPermissionPort: AnyObject {
    func requestRecordPermission(_ completion: @escaping @Sendable (Bool) -> Void)
}

@MainActor
struct VisitRecordingAssetInstallation {
    let progress: Progress
    let downloadAndInstall: () async throws -> Void
}

@MainActor
protocol VisitRecordingAssetPort: AnyObject {
    var isAvailable: Bool { get }
    var maximumReservedLocales: Int { get }
    func resolveLocale(equivalentTo locale: Locale) async -> Locale?
    func installedLocales() async -> [Locale]
    func reservedLocales() async -> [Locale]
    func status() async -> VisitRecordingAssetStatus
    func installationRequest() async throws -> VisitRecordingAssetInstallation?
    func reserve(locale: Locale) async throws -> Bool
    func release(locale: Locale) async -> Bool
}

@MainActor
public final class VisitRecordingPreflight {
    public static let requestedLocaleIdentifier = "it-IT"

    public private(set) var state: VisitRecordingPreflightState = .awaitingAcceptedDisclosure
    public private(set) var resolvedLocaleIdentifier: String?
    public private(set) var installedLocaleIdentifiers: [String] = []
    public private(set) var maximumReservedLocales = 0
    public private(set) var installationProgress: Progress?

    private let permission: any VisitRecordingPermissionPort
    private let assets: any VisitRecordingAssetPort
    private var resolvedLocale: Locale?
    private var holdsReservation = false

    init(permission: any VisitRecordingPermissionPort, assets: any VisitRecordingAssetPort) {
        self.permission = permission
        self.assets = assets
    }

    public static func liveIfAvailable() -> VisitRecordingPreflight? {
        #if os(macOS)
        if #available(macOS 26.0, *) {
            return VisitRecordingPreflight(
                permission: AppleVisitRecordingPermissionPort(),
                assets: AppleVisitRecordingAssetPort()
            )
        }
        #endif
        return nil
    }

    public func acceptDisclosureAndPrepare() async {
        guard state == .awaitingAcceptedDisclosure else { return }
        state = .requestingPermission
        let granted = await withCheckedContinuation { continuation in
            permission.requestRecordPermission { granted in
                Task { @MainActor in
                    continuation.resume(returning: granted)
                }
            }
        }
        guard granted else {
            state = .permissionDenied
            return
        }
        await inspectAssets()
    }

    public func installAssetsAfterExplicitRequest() async {
        guard state == .installationRequired else { return }
        state = .installing
        do {
            guard let request = try await assets.installationRequest() else {
                state = .unavailable(.installationRequestUnavailable)
                return
            }
            installationProgress = request.progress
            try await request.downloadAndInstall()
            guard await assets.status() == .installed else {
                state = .unavailable(.installationFailed)
                return
            }
            installedLocaleIdentifiers = await assets.installedLocales().map(\.identifier).sorted()
            await reserveResolvedLocale()
        } catch {
            state = .unavailable(.installationFailed)
        }
    }

    public func releaseReservation() async {
        guard holdsReservation, let locale = resolvedLocale else { return }
        holdsReservation = false
        if await assets.release(locale: locale) {
            state = .released
        } else {
            holdsReservation = true
            state = .unavailable(.reservationReleaseFailed)
        }
    }

    private func inspectAssets() async {
        state = .checkingAssets
        guard assets.isAvailable else {
            state = .unavailable(.speechUnavailable)
            return
        }
        let requested = Locale(identifier: Self.requestedLocaleIdentifier)
        guard let locale = await assets.resolveLocale(equivalentTo: requested) else {
            state = .unavailable(.unsupportedItalianLocale)
            return
        }
        resolvedLocale = locale
        resolvedLocaleIdentifier = locale.identifier
        maximumReservedLocales = assets.maximumReservedLocales
        installedLocaleIdentifiers = await assets.installedLocales().map(\.identifier).sorted()
        switch await assets.status() {
        case .unsupported:
            state = .unavailable(.assetUnsupported)
        case .supported:
            state = .installationRequired
        case .downloading:
            state = .unavailable(.assetDownloading)
        case .installed:
            await reserveResolvedLocale()
        }
    }

    private func reserveResolvedLocale() async {
        guard let locale = resolvedLocale else {
            state = .unavailable(.unsupportedItalianLocale)
            return
        }
        let reserved = await assets.reservedLocales()
        guard reserved.contains(locale) || reserved.count < assets.maximumReservedLocales else {
            state = .unavailable(.reservationLimitReached)
            return
        }
        do {
            guard try await assets.reserve(locale: locale) else {
                state = .unavailable(.reservationFailed)
                return
            }
            holdsReservation = true
            state = .ready
        } catch {
            state = .unavailable(.reservationFailed)
        }
    }
}

#if os(macOS)
@available(macOS 14.0, *)
@MainActor
private final class AppleVisitRecordingPermissionPort: VisitRecordingPermissionPort {
    func requestRecordPermission(_ completion: @escaping @Sendable (Bool) -> Void) {
        AVAudioApplication.requestRecordPermission(completionHandler: completion)
    }
}

@available(macOS 26.0, *)
@MainActor
private final class AppleVisitRecordingAssetPort: VisitRecordingAssetPort {
    private var transcriber: SpeechTranscriber?

    var isAvailable: Bool { SpeechTranscriber.isAvailable }
    var maximumReservedLocales: Int { AssetInventory.maximumReservedLocales }

    func resolveLocale(equivalentTo locale: Locale) async -> Locale? {
        guard let resolved = await SpeechTranscriber.supportedLocale(equivalentTo: locale) else {
            return nil
        }
        transcriber = SpeechTranscriber(locale: resolved, preset: .transcription)
        return resolved
    }

    func installedLocales() async -> [Locale] { await SpeechTranscriber.installedLocales }
    func reservedLocales() async -> [Locale] { await AssetInventory.reservedLocales }

    func status() async -> VisitRecordingAssetStatus {
        guard let transcriber else { return .unsupported }
        switch await AssetInventory.status(forModules: [transcriber]) {
        case .unsupported: return .unsupported
        case .supported: return .supported
        case .downloading: return .downloading
        case .installed: return .installed
        @unknown default: return .unsupported
        }
    }

    func installationRequest() async throws -> VisitRecordingAssetInstallation? {
        guard let transcriber,
              let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber])
        else { return nil }
        return VisitRecordingAssetInstallation(progress: request.progress) {
            try await request.downloadAndInstall()
        }
    }

    func reserve(locale: Locale) async throws -> Bool {
        try await AssetInventory.reserve(locale: locale)
    }

    func release(locale: Locale) async -> Bool {
        await AssetInventory.release(reservedLocale: locale)
    }
}
#endif

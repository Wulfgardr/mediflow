import Foundation
import LocalAuthentication
import Security

enum VisitAuthenticationPolicy: String {
    case biometricsOrCompanion = "biometrics-or-companion"
    case accountPassword = "account-password"

    var systemPolicy: LAPolicy {
        switch self {
        case .biometricsOrCompanion:
            if #available(macOS 15.0, *) {
                return .deviceOwnerAuthenticationWithBiometricsOrCompanion
            }
            return .deviceOwnerAuthenticationWithBiometricsOrWatch
        case .accountPassword:
            return .deviceOwnerAuthentication
        }
    }
}

@MainActor
protocol VisitAuthenticationContext: AnyObject {
    func canEvaluate(_ policy: VisitAuthenticationPolicy) -> Bool
    func evaluate(_ policy: VisitAuthenticationPolicy) async throws
    func invalidate()
}

@MainActor
final class MacVisitAuthenticationContext: VisitAuthenticationContext {
    private let context: LAContext

    init(context: LAContext = LAContext()) {
        self.context = context
        context.touchIDAuthenticationAllowableReuseDuration = 0
        context.localizedFallbackTitle = "Usa la password del Mac"
    }

    func canEvaluate(_ policy: VisitAuthenticationPolicy) -> Bool {
        context.canEvaluatePolicy(policy.systemPolicy, error: nil)
    }

    func evaluate(_ policy: VisitAuthenticationPolicy) async throws {
        let reason = "Conferma il piano della visita in MediFlow"
        let accepted: Bool
        switch policy {
        case .biometricsOrCompanion:
            accepted = try await context.evaluatePolicy(policy.systemPolicy, localizedReason: reason)
        case .accountPassword:
            guard let constraint = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
                                                                  .devicePasscode, nil) else {
                throw LAError(.authenticationFailed)
            }
            accepted = try await context.evaluateAccessControl(constraint, operation: .useItem, localizedReason: reason)
        }
        guard accepted else { throw LAError(.authenticationFailed) }
    }

    func invalidate() { context.invalidate() }
}

@MainActor
final class VisitAuthentication {
    private let makeContext: () -> any VisitAuthenticationContext
    private var current: (any VisitAuthenticationContext)?
    private var used = false
    private var cancelled = false

    init(makeContext: @escaping () -> any VisitAuthenticationContext) {
        self.makeContext = makeContext
    }

    convenience init() {
        self.init(makeContext: { MacVisitAuthenticationContext() })
    }

    func cancel() {
        cancelled = true
        invalidateCurrent()
    }

    func confirm(useSystemDialog: Bool = false) async -> VisitAuthenticationPolicy? {
        guard !used, !cancelled else { return nil }
        used = true
        if useSystemDialog { return await confirmWithSystemDialog() }
        do {
            if try await attempt(.biometricsOrCompanion) { return .biometricsOrCompanion }
        } catch let error as LAError {
            guard Self.allowsSystemFallback(error.code) else { return nil }
        } catch {
            return nil
        }
        return await confirmWithSystemDialog()
    }

    private func confirmWithSystemDialog() async -> VisitAuthenticationPolicy? {
        guard (try? await attempt(.accountPassword)) == true else { return nil }
        return .accountPassword
    }

    private func attempt(_ policy: VisitAuthenticationPolicy) async throws -> Bool {
        guard !cancelled, !Task.isCancelled else { throw CancellationError() }
        let context = makeContext()
        current = context
        defer { invalidateCurrent() }
        guard context.canEvaluate(policy) else { return false }
        try await context.evaluate(policy)
        guard !cancelled, !Task.isCancelled else { throw CancellationError() }
        return true
    }

    private func invalidateCurrent() {
        current?.invalidate()
        current = nil
    }

    private static func allowsSystemFallback(_ code: LAError.Code) -> Bool {
        switch code {
        case .biometryLockout, .biometryNotAvailable, .biometryNotEnrolled, .userFallback:
            return true
        default:
            if #available(macOS 15.0, *) { return code == .companionNotAvailable }
            return code == .watchNotAvailable
        }
    }
}

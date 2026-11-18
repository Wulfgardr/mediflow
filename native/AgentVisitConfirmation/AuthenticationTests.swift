import Foundation
import LocalAuthentication
import Security

@MainActor
final class FakeVisitAuthenticationContext: VisitAuthenticationContext {
    var available = true
    var failure: LAError.Code?
    var pending: CheckedContinuation<Void, Error>?
    var evaluations = [VisitAuthenticationPolicy]()
    var availabilityChecks = [VisitAuthenticationPolicy]()
    var invalidations = 0
    var pause = false

    func canEvaluate(_ policy: VisitAuthenticationPolicy) -> Bool {
        availabilityChecks.append(policy)
        return available
    }

    func evaluate(_ policy: VisitAuthenticationPolicy) async throws {
        evaluations.append(policy)
        if let failure { throw LAError(failure) }
        if pause {
            try await withCheckedThrowingContinuation { pending = $0 }
        }
    }

    func invalidate() { invalidations += 1 }
}

final class RecordingSystemContext: LAContext {
    private(set) var policyCalls: [LAPolicy] = []
    private(set) var accessControlCalls: [LAAccessControlOperation] = []

    override func evaluatePolicy(_ policy: LAPolicy, localizedReason: String, reply: @escaping @Sendable (Bool, Error?) -> Void) {
        policyCalls.append(policy)
        reply(true, nil)
    }

    override func evaluateAccessControl(_ accessControl: SecAccessControl, operation: LAAccessControlOperation,
                                        localizedReason: String, reply: @escaping @Sendable (Bool, Error?) -> Void) {
        accessControlCalls.append(operation)
        reply(true, nil)
    }
}

@main
struct AuthenticationTests {
    @MainActor
    static func main() async throws {
        let primary = FakeVisitAuthenticationContext()
        let fallback = FakeVisitAuthenticationContext()
        var contexts = [primary, fallback]
        let auth = VisitAuthentication(makeContext: { contexts.removeFirst() })
        let first = await auth.confirm()
        precondition(first == .biometricsOrCompanion)
        precondition(primary.availabilityChecks == [.biometricsOrCompanion])
        precondition(primary.evaluations == [.biometricsOrCompanion])
        precondition(primary.invalidations == 1)
        precondition(fallback.evaluations.isEmpty)

        let system = RecordingSystemContext()
        let systemAdapter = MacVisitAuthenticationContext(context: system)
        try await systemAdapter.evaluate(.accountPassword)
        precondition(system.policyCalls.isEmpty)
        precondition(system.accessControlCalls == [.useItem])
        systemAdapter.invalidate()

        let unattended = LAContext()
        unattended.interactionNotAllowed = true
        let unattendedAdapter = MacVisitAuthenticationContext(context: unattended)
        do {
            try await unattendedAdapter.evaluate(.accountPassword)
            preconditionFailure("Password confirmation succeeded without a system dialog")
        } catch {
            precondition(error is LAError)
        }
        unattendedAdapter.invalidate()

        let selectedPassword = FakeVisitAuthenticationContext()
        let direct = VisitAuthentication(makeContext: { selectedPassword })
        let explicit = await direct.confirm(useSystemDialog: true)
        precondition(explicit == .accountPassword)
        precondition(selectedPassword.availabilityChecks == [.accountPassword])
        precondition(selectedPassword.evaluations == [.accountPassword])
        precondition(selectedPassword.invalidations == 1)

        for reason in [LAError.Code.biometryLockout, .userFallback, .biometryNotAvailable, .biometryNotEnrolled] {
            let primary = FakeVisitAuthenticationContext()
            primary.failure = reason
            let fallback = FakeVisitAuthenticationContext()
            var contexts = [primary, fallback]
            let auth = VisitAuthentication(makeContext: { contexts.removeFirst() })
            let outcome = await auth.confirm()
            precondition(outcome == .accountPassword)
            precondition(fallback.availabilityChecks == [.accountPassword])
            precondition(fallback.evaluations == [.accountPassword])
            precondition(primary.invalidations == 1 && fallback.invalidations == 1)
        }

        for reason in [LAError.Code.userCancel, .systemCancel, .appCancel, .authenticationFailed, .notInteractive] {
            let primary = FakeVisitAuthenticationContext()
            primary.failure = reason
            let auth = VisitAuthentication(makeContext: { primary })
            let outcome = await auth.confirm()
            precondition(outcome == nil)
            precondition(primary.evaluations == [.biometricsOrCompanion])
            precondition(primary.invalidations == 1)
        }

        for fallbackAvailable in [true, false] {
            let primary = FakeVisitAuthenticationContext()
            primary.available = false
            let fallback = FakeVisitAuthenticationContext()
            fallback.available = fallbackAvailable
            fallback.failure = .authenticationFailed
            var contexts = [primary, fallback]
            let auth = VisitAuthentication(makeContext: { contexts.removeFirst() })
            let outcome = await auth.confirm()
            precondition(outcome == nil)
            precondition(primary.evaluations.isEmpty)
            precondition(fallback.evaluations.count == (fallbackAvailable ? 1 : 0))
            precondition(primary.invalidations == 1 && fallback.invalidations == 1)
        }

        for cancelInFallback in [false, true] {
            let primary = FakeVisitAuthenticationContext()
            let fallback = FakeVisitAuthenticationContext()
            let pending = cancelInFallback ? fallback : primary
            primary.available = !cancelInFallback
            pending.pause = true
            var contexts = [primary, fallback]
            let auth = VisitAuthentication(makeContext: { contexts.removeFirst() })
            let task = Task { await auth.confirm() }
            while pending.pending == nil { await Task.yield() }
            let duplicate = await auth.confirm()
            precondition(duplicate == nil)
            auth.cancel()
            precondition(pending.invalidations == 1)
            pending.pending?.resume()
            let late = await task.value
            precondition(late == nil)
            precondition(pending.invalidations == 1)
        }
        print("Visit LocalAuthentication adapter: OK")
        try ProtocolTests.run()
    }
}

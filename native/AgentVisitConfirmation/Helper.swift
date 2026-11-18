import AppKit
import CryptoKit
import Foundation

struct VisitConfirmationRegistration: Encodable {
    let agreementPublicKey: Data
    let signingPublicKey: Data
}

struct VisitConfirmationProof: Encodable {
    let signature: Data
    let policy: String
}

@main
struct AgentVisitConfirmationHelper {
    private static let frameLimit = 512 * 1024

    @MainActor
    static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        Task { await confirmVisit() }
        app.run()
    }

    @MainActor
    private static func confirmVisit() async {
        do {
            guard CommandLine.arguments.count == 1,
                  isPrivatePipe(STDIN_FILENO), isPrivatePipe(STDOUT_FILENO),
                  SecureEnclave.isAvailable else { throw VisitConfirmationFailure.denied }
            let signing = try SecureEnclave.P256.Signing.PrivateKey()
            let agreement = P256.KeyAgreement.PrivateKey()
            let signingPublicKey = signing.publicKey.x963Representation
            try send(VisitConfirmationRegistration(agreementPublicKey: agreement.publicKey.x963Representation,
                                                    signingPublicKey: signingPublicKey))

            let frameBytes = try await Task.detached { try readVisitConfirmationFrame(from: STDIN_FILENO, limit: frameLimit) }.value
            let frame = try JSONDecoder().decode(VisitConfirmationFrame.self, from: frameBytes)
            let review = try OpenVisitConfirmation(frame: frame, agreement: agreement, signingPublicKey: signingPublicKey, now: now())
            let panel = VisitConfirmationPanel(review.presentation)
            let remaining = max(0, review.challenge.expiresAt - now())
            guard remaining > 0 else { throw VisitConfirmationFailure.denied }
            let timeout = Task {
                try await Task.sleep(for: .milliseconds(remaining))
                panel.cancel()
            }
            let watchParent = Task.detached {
                _ = try? FileHandle.standardInput.read(upToCount: 1)
                await panel.cancel()
            }
            defer { timeout.cancel(); watchParent.cancel() }
            guard let policy = await panel.present(), now() < review.challenge.expiresAt else {
                throw VisitConfirmationFailure.denied
            }
            let signature = try signing.signature(for: review.signedMessage(policy))
            try send(VisitConfirmationProof(signature: signature.rawRepresentation, policy: policy.rawValue))
        } catch {
            exit(1)
        }
        exit(0)
    }

    private static func now() -> Int { Int(Date().timeIntervalSince1970 * 1000) }

    private static func isPrivatePipe(_ descriptor: Int32) -> Bool {
        var endpoint = stat()
        guard fstat(descriptor, &endpoint) == 0 else { return false }
        let type = endpoint.st_mode & S_IFMT
        return type == S_IFIFO || type == S_IFSOCK
    }

    private static func send<T: Encodable>(_ frame: T) throws {
        try FileHandle.standardOutput.write(contentsOf: JSONEncoder().encode(frame) + Data([10]))
    }
}

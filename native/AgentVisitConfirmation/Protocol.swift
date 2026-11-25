import CryptoKit
import Darwin
import Foundation

struct VisitConfirmationPresentation: Decodable {
    struct Field: Decodable {
        let label: String
        let value: String
    }

    struct Proposal: Decodable {
        let id: String
        let kind: String
        let title: String
        let fields: [Field]
        let current: String
        let sourceName: String
        let sourceQuote: String
        let sourceHash: String
    }

    let patient: String
    let fiscalCode: String
    let proposals: [Proposal]

    var valid: Bool {
        func displayable(_ value: String, max: Int) -> Bool {
            !value.isEmpty && value.utf8.count <= max && value.unicodeScalars.allSatisfy {
                let category = $0.properties.generalCategory
                return category != .format && (category != .control || $0 == "\n")
            }
        }

        return displayable(patient, max: 512)
            && fiscalCode.utf8.count == 16
            && fiscalCode.utf8.allSatisfy { (48...57).contains($0) || (65...90).contains($0) }
            && (1...128).contains(proposals.count)
            && proposals.allSatisfy { proposal in
                displayable(proposal.title, max: 160)
                    && displayable(proposal.current, max: 16_384)
                    && displayable(proposal.sourceName, max: 1024)
                    && displayable(proposal.sourceQuote, max: 2400)
                    && proposal.sourceHash.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil
                    && (1...32).contains(proposal.fields.count)
                    && proposal.fields.allSatisfy { displayable($0.label, max: 160) && displayable($0.value, max: 16_384) }
            }
    }
}

struct VisitConfirmationShownItem: Decodable, Equatable {
    let id: String
    let kind: String
}

struct VisitConfirmationChallenge: Decodable {
    let purpose: String
    let requestId: String
    let nonce: String
    let expiresAt: Int
    let presentationDigest: String
    let signingPublicKey: Data
    let fiscalCode: String
    let items: [VisitConfirmationShownItem]

    func describes(_ presentation: VisitConfirmationPresentation) -> Bool {
        presentation.fiscalCode == fiscalCode
            && presentation.proposals.map { VisitConfirmationShownItem(id: $0.id, kind: $0.kind) } == items
    }
}

struct VisitConfirmationFrame: Decodable {
    let challenge: Data
    let presentation: Data
}

struct EncryptedVisitPresentation: Decodable {
    let publicKey: Data
    let iv: Data
    let ciphertext: Data
}

struct OpenVisitConfirmation {
    let challenge: VisitConfirmationChallenge
    let challengeBytes: Data
    let presentation: VisitConfirmationPresentation

    init(frame: VisitConfirmationFrame, agreement: P256.KeyAgreement.PrivateKey, signingPublicKey: Data, now: Int) throws {
        let decoder = JSONDecoder()
        let challenge = try decoder.decode(VisitConfirmationChallenge.self, from: frame.challenge)
        let digest = SHA256.hash(data: frame.presentation).map { String(format: "%02x", $0) }.joined()
        guard challenge.purpose == "mediflow.visit-confirmation.v2",
              let ref = UUID(uuidString: challenge.requestId), ref.uuidString.lowercased() == challenge.requestId,
              let nonce = Data(base64Encoded: challenge.nonce), nonce.count == 32,
              challenge.expiresAt > now, challenge.expiresAt - now <= 60_000,
              challenge.signingPublicKey == signingPublicKey,
              challenge.presentationDigest == digest else { throw VisitConfirmationFailure.denied }
        let sealed = try decoder.decode(EncryptedVisitPresentation.self, from: frame.presentation)
        guard sealed.ciphertext.count >= 16 else { throw VisitConfirmationFailure.denied }
        let peer = try P256.KeyAgreement.PublicKey(x963Representation: sealed.publicKey)
        let secret = try agreement.sharedSecretFromKeyAgreement(with: peer)
        let aad = Data(challenge.requestId.utf8)
        let key = secret.hkdfDerivedSymmetricKey(using: SHA256.self, salt: Data(challenge.purpose.utf8), sharedInfo: aad, outputByteCount: 32)
        let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: sealed.iv),
                                       ciphertext: sealed.ciphertext.dropLast(16), tag: sealed.ciphertext.suffix(16))
        let bytes = try AES.GCM.open(box, using: key, authenticating: aad)
        let presentation = try decoder.decode(VisitConfirmationPresentation.self, from: bytes)
        guard presentation.valid, challenge.describes(presentation) else { throw VisitConfirmationFailure.denied }
        self.challenge = challenge
        self.challengeBytes = frame.challenge
        self.presentation = presentation
    }

    func signedMessage(_ policy: VisitAuthenticationPolicy) -> Data {
        challengeBytes + Data(("\n" + policy.rawValue).utf8)
    }
}

enum VisitConfirmationFailure: Error {
    case denied
}


func readVisitConfirmationFrame(from descriptor: Int32, limit: Int) throws -> Data {
    var frame = Data()
    var buffer = [UInt8](repeating: 0, count: 4096)
    while true {
        let count = buffer.withUnsafeMutableBytes { Darwin.read(descriptor, $0.baseAddress, $0.count) }
        if count < 0 && errno == EINTR { continue }
        guard count > 0, frame.count + count <= limit else { throw VisitConfirmationFailure.denied }
        frame.append(contentsOf: buffer.prefix(count))
        if frame.last == 10 { return frame }
    }
}

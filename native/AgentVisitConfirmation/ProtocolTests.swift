import CryptoKit
import Foundation

enum ProtocolTests {
    static func run() throws {
        try frameArrivesBeforeParentCloses()
        let agreement = P256.KeyAgreement.PrivateKey()
        let sender = P256.KeyAgreement.PrivateKey()
        let signing = P256.Signing.PrivateKey()
        let requestId = UUID().uuidString.lowercased()
        let purpose = "mediflow.visit-confirmation.v1"
        let aad = Data(requestId.utf8)
        let now = 1_799_000_000_000

        let presentation = [
            "patient": "Paziente Sintetico",
            "fiscalCode": "SYNTHETICXX11A11",
            "proposals": [[
                "title": "Terapia", "fields": [["label": "Farmaco", "value": "Farmaco sintetico"]],
                "current": "Non presente", "sourceName": "fonte.pdf",
                "sourceQuote": "Farmaco sintetico, una compressa", "sourceHash": String(repeating: "a", count: 64)
            ]]
        ] as [String: Any]
        let shared = try sender.sharedSecretFromKeyAgreement(with: agreement.publicKey)
        let key = shared.hkdfDerivedSymmetricKey(using: SHA256.self, salt: Data(purpose.utf8), sharedInfo: aad, outputByteCount: 32)
        let encrypted = try AES.GCM.seal(JSONSerialization.data(withJSONObject: presentation), using: key, authenticating: aad)
        let envelope = try JSONSerialization.data(withJSONObject: [
            "publicKey": sender.publicKey.x963Representation.base64EncodedString(),
            "iv": Data(encrypted.nonce).base64EncodedString(),
            "ciphertext": (encrypted.ciphertext + encrypted.tag).base64EncodedString()
        ])
        let digest = SHA256.hash(data: envelope).map { String(format: "%02x", $0) }.joined()
        let publicKey = signing.publicKey.x963Representation
        let challenge = [
            "purpose": purpose, "requestId": requestId, "expiresAt": now + 60_000,
            "nonce": Data(repeating: 11, count: 32).base64EncodedString(),
            "presentationDigest": digest, "signingPublicKey": publicKey.base64EncodedString()
        ] as [String: Any]
        let challengeData = try JSONSerialization.data(withJSONObject: challenge)
        let frame = VisitConfirmationFrame(challenge: challengeData, presentation: envelope)
        let opened = try OpenVisitConfirmation(frame: frame, agreement: agreement, signingPublicKey: publicKey, now: now)
        precondition(opened.presentation.patient == "Paziente Sintetico")
        let message = opened.signedMessage(.accountPassword)
        let signature = try signing.signature(for: message)
        precondition(signing.publicKey.isValidSignature(signature, for: message))
        precondition(!signing.publicKey.isValidSignature(signature, for: opened.signedMessage(.biometricsOrCompanion)))

        func expectDenial(_ frame: VisitConfirmationFrame, _ key: P256.KeyAgreement.PrivateKey = agreement,
                          _ signingKey: Data = publicKey, _ time: Int = now) {
            let invalid = try? OpenVisitConfirmation(frame: frame, agreement: key, signingPublicKey: signingKey, now: time)
            precondition(invalid == nil)
        }
        expectDenial(frame, agreement, publicKey, now + 60_000)
        expectDenial(frame, sender)
        expectDenial(frame, agreement, Data())
        expectDenial(VisitConfirmationFrame(challenge: challengeData, presentation: envelope + Data([32])))
        for invalid in [["requestId": UUID().uuidString.lowercased()], ["nonce": "invalid"], ["purpose": "other"]] {
            let bytes = try JSONSerialization.data(withJSONObject: challenge.merging(invalid) { _, new in new })
            expectDenial(VisitConfirmationFrame(challenge: bytes, presentation: envelope))
        }
        print("Native visit confirmation envelope: OK")
    }

    private static func frameArrivesBeforeParentCloses() throws {
        let pipe = Pipe()
        let frame = Data("{\"confirmation\":true}\n".utf8)
        let arrived = DispatchSemaphore(value: 0)
        DispatchQueue.global().async {
            if (try? readVisitConfirmationFrame(from: pipe.fileHandleForReading.fileDescriptor, limit: 4096)) == frame {
                arrived.signal()
            }
        }
        try pipe.fileHandleForWriting.write(contentsOf: frame)
        let read = arrived.wait(timeout: .now() + .seconds(2))
        try pipe.fileHandleForWriting.close()
        precondition(read == .success)
    }
}

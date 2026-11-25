import CryptoKit
import Foundation

enum ProtocolTests {
    static func run() throws {
        try frameArrivesBeforeParentCloses()
        let agreement = P256.KeyAgreement.PrivateKey()
        let sender = P256.KeyAgreement.PrivateKey()
        let signing = P256.Signing.PrivateKey()
        let requestId = UUID().uuidString.lowercased()
        let purpose = "mediflow.visit-confirmation.v2"
        let aad = Data(requestId.utf8)
        let now = 1_799_000_000_000
        let therapyId = UUID().uuidString.lowercased()
        let noteId = UUID().uuidString.lowercased()

        func proposal(_ id: String, _ kind: String) -> [String: Any] {
            ["id": id, "kind": kind, "title": "Terapia", "fields": [["label": "Farmaco", "value": "Farmaco sintetico"]],
             "current": "Non presente", "sourceName": "fonte.pdf",
             "sourceQuote": "Farmaco sintetico, una compressa", "sourceHash": String(repeating: "a", count: 64)]
        }
        func seal(_ presentation: [String: Any]) throws -> Data {
            let shared = try sender.sharedSecretFromKeyAgreement(with: agreement.publicKey)
            let key = shared.hkdfDerivedSymmetricKey(using: SHA256.self, salt: Data(purpose.utf8), sharedInfo: aad, outputByteCount: 32)
            let encrypted = try AES.GCM.seal(JSONSerialization.data(withJSONObject: presentation), using: key, authenticating: aad)
            return try JSONSerialization.data(withJSONObject: [
                "publicKey": sender.publicKey.x963Representation.base64EncodedString(),
                "iv": Data(encrypted.nonce).base64EncodedString(),
                "ciphertext": (encrypted.ciphertext + encrypted.tag).base64EncodedString()
            ])
        }
        let publicKey = signing.publicKey.x963Representation
        func challenge(for envelope: Data, _ changes: [String: Any] = [:]) -> [String: Any] {
            ([
                "purpose": purpose, "requestId": requestId, "expiresAt": now + 60_000,
                "nonce": Data(repeating: 11, count: 32).base64EncodedString(),
                "presentationDigest": SHA256.hash(data: envelope).map { String(format: "%02x", $0) }.joined(),
                "signingPublicKey": publicKey.base64EncodedString(),
                "fiscalCode": "SYNTHETICXX11A11",
                "items": [["id": therapyId, "kind": "therapy"]]
            ] as [String: Any]).merging(changes) { _, new in new }
        }
        let presentation = [
            "patient": "Paziente Sintetico",
            "fiscalCode": "SYNTHETICXX11A11",
            "proposals": [proposal(therapyId, "therapy")]
        ] as [String: Any]
        let envelope = try seal(presentation)
        let challengeFields = challenge(for: envelope)
        let challengeData = try JSONSerialization.data(withJSONObject: challengeFields)
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
        for invalid in [["requestId": UUID().uuidString.lowercased()], ["nonce": "invalid"], ["purpose": "mediflow.visit-confirmation.v1"]] {
            let bytes = try JSONSerialization.data(withJSONObject: challengeFields.merging(invalid) { _, new in new })
            expectDenial(VisitConfirmationFrame(challenge: bytes, presentation: envelope))
        }
        for unshown in [
            ["fiscalCode": "OTHERPATIENT11A1"],
            ["items": [["id": therapyId, "kind": "therapy"], ["id": noteId, "kind": "note"]]],
            ["items": [["id": therapyId, "kind": "service"]]],
            ["items": [["id": noteId, "kind": "therapy"]]],
        ] as [[String: Any]] {
            let bytes = try JSONSerialization.data(withJSONObject: challenge(for: envelope, unshown))
            expectDenial(VisitConfirmationFrame(challenge: bytes, presentation: envelope))
        }
        let reordered = try seal(presentation.merging(["proposals": [proposal(noteId, "note"), proposal(therapyId, "therapy")]]) { _, new in new })
        let planOrder = try JSONSerialization.data(withJSONObject: challenge(for: reordered,
            ["items": [["id": therapyId, "kind": "therapy"], ["id": noteId, "kind": "note"]]]))
        expectDenial(VisitConfirmationFrame(challenge: planOrder, presentation: reordered))
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

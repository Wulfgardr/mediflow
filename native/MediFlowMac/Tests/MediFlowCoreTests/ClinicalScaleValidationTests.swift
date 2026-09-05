// @Codex MF085-002/003: exact production scoring/write gate, shared synthetic vectors.
import Foundation
import XCTest
@testable import MediFlowCore

final class ClinicalScaleValidationTests: XCTestCase {
    private struct Vectors: Decodable {
        struct Component: Decodable { let id: String; let section: String; let values: [Int]; let text: String; let labels: [String] }
        struct Valid: Decodable { let name: String; let answers: [String: Int]; let score: Int }
        struct Invalid: Decodable { let name: String; let answers: [String: Int] }
        struct Legacy: Decodable { let scaleId: String; let title: String; let score: Int; let interpretation: String; let answers: [String: Int] }
        let scaleId: String
        let instrument: ClinicalScaleInstrumentProvenance
        let nonclassification: String
        let components: [Component]
        let sectionMaxima: [String: Int]
        let totalMaximum: Int
        let valid: [Valid]
        let invalid: [Invalid]
        let legacy: Legacy
    }

    private func vectors() throws -> Vectors {
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { root.deleteLastPathComponent() }
        return try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: root.appendingPathComponent("scripts/fixtures/clinical-scales-v1.json")))
    }

    func testSharedSourceDomainsAndSectionMaxima() throws {
        let fixture = try vectors()
        let definition = ClinicalScales.tinettiPOMA28V1
        XCTAssertEqual(definition.id, fixture.scaleId)
        XCTAssertEqual(definition.instrument, fixture.instrument)
        XCTAssertEqual(definition.questions.map(\.id), fixture.components.map(\.id))
        XCTAssertEqual(definition.questions.count, 20)
        XCTAssertEqual(definition.maxScore, fixture.totalMaximum)
        XCTAssertEqual(definition.maxScore, 28)
        for component in fixture.components {
            let question = try XCTUnwrap(definition.questions.first { $0.id == component.id })
            XCTAssertEqual(question.options.map(\.value), component.values)
            XCTAssertEqual(question.text, component.text)
            XCTAssertEqual(question.options.map(\.label), component.labels)
        }
        for (section, maximum) in fixture.sectionMaxima {
            XCTAssertEqual(definition.questions.filter { $0.id.hasPrefix("poma28v1.\(section).") }
                .reduce(0) { $0 + ($1.options.map(\.value).max() ?? 0) }, maximum)
        }
        XCTAssertEqual(ClinicalScales.tinetti.questions.count, 17)
        XCTAssertEqual(ClinicalScales.tinetti.maxScore, 24)
        XCTAssertTrue(Set(definition.questions.map(\.id)).isDisjoint(with: ClinicalScales.tinetti.questions.map(\.id)))
        XCTAssertEqual(ClinicalScales.all.map(\.id), [fixture.scaleId, "adl", "iadl", "mmse", "gds"])
    }

    @MainActor
    func testSharedValidVectorsWriteOnceWithCanonicalMetadata() async throws {
        let fixture = try vectors()
        for vector in fixture.valid {
            var writes = 0
            try await ClinicalScales.submit(definition: .init(
                id: ClinicalScales.tinettiPOMA28V1.id,
                title: ClinicalScales.tinettiPOMA28V1.title,
                scaleDescription: ClinicalScales.tinettiPOMA28V1.scaleDescription,
                questions: ClinicalScales.tinettiPOMA28V1.questions,
                instrument: fixture.instrument,
                interpret: { _ in "Caller interpretation must never be used" }
            ), answers: vector.answers) { submission in
                writes += 1
                XCTAssertEqual(submission.result.score, vector.score, vector.name)
                XCTAssertEqual(submission.result.interpretation, fixture.nonclassification, vector.name)
                XCTAssertEqual(submission.result.answers, vector.answers)
                let data = Data(submission.metadataJSON.utf8)
                let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
                XCTAssertEqual(json["scaleId"] as? String, fixture.scaleId)
                XCTAssertEqual(json["score"] as? Int, vector.score)
                XCTAssertEqual(json["answers"] as? [String: Int], vector.answers)
                let instrumentData = try JSONSerialization.data(withJSONObject: XCTUnwrap(json["instrument"]))
                XCTAssertEqual(try JSONDecoder().decode(ClinicalScaleInstrumentProvenance.self, from: instrumentData), fixture.instrument)
            }
            XCTAssertEqual(writes, 1, vector.name)
        }
    }

    @MainActor
    func testSharedInvalidVectorsProduceNoResultAndNoClinicalWrite() async throws {
        let fixture = try vectors()
        for vector in fixture.invalid {
            XCTAssertThrowsError(try ClinicalScales.tinettiPOMA28V1.result(from: vector.answers), vector.name)
            var writes = 0
            do {
                try await ClinicalScales.submit(definition: ClinicalScales.tinettiPOMA28V1, answers: vector.answers) { _ in writes += 1 }
                XCTFail("Accepted invalid vector: \(vector.name)")
            } catch { XCTAssertTrue(error is ClinicalScaleValidationError) }
            XCTAssertEqual(writes, 0, vector.name)
        }
    }

    @MainActor
    func testEveryNativeDefinitionRequiresExplicitAnswersButAcceptsZero() async throws {
        for definition in ClinicalScales.all {
            let complete = Dictionary(uniqueKeysWithValues: definition.questions.map { ($0.id, 0) })
            XCTAssertEqual(try definition.result(from: complete).score, 0)
            var acceptedWrites = 0
            try await ClinicalScales.submit(definition: definition, answers: complete) { _ in acceptedWrites += 1 }
            XCTAssertEqual(acceptedWrites, 1)
            var invalid: [[String: Int]] = [[:], complete.merging(["foreignQuestion": 0]) { _, new in new }]
            for question in definition.questions {
                var missing = complete
                missing.removeValue(forKey: question.id)
                invalid.append(missing)
                for value in [-1, (question.options.map(\.value).max() ?? 0) + 1] {
                    var outOfDomain = complete
                    outOfDomain[question.id] = value
                    invalid.append(outOfDomain)
                }
            }
            for answers in invalid {
                var writes = 0
                do {
                    try await ClinicalScales.submit(definition: definition, answers: answers) { _ in writes += 1 }
                    XCTFail("Invalid \(definition.id) accepted")
                } catch { XCTAssertTrue(error is ClinicalScaleValidationError) }
                XCTAssertEqual(writes, 0)
            }
        }
    }

    @MainActor
    func testRetiredAndUnboundDefinitionsCannotWrite() async throws {
        let fixture = try vectors()
        let corrected = ClinicalScales.tinettiPOMA28V1
        let unbound = ClinicalScaleDefinition(id: corrected.id, title: corrected.title,
            scaleDescription: corrected.scaleDescription, questions: corrected.questions, interpret: { _ in "" })
        for definition in [ClinicalScales.tinetti, unbound] {
            var writes = 0
            do {
                try await ClinicalScales.submit(definition: definition, answers: fixture.legacy.answers) { _ in writes += 1 }
                XCTFail("Inactive/unbound definition accepted")
            } catch { XCTAssertEqual(error as? ClinicalScaleValidationError, .inactiveInstrument) }
            XCTAssertEqual(writes, 0)
        }
        XCTAssertThrowsError(try ClinicalScales.tinetti.result(from: fixture.legacy.answers))
        XCTAssertEqual(ClinicalScales.tinettiHistoryNotice(scaleId: fixture.legacy.scaleId,
            title: fixture.legacy.title, instrument: nil), ClinicalScales.legacyTinettiNotice)
        XCTAssertEqual(fixture.legacy.score, 24)
        XCTAssertEqual(fixture.legacy.interpretation, "MEDIO Rischio di Caduta (19-24)")
        XCTAssertEqual(ClinicalScales.tinettiHistoryNotice(scaleId: corrected.id,
            title: corrected.title, instrument: fixture.instrument), ClinicalScales.sourceBoundTinettiNotice)
        XCTAssertEqual(ClinicalScales.tinettiHistoryNotice(scaleId: corrected.id,
            title: corrected.title, instrument: nil), ClinicalScales.legacyTinettiNotice)
    }

    func testHistoryPreservesSharedLegacyAndRequiresBoundCorrectedProvenance() throws {
        let fixture = try vectors()
        let legacy: [String: Any] = ["scaleId": fixture.legacy.scaleId, "title": fixture.legacy.title,
            "score": fixture.legacy.score, "interpretation": fixture.legacy.interpretation, "answers": fixture.legacy.answers]
        let raw = String(decoding: try JSONSerialization.data(withJSONObject: legacy), as: UTF8.self)
        let date = Date(timeIntervalSince1970: 1_750_000_000)
        func entry(_ metadata: String) -> HomeBaseEntrySummary {
            HomeBaseEntrySummary(id: "synthetic-scale", patientId: "synthetic-patient", type: "scale",
                title: "Tinetti", date: date, content: "Contenuto storico originale", setting: nil,
                metadata: metadata, attachments: nil, deletedAt: nil, deletionReason: nil,
                version: 1, createdAt: date, updatedAt: date)
        }
        let original = entry(raw)
        let item = try XCTUnwrap(ScaleHistoryPresentation.item(from: original))
        XCTAssertEqual(item.scoreLabel, "24")
        XCTAssertEqual(item.title, fixture.legacy.title)
        XCTAssertEqual(item.interpretation, fixture.legacy.interpretation)
        XCTAssertEqual(item.content, original.content)
        XCTAssertEqual(original.metadata, raw)
        XCTAssertEqual(item.provenanceLabel, ClinicalScales.legacyTinettiNotice)
        let definition = ClinicalScales.tinettiPOMA28V1
        let vector = try XCTUnwrap(fixture.valid.first { $0.score == 28 })
        let corrected = try ClinicalScales.prepareSubmission(definition: definition, answers: vector.answers)
        let bound = try XCTUnwrap(ScaleHistoryPresentation.item(from: entry(corrected.metadataJSON)))
        XCTAssertEqual(bound.scoreLabel, "28/28")
        XCTAssertEqual(bound.provenanceLabel, ClinicalScales.sourceBoundTinettiNotice)
        let missing = "{\"scaleId\":\"tinetti-poma28-v1\",\"score\":24,\"interpretation\":\"Originale\",\"instrument\":\"unbound\"}"
        let unbound = try XCTUnwrap(ScaleHistoryPresentation.item(from: entry(missing)))
        XCTAssertEqual(unbound.scoreLabel, "24")
        XCTAssertEqual(unbound.interpretation, "Originale")
        XCTAssertEqual(unbound.provenanceLabel, ClinicalScales.legacyTinettiNotice)
    }

    func testOptionalNumericItemsDoNotAcquireAnInventedAnswer() throws {
        let question = ClinicalScaleQuestion(id: "required", text: "Synthetic", options: [.init(label: "Zero", value: 0)])
        let optional = ClinicalScaleQuestion(id: "optional", text: "Synthetic", options: [.init(label: "Zero", value: 0)], isRequired: false)
        let definition = ClinicalScaleDefinition(id: "synthetic", title: "Test", scaleDescription: "Never active",
            questions: [question, optional], interpret: { _ in "Test only" })
        let result = try definition.result(from: ["required": 0])
        XCTAssertEqual(result.score, 0)
        XCTAssertNil(result.answers["optional"])
        XCTAssertThrowsError(try definition.result(from: [:]))
        XCTAssertThrowsError(try definition.result(from: ["required": 0, "optional": 2]))
    }

    func testInconsistentResultCannotBeEncodedAsCanonicalMetadata() throws {
        let definition = ClinicalScales.adl
        let answers = Dictionary(uniqueKeysWithValues: definition.questions.map { ($0.id, 0) })
        let forged = ClinicalScaleResult(score: 6, interpretation: "Not the result of these answers", answers: answers)
        XCTAssertThrowsError(try ClinicalScales.metadataJSON(definition: definition, result: forged))
        var input = answers
        let prepared = try ClinicalScales.prepareSubmission(definition: definition, answers: input)
        input["bath"] = 1
        XCTAssertEqual(prepared.result.answers["bath"], 0)
        XCTAssertEqual(prepared.result.score, 0)
    }

    @MainActor
    func testWriterFailurePropagatesOnceWithoutRetry() async throws {
        enum SyntheticFailure: Error { case unavailable }
        var writes = 0
        let definition = ClinicalScales.adl
        do {
            try await ClinicalScales.submit(definition: definition,
                answers: Dictionary(uniqueKeysWithValues: definition.questions.map { ($0.id, 0) })) { _ in
                writes += 1
                throw SyntheticFailure.unavailable
            }
            XCTFail("Storage failure swallowed")
        } catch { XCTAssertTrue(error is SyntheticFailure) }
        XCTAssertEqual(writes, 1)
    }
}

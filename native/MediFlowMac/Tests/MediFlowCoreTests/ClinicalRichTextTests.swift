import Foundation
import XCTest
@testable import MediFlowCore

final class ClinicalRichTextTests: XCTestCase {
    private struct Fixture: Decodable {
        let name: String
        let input: String
        let sanitized: String
    }

    private func fixtureURL() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("contracts/clinical-rich-text-fixtures.v1.json")
    }

    private func loadFixtures() throws -> [Fixture] {
        let data = try Data(contentsOf: fixtureURL())
        return try JSONDecoder().decode([Fixture].self, from: data)
    }

    private func text(
        _ value: String,
        bold: Bool = false,
        italic: Bool = false,
        underlined: Bool = false,
        struckThrough: Bool = false
    ) -> ClinicalRichTextInline {
        .text(ClinicalRichTextTextRun(
            text: value,
            isBold: bold,
            isItalic: italic,
            isUnderlined: underlined,
            isStruckThrough: struckThrough
        ))
    }

    private func modelDocuments() -> [ClinicalRichTextDocument] {
        let unordered = ClinicalRichTextList(
            isOrdered: false,
            items: [
                ClinicalRichTextListItem(blocks: [
                    .fragment([text("Esami")]),
                    .list(ClinicalRichTextList(
                        isOrdered: true,
                        items: [
                            ClinicalRichTextListItem(blocks: [.fragment([text("Emocromo")])]),
                            ClinicalRichTextListItem(blocks: [.fragment([text("Creatinina")])]),
                        ]
                    )),
                ]),
                ClinicalRichTextListItem(blocks: [.paragraph([text("Controllo")])]),
            ]
        )

        return [
            ClinicalRichTextDocument(),
            ClinicalRichTextDocument(blocks: [.fragment([text("Testo libero < 5 & stabile")])]),
            ClinicalRichTextDocument(blocks: [
                .paragraph([
                    text("Piano: "),
                    text("terapia", bold: true),
                    .lineBreak,
                    text("rivalutare", italic: true),
                    text(" dato", underlined: true),
                    text(" superato", struckThrough: true),
                    text(" completo", bold: true, italic: true, underlined: true, struckThrough: true),
                ]),
            ]),
            ClinicalRichTextDocument(blocks: [
                .heading(level: .one, content: [text("Titolo")]),
                .heading(level: .two, content: [text("Sezione")]),
                .heading(level: .three, content: [text("Dettaglio")]),
            ]),
            ClinicalRichTextDocument(blocks: [
                .list(unordered),
                .list(ClinicalRichTextList(
                    isOrdered: true,
                    items: [ClinicalRichTextListItem(blocks: [.fragment([text("Primo")])])]
                )),
            ]),
            ClinicalRichTextDocument(blocks: [
                .blockquote([
                    .paragraph([text("Caregiver")]),
                    .blockquote([.fragment([text("Paziente")])]),
                ]),
            ]),
        ]
    }

    func testEveryWebFixtureHasByteExactParseRenderParity() throws {
        let fixtures = try loadFixtures()
        XCTAssertEqual(fixtures.count, 40)

        for fixture in fixtures {
            let rendered = ClinicalRichText.render(
                document: ClinicalRichText.parse(html: fixture.sanitized)
            )
            XCTAssertEqual(
                Data(rendered.utf8),
                Data(fixture.sanitized.utf8),
                "Fixture \(fixture.name) diverged from the web sanitizer"
            )
        }
    }

    func testProgrammaticDocumentsRoundTripThroughCanonicalHTML() {
        for (index, document) in modelDocuments().enumerated() {
            let rendered = ClinicalRichText.render(document: document)
            XCTAssertEqual(
                ClinicalRichText.parse(html: rendered),
                document,
                "Programmatic document \(index) did not round-trip"
            )
        }
    }

    func testRenderedDocumentsReachAnInternalFixedPoint() throws {
        let fixtureDocuments = try loadFixtures().map {
            ClinicalRichText.parse(html: $0.sanitized)
        }

        for (index, document) in (modelDocuments() + fixtureDocuments).enumerated() {
            let first = ClinicalRichText.render(document: document)
            let second = ClinicalRichText.render(document: ClinicalRichText.parse(html: first))
            XCTAssertEqual(
                Data(second.utf8),
                Data(first.utf8),
                "Document \(index) did not reach a render fixed point"
            )
        }
    }
}

#if os(macOS)
import AppKit
import SwiftUI
import XCTest
@testable import MediFlowAppleShared

@MainActor
final class TreatmentReasoningPresentationTests: XCTestCase {
    private var result: NativeOrdinaryJSON {
        .object([
            "value": .object([
                "summary": .string("Proposta inventata per verificare la composizione. Non è un’indicazione clinica."),
                "data": .object([
                    "recommendation": .string("Rivedere la terapia sintetica con le fonti disponibili prima di ogni decisione."),
                    "keyEvidence": .array([.object(["statement": .string("La terapia riportata nel contesto richiede una verifica del medico."), "evidenceRefs": .array([.string("therapy:synthetic-one")])])]),
                    "caveats": .array([.string("I dati di questo esempio sono interamente inventati.")]),
                    "safetyFlags": .array([.object(["severity": .string("caution"), "label": .string("Revisione richiesta"), "rationale": .string("Il risultato non è una prescrizione."), "evidenceRefs": .array([.string("therapy:synthetic-one")])])]),
                    "suggestedActions": .array([.object(["label": .string("Rivedi le evidenze"), "rationale": .string("Verificare la fonte senza applicare modifiche alla cartella."), "evidenceRefs": .array([.string("therapy:synthetic-one")])])]),
                    "reasoning": .array([.string("Solo fonti sintetiche selezionate.")]),
                    "trace": .object(["limitations": .array([.string("Nessuna generazione o connessione a un servizio.")])])
                ])
            ]),
            "sourceBindings": .array([.object(["claimPath": .string("data.recommendation"), "claim": .string("Rivedere la terapia sintetica con le fonti disponibili prima di ogni decisione."), "evidenceRefs": .array([.string("profile:clinical-summary")])])])
        ])
    }

    func testSourceIndexIncludesReferencesUsedOnlyByEvidenceCautionsAndActions() {
        let sourceContext = NativeOrdinaryJSON.object([
            "sourceBindings": .array([.object(["claimPath": .string("summary"), "evidenceRefs": .array([.string("profile:source-a")])])]),
            "value": .object(["data": .object([
                "keyEvidence": .array([.object(["evidenceRefs": .array([.string("attachment:source-d")])])]),
                "safetyFlags": .array([.object(["evidenceRefs": .array([.string("therapy:source-b")])])]),
                "suggestedActions": .array([.object(["evidenceRefs": .array([.string("entry:source-c"), .string("therapy:source-b")])])])
            ])])
        ])
        let index = TreatmentReasoningSourceIndex(result: sourceContext)
        XCTAssertEqual(index.references, ["profile:source-a", "attachment:source-d", "therapy:source-b", "entry:source-c"])
        XCTAssertEqual(index.label("profile:source-a"), "Profilo clinico · Fonte 1")
        XCTAssertEqual(index.label("therapy:source-b"), "Terapia · Fonte 3")
        XCTAssertEqual(index.label("entry:source-c"), "Diario · Fonte 4")
    }

    func testProposalRendersNarrowAndWideRegistersInAppearanceAndTextEnvironments() throws {
        var narrowHeights: [String: CGFloat] = [:]
        for width in [360.0, 760.0] {
            for dark in [false, true] {
                for largeText in [false, true] {
                    let content = TreatmentReasoningProposalView(result: result)
                        .padding(28).frame(width: width, alignment: .leading)
                        .background(PlatformColors.chartCardSurface)
                        .environment(\.colorScheme, dark ? .dark : .light)
                        .environment(\.dynamicTypeSize, largeText ? .accessibility2 : .large)
                    let host = NSHostingView(rootView: content)
                    host.frame = NSRect(x: 0, y: 0, width: width, height: host.fittingSize.height)
                    let window = NSWindow(contentRect: host.frame, styleMask: [.borderless], backing: .buffered, defer: false)
                    window.contentView = host
                    defer { window.orderOut(nil) }
                    window.orderFront(nil)
                    host.layoutSubtreeIfNeeded()
                    host.displayIfNeeded()
                    let bitmap = try XCTUnwrap(host.bitmapImageRepForCachingDisplay(in: host.bounds))
                    host.cacheDisplay(in: host.bounds, to: bitmap)
                    XCTAssertEqual(host.frame.width, width, accuracy: 1)
                    XCTAssertGreaterThan(host.frame.height, 300)
                    let environmentKey = "\(dark)-\(largeText)"
                    if width == 360 {
                        narrowHeights[environmentKey] = host.frame.height
                    } else {
                        XCTAssertGreaterThan(try XCTUnwrap(narrowHeights[environmentKey]), host.frame.height,
                            "La colonna stretta deve andare a capo e aumentare l’altezza, senza ritagliare la proposta.")
                    }
                    if let directory = ProcessInfo.processInfo.environment["MEDIFLOW_TREATMENT_VISUAL_DIR"] {
                        let url = URL(fileURLWithPath: directory).appendingPathComponent("treatment-mac-\(Int(width))-\(dark ? "grafite" : "giorno")-\(largeText ? "large" : "regular").png")
                        try XCTUnwrap(bitmap.representation(using: .png, properties: [:])).write(to: url)
                    }
                }
            }
        }
    }
}
#endif

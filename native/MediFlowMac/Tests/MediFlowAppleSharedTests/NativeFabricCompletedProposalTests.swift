import Foundation
import XCTest
import SwiftUI
#if os(macOS)
import AppKit
#endif
@testable import MediFlowAppleShared

/// Rischio #4 (censimento macchine a stati, 11/11): a proposta locale completata
/// il watchdog dello stato resta attivo. Allo scadere del lease dell'attempt
/// (expiresAt della preparazione, 120 s sull'host) il watchdog chiude
/// l'operazione e cancella la proposta mentre il medico la sta leggendo.
private enum CompletedFabricFixture {
    static let id = "12345678-1234-4234-8234-123456789abc"
    static let selection: [String: Any] = ["modelOptionId": "model_option_" + String(repeating: "a", count: 32), "catalogRevision": "sha256_" + String(repeating: "b", count: 64),
        "preferenceRevision": "sha256_" + String(repeating: "c", count: 64), "source": "host_configuration",
        "provider": "ollama", "model": "synthetic-local:1", "venue": "local", "fallback": "none"]
    static func response(_ phase: String, expiresAt: Double) throws -> NativeFabricResponse {
        var value: [String: Any]
        if phase == "closed" { value = ["schema": "mediflow.native-fabric.v1", "phase": phase, "attemptId": id, "cleanupConfirmed": true] }
        else {
            value = ["schema": "mediflow.native-fabric.v1", "phase": phase, "attemptId": id, "functionId": "patient_insight", "selection": selection, "expiresAt": expiresAt]
            if phase == "completed" {
                let receipt: [String: Any] = ["capability": "patient_insight", "venue": "local_process", "provider": "ollama", "model": "synthetic-local:1",
                    "egress": "none", "egressProfile": ["egress": "none"], "fallbackCount": 0]
                value["result"] = ["preview": ["status": "available", "writesPerformed": 0, "apply": "denied", "proposal": ["reviewOnly": true, "writesPerformed": 0],
                    "receipt": receipt, "provenance": ["provider": "ollama"]]]
                value["clinicalWrites"] = 0; value["apply"] = "denied"
            }
        }
        return try JSONDecoder().decode(NativeFabricResponse.self, from: JSONSerialization.data(withJSONObject: value))
    }
}

@MainActor
final class NativeFabricCompletedProposalTests: XCTestCase {
    private func source() -> NativeOrdinarySnapshot {
        let connection = ClinicalWorkspaceConnection(dataSource: S6MockDataSource(details: [:]), credentials: .init(clientId: "synthetic-client", clientToken: "synthetic-token"),
            sessionCookie: "mediflow_session=synthetic-0", ambulatoryId: "synthetic-ambulatory", masterKey: nil,
            serverURL: "https://localhost", tlsPin: String(repeating: "a", count: 64), sessionGeneration: 0)
        return NativeOrdinarySnapshot(connection: connection, preparation: .init(functionId: .patientInsight, patientId: "synthetic-patient",
            ambulatoryId: "synthetic-ambulatory", patientRevision: 1, input: .patientInsight), fingerprint: "synthetic-source")
    }

    func testCompletedProposalSurvivesAttemptLeaseExpiry() async throws {
        let lease = Date().timeIntervalSince1970 * 1000 + 400
        var pollGate: CheckedContinuation<Void, Error>?, polls = 0, cancels = 0
        var services = NativeFabricModel.Services(prepare: { _, _ in try CompletedFabricFixture.response("ready", expiresAt: lease) }, command: { command, _ in
            if command.path == "generate" { return try CompletedFabricFixture.response("completed", expiresAt: lease) }
            cancels += 1; return try CompletedFabricFixture.response("closed", expiresAt: lease)
        }, status: { id, _ in try CompletedFabricFixture.response(id == nil ? "closed" : "current", expiresAt: lease) })
        services.waitForStatusPoll = { polls += 1; try await withCheckedThrowingContinuation { pollGate = $0 } }
        let model = NativeFabricModel(function: .patientInsight, snapshot: { self.source() }, services: services)

        model.prepare()
        for _ in 0..<500 where model.phase != .ready { await Task.yield() }
        XCTAssertEqual(model.phase, .ready)
        model.generate()
        for _ in 0..<500 where model.phase != .completed { await Task.yield() }
        XCTAssertEqual(model.phase, .completed)
        XCTAssertNotNil(model.proposal)

        // Il medico legge la proposta oltre il lease dell'attempt; il watchdog fa il suo giro.
        try await Task.sleep(nanoseconds: 600_000_000)
        for _ in 0..<500 where pollGate == nil { await Task.yield() }
        pollGate?.resume(); pollGate = nil
        for _ in 0..<500 { await Task.yield() }

        XCTAssertEqual(model.phase, .completed, "la proposta completata non viene chiusa dal watchdog dello stato")
        XCTAssertNotNil(model.proposal, "la proposta resta sotto gli occhi del medico")
        model.invalidate()
    }
    /// Confine: oltre il lease la proposta si chiude ancora con `invalidate()`, lo stesso gesto che
    /// `observe` collega al cambio paziente e a «Chiudi proposta»: proposta cancellata, attempt chiuso sull'host.
    func testCompletedProposalPastLeaseIsStillWithdrawnByInvalidate() async throws {
        let lease = Date().timeIntervalSince1970 * 1000 + 400
        var pollGate: CheckedContinuation<Void, Error>?, cancels = 0
        var services = NativeFabricModel.Services(prepare: { _, _ in try CompletedFabricFixture.response("ready", expiresAt: lease) }, command: { command, _ in
            if command.path == "generate" { return try CompletedFabricFixture.response("completed", expiresAt: lease) }
            cancels += 1; return try CompletedFabricFixture.response("closed", expiresAt: lease)
        }, status: { id, _ in try CompletedFabricFixture.response(id == nil ? "closed" : "current", expiresAt: lease) })
        services.waitForStatusPoll = { try await withCheckedThrowingContinuation { pollGate = $0 } }
        let model = NativeFabricModel(function: .patientInsight, snapshot: { self.source() }, services: services)

        model.prepare()
        for _ in 0..<500 where model.phase != .ready { await Task.yield() }
        model.generate()
        for _ in 0..<500 where model.phase != .completed { await Task.yield() }
        try await Task.sleep(nanoseconds: 600_000_000)
        for _ in 0..<500 where pollGate == nil { await Task.yield() }
        pollGate?.resume(); pollGate = nil
        for _ in 0..<500 { await Task.yield() }
        XCTAssertEqual(model.phase, .completed)

        model.invalidate()
        for _ in 0..<500 where model.phase != .idle { await Task.yield() }
        XCTAssertEqual(model.phase, .idle)
        XCTAssertNil(model.proposal)
        XCTAssertEqual(cancels, 1, "l'attempt viene chiuso sull'host")
    }
}

/// WUL-826: sopra le frasi del Quadro paziente una sola riga chiede di controllarle
/// sulla fonte. La vista disegna queste righe nell'ordine dato.
final class NativePatientInsightReviewNoticeTests: XCTestCase {
    #if os(macOS)
    func testWebAdministrationKeepsTheTechnicalLocalhostAddress() throws {
        XCTAssertEqual(HostAdminError.forbidden.errorDescription,
            "L'home-base riserva questa lettura alla console web. Un client nativo abbinato non vi accede, nemmeno con un account amministratore: si consulta da localhost.")
        let package = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let view = try String(contentsOf: package.appendingPathComponent("Sources/MediFlowAppleShared/AppleFoundation/HostAdminWorkspaceView.swift"), encoding: .utf8)
        XCTAssertTrue(view.contains("si usano da localhost."))
        XCTAssertFalse(view.contains("localhome-base"))
    }
    #endif

    @MainActor
    func testProposalCopySnapshot() throws {
        let proposal = NativeOrdinaryJSON.object(["preview": .object(["proposal": .object([
            "summary": .string("Proposta sintetica da rivedere. [S1]"),
            "currentState": .array([.string("Visita sintetica eseguita. [S2]")]),
            "alerts": .array([]), "nextSteps": .array([.string("Controllo sintetico da prenotare. [S2]")]), "gaps": .array([]),
        ])])])
        #if os(macOS)
        if let output = ProcessInfo.processInfo.environment["WUL825_APPLE_SNAPSHOTS"] {
            try FileManager.default.createDirectory(atPath: output, withIntermediateDirectories: true)
            for width in [390.0, 820.0, 1024.0] {
                let view = NativeOrdinaryProposalView(function: .patientInsight, result: proposal)
                    .padding(20).frame(width: width, alignment: .leading).background(Color.white)
                let renderer = ImageRenderer(content: view)
                renderer.scale = 2
                let image = try XCTUnwrap(renderer.cgImage)
                let data = try XCTUnwrap(NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]))
                try data.write(to: URL(fileURLWithPath: output).appendingPathComponent("proposal-\(Int(width)).png"))
            }
        }
        #endif
        XCTAssertEqual(NativeOrdinaryFunction.patientInsight.title, "Quadro paziente")
    }

    private let notice = "Controlla ogni frase sulla fonte che cita: il modello può scambiare ciò che è fatto con ciò che è da fare."
    func testNoticeIsTheFirstRowAboveThePatientInsightSentences() throws {
        let proposal = NativeOrdinaryJSON.object([
            "summary": .string("Sintesi sintetica da rivedere. [S1]"),
            "currentState": .array([.string("Visita sintetica eseguita. [S2]")]),
            "alerts": .array([]), "nextSteps": .array([.string("Controllo sintetico da prenotare. [S2]")]), "gaps": .array([]),
        ])
        let rows = NativeOrdinaryProposalView.patientInsightRows(proposal)
        XCTAssertEqual(NativeOrdinaryProposalView.patientInsightReviewNotice, notice)
        XCTAssertEqual(rows, [
            .notice(notice),
            .paragraph("Sintesi sintetica da rivedere. [S1]"),
            .heading("Stato attuale"), .item("Visita sintetica eseguita. [S2]"),
            .heading("Passi da valutare"), .item("Controllo sintetico da prenotare. [S2]"),
        ])
        // Anche una proposta senza sintesi ha la riga in testa, una sola volta.
        let onlyGaps = NativeOrdinaryProposalView.patientInsightRows(.object(["summary": .string(""), "gaps": .array([.string("Dato mancante. [DATI-INCOMPLETI]")])]))
        XCTAssertEqual(onlyGaps.first, .notice(notice))
        XCTAssertEqual(onlyGaps.filter { $0 == .notice(notice) }.count, 1)
    }
}

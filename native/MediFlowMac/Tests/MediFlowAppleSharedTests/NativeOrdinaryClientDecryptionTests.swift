/* @Codex — real repository crypto + real HomeBasePatientsClient/URLSession path + Node host parser.
 * Run on macOS with an offline-resolved repository and Node 24. Not socket/TLS, issuer,
 * actual attempt, provider or AnyDoc-worker qualification. Never send key/PIN to the bridge.
 */
#if os(macOS)
import Foundation
import CryptoKit
import MediFlowCore
import XCTest
@testable import MediFlowAppleShared

private final class NativeDecryptBridge: @unchecked Sendable {
    private let process = Process(), input = Pipe(), output = Pipe(), lock = NSLock()
    init() throws {
        let environment = ProcessInfo.processInfo.environment
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { root.deleteLastPathComponent() }
        if let configured = environment["MEDIFLOW_NATIVE_SOURCE_TEST_ROOT"] { root = URL(fileURLWithPath: configured) }
        let file = root.appendingPathComponent("lib/chatgpt-product/fixtures/native-client-decrypt-swift-bridge.cjs")
        guard FileManager.default.fileExists(atPath: file.path) else { throw XCTSkip("NOT_RUN: complete source root/bridge unavailable") }
        process.executableURL = URL(fileURLWithPath: environment["MEDIFLOW_NODE24"] ?? "/usr/bin/env")
        process.arguments = (environment["MEDIFLOW_NODE24"] == nil ? ["node"] : []) + [file.path]
        process.currentDirectoryURL = root; process.standardInput = input; process.standardOutput = output
        // No diagnostic includes request bodies, decrypted data, keys or PINs.
        process.standardError = FileHandle.nullDevice
        try process.run()
    }
    func close() { try? input.fileHandleForWriting.close(); if process.isRunning { process.terminate() }; process.waitUntilExit() }
    func call(_ object: [String: Any]) throws -> [String: Any] {
        lock.lock(); defer { lock.unlock() }
        var data = try JSONSerialization.data(withJSONObject: object); data.append(10)
        try input.fileHandleForWriting.write(contentsOf: data)
        var line = Data()
        while line.count <= 4 * 1024 * 1024 {
            guard let byte = try output.fileHandleForReading.read(upToCount: 1), !byte.isEmpty else { throw NativeOrdinaryContractError.invalid }
            if byte[0] == 10 { break }; line.append(byte)
        }
        let envelope = try XCTUnwrap(JSONSerialization.jsonObject(with: line) as? [String: Any])
        guard envelope["ok"] as? Bool == true else { throw NativeOrdinaryContractError.invalid }
        return try XCTUnwrap(envelope["result"] as? [String: Any])
    }
    func http(_ request: URLRequest) throws -> (HTTPURLResponse, Data) {
        var body = request.httpBody ?? Data()
        if body.isEmpty, let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                guard count >= 0, body.count + count <= 2 * 1024 * 1024 else { throw NativeOrdinaryContractError.invalid }
                if count == 0 { break }; body.append(contentsOf: buffer.prefix(count))
            }
        }
        defer { body.resetBytes(in: 0..<body.count) }
        let result = try call(["action":"http", "url":try XCTUnwrap(request.url).absoluteString,
            "method":request.httpMethod ?? "GET", "headers":request.allHTTPHeaderFields ?? [:], "bodyBase64":body.base64EncodedString()])
        let status = try XCTUnwrap(result["status"] as? Int)
        let bytes = try XCTUnwrap(Data(base64Encoded:try XCTUnwrap(result["bodyBase64"] as? String)))
        return (try XCTUnwrap(HTTPURLResponse(url:try XCTUnwrap(request.url),statusCode:status,httpVersion:nil,headerFields:["Content-Type":"application/json","Cache-Control":"no-store"])),bytes)
    }
}
private final class NativeDecryptURLProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            guard let handler = Self.handler else { throw NativeOrdinaryContractError.invalid }
            let (response,data) = try handler(request)
            client?.urlProtocol(self,didReceive:response,cacheStoragePolicy:.notAllowed)
            client?.urlProtocol(self,didLoad:data); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self,didFailWithError:error) }
    }
    override func stopLoading() {}
}
@MainActor
final class NativeOrdinaryClientDecryptionTests: XCTestCase {
    typealias F = NativeOrdinaryProjectionDTOTests
    private func flow(_ function: NativeOrdinaryFunction, wrongKey: Bool = false, locked: Bool = false, tamper: Bool = false) async throws {
        let bridge = try NativeDecryptBridge(); defer { NativeDecryptURLProtocol.handler = nil; bridge.close() }
        let key = SymmetricKey(data:Data(repeating:7,count:32)), text = "Fonte clinica esclusivamente sintetica per prova ENC"
        let encrypted = try XCTUnwrap(CryptoService.encryptField(try XCTUnwrap(CryptoService.jsonEncode(text)),masterKey:key))
        let initial = try bridge.call(["action":"init", "ciphertext":encrypted])
        XCTAssertEqual(initial["beforeDenied"] as? Bool,true)
        NativeDecryptURLProtocol.handler = { try bridge.http($0) }
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [NativeDecryptURLProtocol.self]
        let session = URLSession(configuration:config); defer { session.invalidateAndCancel() }
        let client = HomeBasePatientsClient(configuration:HomeBaseConnectionConfiguration(serverURLString:"https://localhost:3443"),session:session)
        let creds = HomeBasePairedCredentials(clientId:"synthetic-client",clientToken:"synthetic-token")
        let cookie = try XCTUnwrap(initial["cookie"] as? String), preparation = F.preparation(function)
        let response = try await client.prepareNativeOrdinary(preparation,credentials:creds,sessionCookie:cookie)
        try response.validate(function:function);let plan = try XCTUnwrap(response.sourceProjection)
        if tamper { _ = try bridge.call(["action":"mutate"]) }
        let liveKey: SymmetricKey? = locked ? nil : wrongKey ? SymmetricKey(data:Data(repeating:9,count:32)) : key
        let connection = ClinicalWorkspaceConnection(dataSource:S6MockDataSource(details:[:]),credentials:creds,sessionCookie:cookie,
            ambulatoryId:"synthetic-ambulatory",masterKey:liveKey,serverURL:"https://localhost:3443",tlsPin:String(repeating:"a",count:64),sessionGeneration:0)
        var failed = false
        do {
            let result = try await NativeOrdinaryProjectionClient.project(plan,preparation:preparation,io:.init(current:{connection},willSubmit:{}),client:client)
            try result.validate(function:function)
            XCTAssertEqual(result.acquisition?.origin,"authenticated_client_decryption")
            XCTAssertEqual(result.acquisition?.ciphertextEquality,"not_attested")
        } catch { failed = true }
        XCTAssertEqual(failed,wrongKey || locked || tamper)
        let stats = try bridge.call(["action":"stats"])
        XCTAssertEqual(stats["admission"] as? Int,failed ? 0 : 1)
        XCTAssertEqual(stats["provider"] as? Int,0);XCTAssertEqual(stats["clinicalWrites"] as? Int,0)
        if failed { XCTAssertEqual(stats["projects"] as? Int,0) }
        else { XCTAssertEqual(stats["reads"] as? Int,1);XCTAssertEqual(stats["projects"] as? Int,1) }
    }
    func testRealSwiftCiphertextHTTPAndCanonicalPI() async throws { try await flow(.patientInsight) }
    func testRealSwiftCiphertextHTTPAndCanonicalSI() async throws { try await flow(.smartImport) }
    func testRealSwiftCiphertextHTTPAndCanonicalTR() async throws { try await flow(.treatmentReasoning) }
    func testWrongKeyNeverProjectsPartialText() async throws { try await flow(.patientInsight,wrongKey:true) }
    func testLockedClientNeverProjects() async throws { try await flow(.patientInsight,locked:true) }
    func testTamperedEnvelopeNeverProjects() async throws { try await flow(.patientInsight,tamper:true) }
}
#endif

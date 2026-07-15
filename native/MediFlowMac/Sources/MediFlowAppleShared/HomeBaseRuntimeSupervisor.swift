// Codex: created 2026-05-02
// @Codex
import Combine
import Foundation
#if os(macOS)
import Darwin
#endif

public struct HomeBaseRuntimeLaunchPlan: Equatable, Sendable {
    public let nodeBinaryPath: String
    public let scriptPath: String
    public let workingDirectory: String?
    public let pidPath: String
    public let logPath: String
    public let environment: [String: String]

    public init(
        nodeBinaryPath: String,
        scriptPath: String,
        workingDirectory: String? = nil,
        pidPath: String,
        logPath: String,
        environment: [String: String]
    ) {
        self.nodeBinaryPath = nodeBinaryPath
        self.scriptPath = scriptPath
        self.workingDirectory = workingDirectory
        self.pidPath = pidPath
        self.logPath = logPath
        self.environment = environment
    }
}

/* @Codex */
struct HomeBaseNodeRuntimeContract: Decodable {
    struct Node: Decodable { let major: Int; let version: String; let moduleVersion: String }
    let node: Node
    let platform: String
    let arch: String
}

@MainActor
public final class HomeBaseRuntimeSupervisor: ObservableObject {
    @Published public private(set) var statusMessage: String?
    @Published public private(set) var errorMessage: String?
    @Published public private(set) var isWorking = false

    #if os(macOS)
    private var managedProxyProcess: Process?
    private var managedBackendProcess: Process?
    #endif
    private let fileManager: FileManager
    private let processInfo: ProcessInfo
    private let stopGraceNanoseconds: UInt64

    public init(
        fileManager: FileManager = .default,
        processInfo: ProcessInfo = .processInfo,
        stopGraceNanoseconds: UInt64 = 1_500_000_000
    ) {
        self.fileManager = fileManager
        self.processInfo = processInfo
        self.stopGraceNanoseconds = stopGraceNanoseconds
    }

    public func startProxy(snapshot: HomeBaseRuntimeSnapshot) async {
        #if os(macOS)
        await runSupervisorAction {
            let plan = try makeLaunchPlan(snapshot: snapshot)
            if Self.isProcessRunning(pidPath: plan.pidPath) {
                statusMessage = "Proxy TLS gia attivo."
                return
            }

            managedProxyProcess = try launchProcess(plan: plan, terminationStatusPrefix: "Proxy TLS")
            statusMessage = "Proxy TLS avviato dalla app."
        }
        #else
        errorMessage = "La supervisione runtime e disponibile solo su macOS."
        #endif
    }

    public func stopProxy(snapshot: HomeBaseRuntimeSnapshot) async {
        #if os(macOS)
        await runSupervisorAction {
            let pidPath = snapshot.proxyPidPath ?? HomeBaseRuntimeStatusLoader
                .defaultDataDirectoryURL(fileManager: fileManager)
                .appendingPathComponent("local-api-tls-proxy.pid")
                .path

            if let managedProxyProcess, managedProxyProcess.isRunning {
                let didStop = await stop(process: managedProxyProcess)
                self.managedProxyProcess = nil
                try? fileManager.removeItem(atPath: pidPath)
                statusMessage = didStop ? "Stop proxy TLS completato." : "Proxy TLS forzato dopo timeout."
                return
            }

            guard let pid = Self.readPid(pidPath: pidPath), Self.isProcessRunning(pid: pid) else {
                try? fileManager.removeItem(atPath: pidPath)
                statusMessage = "Nessun proxy TLS attivo registrato."
                return
            }

            let didStop = await stop(pid: pid)
            try? fileManager.removeItem(atPath: pidPath)
            statusMessage = didStop ? "Stop proxy TLS completato." : "Proxy TLS forzato dopo timeout."
        }
        #else
        errorMessage = "La supervisione runtime e disponibile solo su macOS."
        #endif
    }

    public func startBackend(snapshot: HomeBaseRuntimeSnapshot) async {
        #if os(macOS)
        await runSupervisorAction {
            let plan = try makeBackendLaunchPlan(snapshot: snapshot)
            if Self.isProcessRunning(pidPath: plan.pidPath) {
                statusMessage = "Backend web gia attivo."
                return
            }

            managedBackendProcess = try launchProcess(plan: plan, terminationStatusPrefix: "Backend web")
            statusMessage = "Backend web production avviato dalla app."
        }
        #else
        errorMessage = "La supervisione runtime e disponibile solo su macOS."
        #endif
    }

    public func stopBackend(snapshot: HomeBaseRuntimeSnapshot) async {
        #if os(macOS)
        await runSupervisorAction {
            let pidPath = snapshot.webBackendPidPath

            if let managedBackendProcess, managedBackendProcess.isRunning {
                let didStop = await stop(process: managedBackendProcess)
                self.managedBackendProcess = nil
                try? fileManager.removeItem(atPath: pidPath)
                statusMessage = didStop ? "Stop backend web completato." : "Backend web forzato dopo timeout."
                return
            }

            guard let pid = Self.readPid(pidPath: pidPath), Self.isProcessRunning(pid: pid) else {
                try? fileManager.removeItem(atPath: pidPath)
                statusMessage = "Nessun backend web attivo registrato."
                return
            }

            let didStop = await stop(pid: pid)
            try? fileManager.removeItem(atPath: pidPath)
            statusMessage = didStop ? "Stop backend web completato." : "Backend web forzato dopo timeout."
        }
        #else
        errorMessage = "La supervisione runtime e disponibile solo su macOS."
        #endif
    }

    func makeLaunchPlan(snapshot: HomeBaseRuntimeSnapshot) throws -> HomeBaseRuntimeLaunchPlan {
        let dataDirectory = URL(fileURLWithPath: snapshot.dataDirectory)
        let scriptURL = try proxyScriptURL()
        let nodeBinary = try resolveNodeBinary(contract: bundledNodeContract())
        let port = snapshot.port ?? 3443
        let bindHost = snapshot.bindHost ?? "127.0.0.1"
        let httpTarget = snapshot.httpTarget ?? "http://127.0.0.1:3000"
        let networkMode = snapshot.networkMode ?? "local-only"
        let certPath = snapshot.certPath ?? dataDirectory.appendingPathComponent("certs/local-api.crt").path
        let keyPath = snapshot.keyPath ?? dataDirectory.appendingPathComponent("certs/local-api.key").path
        let pidPath = snapshot.proxyPidPath ?? dataDirectory.appendingPathComponent("local-api-tls-proxy.pid").path
        let logPath = dataDirectory.appendingPathComponent("logs/local-api-tls-proxy.log").path

        guard fileManager.fileExists(atPath: certPath), fileManager.fileExists(atPath: keyPath) else {
            throw HomeBaseRuntimeSupervisorError.missingTLSMaterial
        }

        return HomeBaseRuntimeLaunchPlan(
            nodeBinaryPath: nodeBinary,
            scriptPath: scriptURL.path,
            pidPath: pidPath,
            logPath: logPath,
            environment: [
                "MEDIFLOW_TLS_CERT_PATH": certPath,
                "MEDIFLOW_TLS_KEY_PATH": keyPath,
                "MEDIFLOW_TLS_PORT": String(port),
                "MEDIFLOW_HTTP_TARGET": httpTarget,
                "MEDIFLOW_TLS_BIND_HOST": bindHost,
                "MEDIFLOW_TLS_NETWORK_MODE": networkMode
            ]
        )
    }

    func makeBackendLaunchPlan(snapshot: HomeBaseRuntimeSnapshot) throws -> HomeBaseRuntimeLaunchPlan {
        let dataDirectory = URL(fileURLWithPath: snapshot.dataDirectory)
        let webRuntimeURL = try webRuntimeURL()
        let serverURL = webRuntimeURL.appendingPathComponent("server.js")
        let nodeBinary = try resolveNodeBinary(contract: bundledNodeContract())
        let pidPath = snapshot.webBackendPidPath
        let logPath = dataDirectory.appendingPathComponent("logs/local-web-backend.log").path

        guard fileManager.fileExists(atPath: serverURL.path) else {
            throw HomeBaseRuntimeSupervisorError.missingWebRuntime
        }

        return HomeBaseRuntimeLaunchPlan(
            nodeBinaryPath: nodeBinary,
            scriptPath: serverURL.path,
            workingDirectory: webRuntimeURL.path,
            pidPath: pidPath,
            logPath: logPath,
            environment: [
                "HOSTNAME": "127.0.0.1",
                "NODE_ENV": "production",
                "PORT": "3000",
                "MEDIFLOW_DATA_DIR": snapshot.dataDirectory
            ]
        )
    }

    private func proxyScriptURL() throws -> URL {
        if let resourceURL = Bundle.main.url(forResource: "local-api-tls-proxy", withExtension: "mjs") {
            return resourceURL
        }
        throw HomeBaseRuntimeSupervisorError.missingProxyScript
    }

    private func webRuntimeURL() throws -> URL {
        if let resourceURL = Bundle.main.resourceURL?.appendingPathComponent("WebRuntime"),
           fileManager.fileExists(atPath: resourceURL.path) {
            return resourceURL
        }
        throw HomeBaseRuntimeSupervisorError.missingWebRuntime
    }

    private func bundledNodeContract() throws -> HomeBaseNodeRuntimeContract {
        let url = try webRuntimeURL().appendingPathComponent("mediflow-runtime-contract.json")
        guard let data = try? Data(contentsOf: url),
              let contract = try? JSONDecoder().decode(HomeBaseNodeRuntimeContract.self, from: data) else {
            throw HomeBaseRuntimeSupervisorError.missingRuntimeContract
        }
        return contract
    }

    #if os(macOS)
    private func launchProcess(plan: HomeBaseRuntimeLaunchPlan, terminationStatusPrefix: String) throws -> Process {
        try fileManager.createDirectory(
            at: URL(fileURLWithPath: plan.logPath).deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        fileManager.createFile(atPath: plan.logPath, contents: nil)
        let logHandle = try FileHandle(forWritingTo: URL(fileURLWithPath: plan.logPath))
        try logHandle.seekToEnd()

        let process = Process()
        process.executableURL = URL(fileURLWithPath: plan.nodeBinaryPath)
        process.arguments = [plan.scriptPath]
        if let workingDirectory = plan.workingDirectory {
            process.currentDirectoryURL = URL(fileURLWithPath: workingDirectory)
        }
        process.environment = processInfo.environment.merging(plan.environment) { _, new in new }
        process.standardOutput = logHandle
        process.standardError = logHandle
        process.terminationHandler = { [weak self] process in
            Task { @MainActor in
                guard let self else { return }
                self.statusMessage = "\(terminationStatusPrefix) terminato con codice \(process.terminationStatus)."
                try? logHandle.close()
            }
        }

        try process.run()
        try "\(process.processIdentifier)\n".write(toFile: plan.pidPath, atomically: true, encoding: .utf8)
        return process
    }
    #endif

    private func resolveNodeBinary(contract: HomeBaseNodeRuntimeContract) throws -> String {
        if let override = processInfo.environment["MEDIFLOW_NODE_BINARY"],
           fileManager.isExecutableFile(atPath: override) {
            guard Self.compatibleNode(in: [override], contract: contract, fileManager: fileManager) != nil else {
                throw HomeBaseRuntimeSupervisorError.incompatibleNode(contract.node.major, contract.node.moduleVersion)
            }
            return override
        }

        var candidates = [
            "/opt/homebrew/opt/node@\(contract.node.major)/bin/node",
            "/usr/local/opt/node@\(contract.node.major)/bin/node",
            "/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"
        ]

        // Version managers (nvm, fnm) install node outside the standard paths, and
        // a GUI-launched app does not inherit the shell PATH. Probe their dirs and
        // pick the newest installed node, so the home-base works without manual
        // MEDIFLOW_NODE_BINARY config. macOS-only: homeDirectoryForCurrentUser is
        // unavailable on iOS, and node supervision only runs on macOS anyway.
        #if os(macOS)
        let home = fileManager.homeDirectoryForCurrentUser
        let versionDirs = [
            home.appendingPathComponent(".nvm/versions/node"),
            home.appendingPathComponent(".local/share/fnm/node-versions")
        ]
        candidates.append(contentsOf: Self.versionManagerNodes(in: versionDirs, fileManager: fileManager))
        #endif

        guard let compatible = Self.compatibleNode(in: candidates, contract: contract, fileManager: fileManager) else {
            throw HomeBaseRuntimeSupervisorError.incompatibleNode(contract.node.major, contract.node.moduleVersion)
        }
        return compatible
    }

    /// Returns the path to the highest-version `node` under nvm/fnm version dirs,
    /// or nil if none. nonisolated + static so it is pure and unit-testable.
    nonisolated static func newestVersionManagerNode(in versionDirs: [URL], fileManager: FileManager) -> String? {
        versionManagerNodes(in: versionDirs, fileManager: fileManager).first
    }

    nonisolated static func versionManagerNodes(in versionDirs: [URL], fileManager: FileManager) -> [String] {
        var candidates: [(version: [Int], path: String)] = []
        for dir in versionDirs {
            guard let entries = try? fileManager.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) else {
                continue
            }
            for entry in entries {
                // nvm: <ver>/bin/node ; fnm: <ver>/installation/bin/node
                for relative in ["bin/node", "installation/bin/node"] {
                    let nodePath = entry.appendingPathComponent(relative).path
                    if fileManager.isExecutableFile(atPath: nodePath) {
                        candidates.append((semanticVersion(entry.lastPathComponent), nodePath))
                    }
                }
            }
        }
        return candidates.sorted { $1.version.lexicographicallyPrecedes($0.version) }.map(\.path)
    }

    nonisolated static func compatibleNode(
        in candidates: [String], contract: HomeBaseNodeRuntimeContract, fileManager: FileManager
    ) -> String? {
        #if os(macOS)
        candidates.first { path in
            guard fileManager.isExecutableFile(atPath: path) else { return false }
            let process = Process()
            let pipe = Pipe()
            process.executableURL = URL(fileURLWithPath: path)
            process.arguments = [
                "-p",
                "[process.versions.node,process.versions.modules,process.platform,process.arch].join(' ')"
            ]
            process.standardOutput = pipe
            process.standardError = FileHandle.nullDevice
            guard (try? process.run()) != nil else { return false }
            process.waitUntilExit()
            let output = String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
                .trimmingCharacters(in: .whitespacesAndNewlines).split(separator: " ")
            return process.terminationStatus == 0 && output.count == 4 &&
                Int(output[0].split(separator: ".").first ?? "") == contract.node.major &&
                output[1] == contract.node.moduleVersion &&
                output[2] == contract.platform && output[3] == contract.arch
        }
        #else
        nil
        #endif
    }

    /// Parses a "vX.Y.Z" directory name into [X, Y, Z] for numeric comparison.
    nonisolated static func semanticVersion(_ name: String) -> [Int] {
        name.drop(while: { !$0.isNumber })
            .split(separator: ".")
            .map { Int($0.prefix(while: { $0.isNumber })) ?? 0 }
    }

    private func runSupervisorAction(_ action: () async throws -> Void) async {
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            try await action()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    #if os(macOS)
    private func stop(process: Process) async -> Bool {
        process.terminate()
        let didStop = await Self.waitUntilExited(process: process, timeoutNanoseconds: stopGraceNanoseconds)
        if !didStop {
            _ = kill(process.processIdentifier, SIGKILL)
            return await Self.waitUntilExited(process: process, timeoutNanoseconds: 500_000_000)
        }
        return true
    }

    private func stop(pid: pid_t) async -> Bool {
        _ = kill(pid, SIGTERM)
        let didStop = await Self.waitUntilExited(pid: pid, timeoutNanoseconds: stopGraceNanoseconds)
        if !didStop {
            _ = kill(pid, SIGKILL)
            return await Self.waitUntilExited(pid: pid, timeoutNanoseconds: 500_000_000)
        }
        return true
    }

    private static func waitUntilExited(process: Process, timeoutNanoseconds: UInt64) async -> Bool {
        let deadline = DispatchTime.now().uptimeNanoseconds + timeoutNanoseconds
        while process.isRunning && DispatchTime.now().uptimeNanoseconds < deadline {
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        return !process.isRunning
    }

    private static func waitUntilExited(pid: pid_t, timeoutNanoseconds: UInt64) async -> Bool {
        let deadline = DispatchTime.now().uptimeNanoseconds + timeoutNanoseconds
        while isProcessRunning(pid: pid) && DispatchTime.now().uptimeNanoseconds < deadline {
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        return !isProcessRunning(pid: pid)
    }
    #endif

    private static func readPid(pidPath: String) -> pid_t? {
        guard let raw = try? String(contentsOfFile: pidPath, encoding: .utf8),
              let value = Int32(raw.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            return nil
        }
        return value
    }

    private static func isProcessRunning(pidPath: String) -> Bool {
        guard let pid = readPid(pidPath: pidPath) else { return false }
        return isProcessRunning(pid: pid)
    }

    private static func isProcessRunning(pid: pid_t) -> Bool {
        #if os(macOS)
        return kill(pid, 0) == 0
        #else
        return false
        #endif
    }
}

public enum HomeBaseRuntimeSupervisorError: LocalizedError, Equatable {
    case missingTLSMaterial
    case missingProxyScript
    case missingWebRuntime
    case missingRuntimeContract
    case incompatibleNode(Int, String)
    case missingNode

    public var errorDescription: String? {
        switch self {
        case .missingTLSMaterial:
            return "Certificato o chiave TLS mancanti. Esegui prima il setup nativo."
        case .missingProxyScript:
            return "Script proxy TLS non incluso nel bundle."
        case .missingWebRuntime:
            return "Runtime web standalone non incluso nel bundle. Ricompila la app con lo script nativo."
        case .missingRuntimeContract:
            return "Contratto Node/ABI del runtime web mancante. Ricompila il bundle senza riusare artefatti obsoleti."
        case .incompatibleNode(let major, let abi):
            return "Node \(major).x con ABI \(abi) non trovato. Installa la versione richiesta dal bundle o configura MEDIFLOW_NODE_BINARY."
        case .missingNode:
            return "Node.js non trovato. Configura MEDIFLOW_NODE_BINARY o installa Node in un percorso standard."
        }
    }
}

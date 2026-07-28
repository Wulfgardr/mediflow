#!/usr/bin/env swift
/* @Codex */

import AppKit
import ApplicationServices
import Foundation

struct ProbeFailure: Error, CustomStringConvertible {
    let message: String

    var description: String { message }
}

struct ProbeReport {
    var checks: [String] = []

    mutating func pass(_ message: String) {
        let line = "PASS  \(message)"
        checks.append(line)
        FileHandle.standardOutput.write(Data("\(line)\n".utf8))
    }

    mutating func fail(_ message: String) {
        checks.append("FAIL  \(message)")
    }
}

func argumentValue(after flag: String) -> String? {
    guard let index = CommandLine.arguments.firstIndex(of: flag),
          CommandLine.arguments.indices.contains(index + 1) else {
        return nil
    }
    return CommandLine.arguments[index + 1]
}

func screenIsLocked() -> Bool {
    guard let session = CGSessionCopyCurrentDictionary() as? [String: Any] else {
        return false
    }
    return session["CGSSessionScreenIsLocked"] as? Bool ?? false
}

func attribute(_ element: AXUIElement, _ name: String) -> AnyObject? {
    var value: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(element, name as CFString, &value)
    guard result == .success else { return nil }
    return value as AnyObject
}

func children(of element: AXUIElement) -> [AXUIElement] {
    attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? []
}

/* @Codex */
func parent(of element: AXUIElement) -> AXUIElement? {
    guard let value = attribute(element, kAXParentAttribute) else { return nil }
    return (value as! AXUIElement)
}

func identifier(of element: AXUIElement) -> String {
    attribute(element, "AXIdentifier") as? String ?? ""
}

func descriptionValue(of element: AXUIElement) -> String {
    attribute(element, kAXDescriptionAttribute) as? String ?? ""
}

func value(of element: AXUIElement) -> String {
    attribute(element, kAXValueAttribute) as? String ?? ""
}

func role(of element: AXUIElement) -> String {
    attribute(element, kAXRoleAttribute) as? String ?? ""
}

/* @Codex */
func roleDescription(of element: AXUIElement) -> String {
    attribute(element, kAXRoleDescriptionAttribute) as? String ?? ""
}

/* @Codex */
func elementAttribute(_ element: AXUIElement, _ name: String) -> AXUIElement? {
    guard let value = attribute(element, name) else { return nil }
    return (value as! AXUIElement)
}

/* @Codex */
func numericValue(of element: AXUIElement) -> Double? {
    (attribute(element, kAXValueAttribute) as? NSNumber)?.doubleValue
}

/* @Codex */
func nativeList(in element: AXUIElement) -> AXUIElement? {
    let nativeListRoles = [kAXOutlineRole as String, kAXTableRole as String, "AXList"]
    return findElement(in: element, where: { nativeListRoles.contains(role(of: $0)) })
}

func title(of element: AXUIElement) -> String {
    attribute(element, kAXTitleAttribute) as? String ?? ""
}

func findElement(in element: AXUIElement, where predicate: (AXUIElement) -> Bool) -> AXUIElement? {
    var queue = [element]
    var index = 0
    var visited = Set<AXUIElement>()
    while index < queue.count {
        let candidate = queue[index]
        index += 1
        guard visited.insert(candidate).inserted else { continue }
        if predicate(candidate) {
            return candidate
        }
        queue.append(contentsOf: children(of: candidate))
    }
    return nil
}

func collectElements(in element: AXUIElement, where predicate: (AXUIElement) -> Bool, into output: inout [AXUIElement]) {
    var queue = [element]
    var index = 0
    var visited = Set<AXUIElement>()
    while index < queue.count {
        let candidate = queue[index]
        index += 1
        guard visited.insert(candidate).inserted else { continue }
        if predicate(candidate) {
            output.append(candidate)
        }
        queue.append(contentsOf: children(of: candidate))
    }
}

@discardableResult
func press(_ element: AXUIElement) -> Bool {
    AXUIElementPerformAction(element, kAXPressAction as CFString) == .success
}

func runningApp() throws -> NSRunningApplication {
    if let appPath = argumentValue(after: "--app-path") {
        let expectedExecutable = URL(fileURLWithPath: appPath)
            .appendingPathComponent("Contents/MacOS/MediFlow")
            .standardizedFileURL
        let matches = NSWorkspace.shared.runningApplications.filter {
            $0.executableURL?.standardizedFileURL == expectedExecutable
        }
        guard matches.count == 1, let app = matches.first else {
            throw ProbeFailure(
                message: "Expected exactly one running MediFlow at \(appPath); found \(matches.count)."
            )
        }
        return app
    }

    let matches = NSRunningApplication.runningApplications(withBundleIdentifier: "com.mediflow.mobile")
    guard matches.count == 1, let app = matches.first else {
        throw ProbeFailure(
            message: "Expected exactly one running MediFlow; found \(matches.count). Pass --app-path to select the P6 bundle."
        )
    }
    return app
}

func appWindow(for app: NSRunningApplication, timeout: TimeInterval = 5.0) throws -> AXUIElement {
    let deadline = Date().addingTimeInterval(timeout)
    repeat {
        let appElement = AXUIElementCreateApplication(app.processIdentifier)
        if let windows = attribute(appElement, kAXWindowsAttribute) as? [AXUIElement],
           let window = windows.first {
            return window
        }
        RunLoop.current.run(until: Date().addingTimeInterval(0.2))
    } while Date() < deadline

    throw ProbeFailure(message: "Unable to resolve the first MediFlow window via AX.")
}

func requireIdentifier(_ identifierName: String, in window: AXUIElement, report: inout ProbeReport) throws {
    guard findElement(in: window, where: { identifier(of: $0) == identifierName }) != nil else {
        report.fail("Missing identifier \(identifierName)")
        throw ProbeFailure(message: "Missing identifier \(identifierName)")
    }

    report.pass("Identifier \(identifierName)")
}

func requireIdentifierOrLabel(
    identifierName: String,
    label: String,
    in element: AXUIElement,
    report: inout ProbeReport
) throws {
    let match = findElement(in: element) { candidate in
        identifier(of: candidate) == identifierName
            || descriptionValue(of: candidate) == label
            || value(of: candidate) == label
            || title(of: candidate) == label
    }

    guard match != nil else {
        report.fail("Missing identifier \(identifierName) or AX label \(label)")
        throw ProbeFailure(message: "Missing identifier \(identifierName) or AX label \(label)")
    }

    report.pass("Identifier/label \(identifierName)")
}

func windowContainsHomeBaseShell(_ window: AXUIElement) -> Bool {
    findElement(in: window, where: { identifier(of: $0) == "homebase-runtime-status-card" }) != nil
}

// @Codex: WUL-401 P6 preparatory coverage for the universal clinical shell.
func windowContainsClinicalShell(_ window: AXUIElement) -> Bool {
    findElement(in: window, where: {
        identifier(of: $0).hasPrefix("clinical-workspace-section-")
            || identifier(of: $0).hasPrefix("clinical-workspace-") && identifier(of: $0).hasSuffix("-view")
    }) != nil
}

func waitForIdentifier(
    _ identifierName: String,
    in app: NSRunningApplication,
    timeout: TimeInterval = 5.0
) -> AXUIElement? {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        if let window = try? appWindow(for: app),
           let match = findElement(in: window, where: { identifier(of: $0) == identifierName }) {
            return match
        }
        RunLoop.current.run(until: Date().addingTimeInterval(0.2))
    }
    return nil
}

func openClinicalSection(
    _ section: String,
    expectedView: String,
    app: NSRunningApplication,
    report: inout ProbeReport
) throws {
    guard let window = try? appWindow(for: app),
          let sectionLabel = findElement(in: window, where: {
              identifier(of: $0) == "clinical-workspace-section-\(section)-button"
          }),
          let sidebar = findElement(in: window, where: {
              identifier(of: $0) == "clinical-workspace-project-sidebar"
          }),
          let sectionList = nativeList(in: sidebar) else {
        report.fail("Unable to open clinical section \(section)")
        throw ProbeFailure(message: "Unable to open clinical section \(section)")
    }

    // @Codex: SwiftUI attaches this identifier to the AXStaticText inside the
    // List row. AXPress reports success for that static text but does not move
    // the List selection; select its owning AXRow through the AXOutline instead.
    guard selectPatientRow(sectionLabel, within: sectionList) else {
        report.fail("Unable to open clinical section \(section)")
        throw ProbeFailure(message: "Unable to open clinical section \(section)")
    }

    guard waitFor(condition: {
        selectedItemsContain("clinical-workspace-section-\(section)-button", list: sectionList)
    }) else {
        report.fail("Clinical section \(section) did not become selected")
        throw ProbeFailure(message: "Clinical section \(section) did not become selected")
    }

    guard waitForIdentifier(expectedView, in: app) != nil else {
        report.fail("Clinical section \(section) did not expose \(expectedView)")
        throw ProbeFailure(message: "Clinical section \(section) did not expose \(expectedView)")
    }
    report.pass("Opened clinical section \(section)")
}

/* @Codex */
func selectPatientRow(_ row: AXUIElement, within list: AXUIElement) -> Bool {
    var rowCandidates: [AXUIElement] = []
    var candidate: AXUIElement? = row
    for _ in 0..<8 {
        guard let element = candidate else { return false }
        if CFEqual(element, list) {
            break
        }
        rowCandidates.append(element)
        candidate = parent(of: element)
    }

    guard let boundary = candidate,
          CFEqual(boundary, list),
          let nativeRow = rowCandidates.last else {
        return false
    }

    let selectionAttribute: String
    switch role(of: list) {
    case kAXOutlineRole, kAXTableRole:
        selectionAttribute = kAXSelectedRowsAttribute
    case "AXList":
        selectionAttribute = kAXSelectedChildrenAttribute
    default:
        return false
    }

    if AXUIElementSetAttributeValue(
        list,
        selectionAttribute as CFString,
        [nativeRow] as CFArray
    ) == .success {
        return true
    }

    if AXUIElementSetAttributeValue(
        nativeRow,
        kAXSelectedAttribute as CFString,
        kCFBooleanTrue
    ) == .success {
        return true
    }
    return press(nativeRow)
}

/* @Codex */
func selectedItemsContain(_ identifierName: String, list: AXUIElement) -> Bool {
    let selectionAttribute: String
    switch role(of: list) {
    case kAXOutlineRole, kAXTableRole:
        selectionAttribute = kAXSelectedRowsAttribute
    case "AXList":
        selectionAttribute = kAXSelectedChildrenAttribute
    default:
        return false
    }
    guard let selectedItems = attribute(list, selectionAttribute) as? [AXUIElement] else {
        return false
    }
    return selectedItems.contains { item in
        findElement(in: item, where: { identifier(of: $0) == identifierName }) != nil
    }
}

/* @Codex */
func detailNameMatches(_ expected: String, app: NSRunningApplication) -> Bool {
    guard let window = try? appWindow(for: app),
          // @Codex: `patient-detail-name` is intentionally iOS-only. macOS
          // owns the title/toolbar chrome and exposes this persistent header as
          // the canonical selected-patient AX surface.
          let detailHeader = findElement(in: window, where: {
              identifier(of: $0) == "patient-workspace-header"
          }) else {
        return false
    }
    return [descriptionValue(of: detailHeader), value(of: detailHeader), title(of: detailHeader)]
        .contains(where: { $0.contains(expected) })
}

/* @Codex */
func workspaceHeader(
    exposing expectedName: String,
    app: NSRunningApplication
) -> (header: AXUIElement, detail: AXUIElement)? {
    guard let window = try? appWindow(for: app),
          let detail = findElement(in: window, where: {
              identifier(of: $0) == "patient-workspace-detail"
          }) else {
        return nil
    }

    var headers: [AXUIElement] = []
    collectElements(in: window, where: {
        identifier(of: $0) == "patient-workspace-header"
    }, into: &headers)
    guard headers.count == 1, let header = headers.first else { return nil }

    let exposedText = [descriptionValue(of: header), value(of: header), title(of: header)]
    guard exposedText.contains(where: { $0.contains(expectedName) }) else { return nil }
    return (header, detail)
}

/* @Codex */
func dumpWorkspaceHeaderAX(exposing expectedName: String, app: NSRunningApplication) {
    guard let header = workspaceHeader(exposing: expectedName, app: app)?.header else {
        print("AX DUMP patient-workspace-header unavailable")
        return
    }

    var copiedNames: CFArray?
    guard AXUIElementCopyAttributeNames(header, &copiedNames) == .success,
          let names = copiedNames as? [String] else {
        print("AX DUMP patient-workspace-header attribute names unavailable")
        return
    }

    print("AX DUMP patient-workspace-header BEGIN")
    for name in names.sorted() {
        guard let value = attribute(header, name) else { continue }
        print("\(name)=\(String(describing: value))")
    }
    print("AX DUMP patient-workspace-header END")
}

/* @Codex */
struct WorkspaceHeaderAXContract {
    let role: String
    let roleDescription: String
    let headingLevel: Int?
}

/* @Codex
 SwiftUI's accessibilityHeading(_:) sets a semantic heading level; on macOS it
 does not promise that the element's raw role is AXHeading. AXHeadingLevel is
 public only from macOS 26, so macOS 14 may expose neither raw heading signal.
 Keep name and autonomy as hard requirements, and validate level 1 whenever the
 runtime does expose heading-level metadata.
 */
func workspaceHeaderAXContract(
    exposing expectedName: String,
    app: NSRunningApplication
) -> WorkspaceHeaderAXContract? {
    guard let snapshot = workspaceHeader(exposing: expectedName, app: app),
          !CFEqual(snapshot.header, snapshot.detail),
          children(of: snapshot.header).isEmpty else {
        return nil
    }

    let headingLevel = (attribute(snapshot.header, "AXHeadingLevel") as? NSNumber)?.intValue
    guard headingLevel == nil || headingLevel == 1 else { return nil }
    return WorkspaceHeaderAXContract(
        role: role(of: snapshot.header),
        roleDescription: roleDescription(of: snapshot.header),
        headingLevel: headingLevel
    )
}

/* @Codex */
func simulatePatientDetailScroll(app: NSRunningApplication) -> Bool {
    guard let window = try? appWindow(for: app),
          let detail = findElement(in: window, where: {
              identifier(of: $0) == "patient-workspace-detail"
          }) else {
        return false
    }

    let scrollArea = role(of: detail) == kAXScrollAreaRole as String
        ? detail
        : findElement(in: detail, where: { role(of: $0) == kAXScrollAreaRole as String })
    let scrollBar = scrollArea.flatMap {
        elementAttribute($0, kAXVerticalScrollBarAttribute as String)
    }
    guard let scrollBar, let initialValue = numericValue(of: scrollBar) else { return false }
    let targetValue = min(1, max(0.75, initialValue + 0.5))
    guard targetValue > initialValue + 0.01,
          AXUIElementSetAttributeValue(
              scrollBar,
              kAXValueAttribute as CFString,
              NSNumber(value: targetValue)
          ) == .success else {
        return false
    }
    return waitFor(condition: {
        guard let currentValue = numericValue(of: scrollBar) else { return false }
        return currentValue > initialValue + 0.01
    })
}

/* @Codex */
func waitForPatientRow(
    _ identifierName: String,
    in app: NSRunningApplication,
    timeout: TimeInterval = 5.0
) -> (list: AXUIElement, row: AXUIElement)? {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        if let window = try? appWindow(for: app),
           let listContainer = findElement(in: window, where: {
               identifier(of: $0) == "patients-selection-list"
           }),
           let patientList = nativeList(in: listContainer),
           let patientRow = findElement(in: patientList, where: {
               identifier(of: $0) == identifierName
           }) {
            return (patientList, patientRow)
        }
        RunLoop.current.run(until: Date().addingTimeInterval(0.2))
    }
    return nil
}

/* @Codex */
func runPatientWorkspaceHeaderProbe(app: NSRunningApplication, report: inout ProbeReport) throws {
    try openClinicalSection("patients", expectedView: "patients-selection-list", app: app, report: &report)

    guard let firstPatient = waitForPatientRow("patient-cell-uitest-1", in: app) else {
        report.fail("Missing first synthetic patient row after AX materialization")
        throw ProbeFailure(message: "Missing first synthetic patient row after AX materialization")
    }
    let patientList = firstPatient.list
    let firstPatientRow = firstPatient.row
    report.pass("Native patient list role \(role(of: patientList))")
    report.pass("Resolved first synthetic patient row")

    guard selectPatientRow(firstPatientRow, within: patientList) else {
        report.fail("Unable to select the first patient row through the native list")
        throw ProbeFailure(message: "Unable to select the first patient row through the native list")
    }
    report.pass("Requested first patient selection through the native list")

    guard waitFor(condition: {
        selectedItemsContain("patient-cell-uitest-1", list: patientList)
    }) else {
        report.fail("The native list did not expose the first selected row")
        throw ProbeFailure(message: "The first patient row was not selected in the AX tree.")
    }
    report.pass("Native list selected the first patient")

    guard waitFor(condition: {
        detailNameMatches("Rossi Mario", app: app)
    }) else {
        report.fail("Unable to open the first patient detail")
        throw ProbeFailure(message: "Unable to open the first patient detail")
    }
    report.pass("Selected first patient and opened matching detail")

    guard waitFor(condition: {
        workspaceHeader(exposing: "Rossi Mario", app: app) != nil
    }) else {
        report.fail("Patient workspace header did not expose Rossi Mario")
        throw ProbeFailure(message: "Patient workspace header did not expose the selected patient name.")
    }
    report.pass("Patient workspace header exposes Rossi Mario")

    if CommandLine.arguments.contains("--dump-patient-header-ax") {
        dumpWorkspaceHeaderAX(exposing: "Rossi Mario", app: app)
    }

    guard let headerAX = workspaceHeaderAXContract(exposing: "Rossi Mario", app: app) else {
        report.fail("Patient workspace header does not satisfy the autonomous native AX contract")
        throw ProbeFailure(message: "Patient workspace header does not satisfy the autonomous native AX contract.")
    }
    let headingLevel = headerAX.headingLevel.map(String.init) ?? "not exposed"
    report.pass(
        "Patient workspace header is autonomous: role \(headerAX.role), "
            + "role description \(headerAX.roleDescription), heading level \(headingLevel)"
    )

    guard simulatePatientDetailScroll(app: app) else {
        report.fail("Unable to simulate patient detail scroll")
        throw ProbeFailure(message: "Unable to simulate patient detail scroll through AX.")
    }
    report.pass("Simulated patient detail scroll through AX")

    guard waitFor(condition: {
        workspaceHeader(exposing: "Rossi Mario", app: app) != nil
    }) else {
        report.fail("Patient workspace header disappeared after detail scroll")
        throw ProbeFailure(message: "Patient workspace header disappeared after detail scroll.")
    }
    report.pass("Patient workspace header remains exposed after detail scroll")
}

func runClinicalShellProbe(app: NSRunningApplication, report: inout ProbeReport) throws {
    let sectionChecks = [
        ("patients", "patients-selection-list"),
        ("agenda", "clinical-workspace-agenda-view"),
        ("diary", "clinical-workspace-diary-view"),
        ("analytics", "clinical-workspace-analytics-view"),
        ("scales", "clinical-workspace-scales-view"),
        ("settings", "clinical-workspace-settings-view"),
        ("runtime", "apple-foundation-runtime-view"),
        ("overview", "apple-foundation-overview-view"),
        ("milestones", "apple-foundation-milestones-view"),
    ]

    for (section, expectedView) in sectionChecks {
        try openClinicalSection(section, expectedView: expectedView, app: app, report: &report)
    }
    try runPatientWorkspaceHeaderProbe(app: app, report: &report)

    guard let secondPatient = waitForPatientRow("patient-cell-uitest-2", in: app) else {
        report.fail("Missing second synthetic patient row after AX materialization")
        throw ProbeFailure(message: "Missing second synthetic patient row after AX materialization")
    }
    let secondPatientList = secondPatient.list
    let secondPatientRow = secondPatient.row
    report.pass("Resolved second synthetic patient row")

    guard selectPatientRow(secondPatientRow, within: secondPatientList) else {
        report.fail("Unable to select the second patient row through the native list")
        throw ProbeFailure(message: "Unable to select the second patient row through the native list")
    }
    report.pass("Requested second patient selection through the native list")

    guard waitFor(condition: {
        selectedItemsContain("patient-cell-uitest-2", list: secondPatientList)
    }) else {
        report.fail("Unable to move selection to the second patient")
        throw ProbeFailure(message: "The second patient row was not selected in the AX tree.")
    }
    report.pass("Native list selected the second patient")

    guard waitFor(condition: {
        detailNameMatches("Bianchi Anna", app: app)
    }) else {
        report.fail("The second patient detail did not match the native selection")
        throw ProbeFailure(message: "A -> B selection did not expose the matching detail.")
    }
    report.pass("Moved native selection A -> B with matching detail")

    let moduleIdentifiers = [
        "patient-clinical-signals",
        "homebase-refresh-entries-button",
        "homebase-new-entry-content-field",
        "homebase-refresh-therapies-button",
        "homebase-refresh-checkups-button",
        "homebase-refresh-observations-button",
    ]
    for identifierName in moduleIdentifiers {
        guard waitForIdentifier(identifierName, in: app) != nil else {
            report.fail("Missing patient module identifier \(identifierName)")
            throw ProbeFailure(message: "Missing patient module identifier \(identifierName)")
        }
        report.pass("Patient module identifier \(identifierName)")
    }
}

func runHomeBaseShellProbe(app: NSRunningApplication, window: AXUIElement, report: inout ProbeReport) throws {
    try requireIdentifier("apple-foundation-overview-view", in: window, report: &report)
    try requireIdentifier("homebase-runtime-status-card", in: window, report: &report)
    try requireIdentifierOrLabel(
        identifierName: "homebase-runtime-refresh-button",
        label: "Aggiorna",
        in: window,
        report: &report
    )
    try requireIdentifierOrLabel(identifierName: "homebase-runtime-component-native-config", label: "Configurazione nativa", in: window, report: &report)
    try requireIdentifierOrLabel(identifierName: "homebase-runtime-component-local-token", label: "Token locale", in: window, report: &report)
    try requireIdentifierOrLabel(identifierName: "homebase-runtime-component-tls-proxy", label: "Proxy TLS", in: window, report: &report)
    try requireIdentifierOrLabel(identifierName: "homebase-runtime-component-web-backend", label: "Backend web", in: window, report: &report)
    try requireIdentifierOrLabel(identifierName: "homebase-runtime-optional-section", label: "Servizi opzionali", in: window, report: &report)

    guard let modulesButton = findElement(in: window, where: {
        identifier(of: $0) == "apple-foundation-section-modules-button"
            || descriptionValue(of: $0) == "Pazienti"
            || value(of: $0) == "Pazienti"
            || title(of: $0) == "Pazienti"
    }),
          press(modulesButton) else {
        report.fail("Unable to open home-base modules section")
        throw ProbeFailure(message: "Unable to open home-base modules section")
    }
    report.pass("Opened home-base modules section")

    let didOpenModules = waitFor {
        guard let moduleWindow = try? appWindow(for: app) else { return false }
        return findElement(in: moduleWindow, where: { identifier(of: $0) == "homebase-server-url-field" }) != nil
    }
    guard didOpenModules, let moduleWindow = try? appWindow(for: app) else {
        report.fail("Home-base modules section did not expose paired workspace")
        throw ProbeFailure(message: "Home-base modules section did not expose paired workspace")
    }

    try requireIdentifier("apple-foundation-modules-view", in: moduleWindow, report: &report)
    try requireIdentifierOrLabel(identifierName: "homebase-server-url-field", label: "Server home-base", in: moduleWindow, report: &report)
    try requireIdentifierOrLabel(identifierName: "homebase-tls-pin-field", label: "TLS pin", in: moduleWindow, report: &report)
    try requireIdentifierOrLabel(identifierName: "homebase-discover-button", label: "Scopri home-base", in: moduleWindow, report: &report)
    try requireIdentifierOrLabel(identifierName: "homebase-paired-client-id-field", label: "Paired client ID", in: moduleWindow, report: &report)
    try requireIdentifierOrLabel(identifierName: "homebase-paired-client-token-field", label: "Paired client token", in: moduleWindow, report: &report)
    try requireIdentifierOrLabel(identifierName: "homebase-username-field", label: "Utente", in: moduleWindow, report: &report)
    try requireIdentifierOrLabel(identifierName: "homebase-password-field", label: "PIN", in: moduleWindow, report: &report)
    try requireIdentifierOrLabel(identifierName: "homebase-ambulatory-field", label: "Ambulatorio", in: moduleWindow, report: &report)
    try requireIdentifierOrLabel(identifierName: "homebase-login-button", label: "Login operatore", in: moduleWindow, report: &report)
    try requireIdentifierOrLabel(identifierName: "homebase-load-patients-button", label: "Carica pazienti", in: moduleWindow, report: &report)
    try requireIdentifierOrLabel(identifierName: "homebase-save-pairing-button", label: "Salva pairing", in: moduleWindow, report: &report)
    try requireIdentifierOrLabel(identifierName: "homebase-clear-pairing-button", label: "Pulisci pairing", in: moduleWindow, report: &report)
}

func firstPatientRow(in window: AXUIElement) throws -> AXUIElement {
    var matches: [AXUIElement] = []
    collectElements(in: window, where: { identifier(of: $0).hasPrefix("patient-row-") }, into: &matches)
    guard let row = matches.first else {
        throw ProbeFailure(message: "No patient-row-* AX identifier found in the current window.")
    }
    return row
}

func firstSheet(in window: AXUIElement) -> AXUIElement? {
    children(of: window).first(where: { role(of: $0) == kAXSheetRole })
}

func waitFor(
    timeout: TimeInterval = 5.0,
    interval: TimeInterval = 0.2,
    condition: () -> Bool
) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        if condition() {
            return true
        }
        RunLoop.current.run(until: Date().addingTimeInterval(interval))
    }
    return condition()
}

func closeSheetIfPresent(in app: NSRunningApplication) {
    guard let window = try? appWindow(for: app),
          let sheet = firstSheet(in: window),
          let closeButton = findElement(in: sheet, where: { descriptionValue(of: $0) == "Chiudi" || identifier(of: $0) == "xmark" }) else {
        return
    }

    _ = press(closeButton)
    _ = waitFor {
        guard let window = try? appWindow(for: app) else { return true }
        return firstSheet(in: window) == nil
    }
}

func requireLabel(_ label: String, in element: AXUIElement, report: inout ProbeReport) throws {
    let match = findElement(in: element) { candidate in
        descriptionValue(of: candidate) == label || value(of: candidate) == label || title(of: candidate) == label
    }

    guard match != nil else {
        report.fail("Missing AX label \(label)")
        throw ProbeFailure(message: "Missing AX label \(label)")
    }

    report.pass("AX label \(label)")
}

func waitForSheet(in app: NSRunningApplication, containing label: String, timeout: TimeInterval = 5.0) -> AXUIElement? {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        if let window = try? appWindow(for: app),
           let sheet = firstSheet(in: window),
           findElement(in: sheet, where: {
               descriptionValue(of: $0) == label || value(of: $0) == label || title(of: $0) == label
           }) != nil {
            return sheet
        }

        RunLoop.current.run(until: Date().addingTimeInterval(0.2))
    }

    return nil
}

func main() throws {
    guard AXIsProcessTrusted() else {
        throw ProbeFailure(message: "Accessibility access is not enabled for the current process.")
    }
    guard !screenIsLocked() else {
        throw ProbeFailure(message: "The Mac is locked. Unlock it before running the P6 Accessibility probe.")
    }

    var report = ProbeReport()
    let app = try runningApp()
    _ = app.activate()
    RunLoop.current.run(until: Date().addingTimeInterval(0.6))

    let window = try appWindow(for: app)
    report.pass("Attached to window \(title(of: window))")

    if CommandLine.arguments.contains("--patient-header-only") {
        guard windowContainsClinicalShell(window) else {
            throw ProbeFailure(message: "The selected bundle did not expose the universal clinical shell.")
        }
        try runPatientWorkspaceHeaderProbe(app: app, report: &report)
        print("Patient workspace header AX check passed.")
        return
    }

    if windowContainsClinicalShell(window) {
        try runClinicalShellProbe(app: app, report: &report)
        print("Native click-map probe passed.")
        return
    }

    if argumentValue(after: "--app-path") != nil {
        throw ProbeFailure(message: "The selected P6 bundle did not expose the universal clinical shell.")
    }

    if windowContainsHomeBaseShell(window) {
        try runHomeBaseShellProbe(app: app, window: window, report: &report)
        print("Native click-map probe passed.")
        return
    }

    try requireIdentifier("patients-ambulatory-picker", in: window, report: &report)
    try requireIdentifier("patients-status-filter", in: window, report: &report)
    try requireIdentifier("patients-search-field", in: window, report: &report)
    try requireIdentifier("patients-sort-picker", in: window, report: &report)

    let patientRow = try firstPatientRow(in: window)
    guard press(patientRow) else {
        report.fail("Unable to press first patient row")
        throw ProbeFailure(message: "Unable to press first patient row")
    }
    report.pass("Pressed first patient row")
    RunLoop.current.run(until: Date().addingTimeInterval(1.0))

    let detailWindow = try appWindow(for: app)
    try requireIdentifier("patient-detail-ai-studio-button", in: detailWindow, report: &report)
    try requireIdentifier("patient-detail-new-observation-button", in: detailWindow, report: &report)

    closeSheetIfPresent(in: app)

    guard let aiStudioButton = findElement(in: detailWindow, where: { identifier(of: $0) == "patient-detail-ai-studio-button" }),
          press(aiStudioButton) else {
        report.fail("Unable to open AI Clinical Studio")
        throw ProbeFailure(message: "Unable to open AI Clinical Studio")
    }
    report.pass("Opened AI Clinical Studio")

    guard let aiSheet = waitForSheet(in: app, containing: "AI Clinical Studio") else {
        report.fail("AI Clinical Studio sheet not found")
        throw ProbeFailure(message: "AI Clinical Studio sheet not found")
    }

    try requireLabel("AI Clinical Studio", in: aiSheet, report: &report)
    try requireLabel("Prompt Clinico", in: aiSheet, report: &report)
    try requireLabel("Rigenera contesto", in: aiSheet, report: &report)
    try requireLabel("Genera risposta", in: aiSheet, report: &report)
    try requireLabel("Genera e salva insight", in: aiSheet, report: &report)
    try requireLabel("Risposta", in: aiSheet, report: &report)
    closeSheetIfPresent(in: app)

    let observationWindow = try appWindow(for: app)
    guard let observationButton = findElement(in: observationWindow, where: { identifier(of: $0) == "patient-detail-new-observation-button" }),
          press(observationButton) else {
        report.fail("Unable to open observation sheet")
        throw ProbeFailure(message: "Unable to open observation sheet")
    }
    report.pass("Opened observation sheet")

    guard let observationSheet = waitForSheet(in: app, containing: "Nuova osservazione") else {
        report.fail("Observation sheet not found")
        throw ProbeFailure(message: "Observation sheet not found")
    }

    try requireLabel("Nuova osservazione", in: observationSheet, report: &report)
    try requireLabel("Parametro (LOINC)", in: observationSheet, report: &report)
    try requireLabel("Unità (UCUM)", in: observationSheet, report: &report)
    try requireLabel("Valore", in: observationSheet, report: &report)
    try requireLabel("Data/Ora", in: observationSheet, report: &report)
    try requireLabel("Note", in: observationSheet, report: &report)
    try requireLabel("Annulla", in: observationSheet, report: &report)
    try requireLabel("Aggiungi osservazione", in: observationSheet, report: &report)
    closeSheetIfPresent(in: app)

    print("Native click-map probe passed.")
}

do {
    try main()
} catch {
    fputs("Native click-map probe failed: \(error)\n", stderr)
    exit(1)
}

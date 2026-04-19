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
        checks.append("PASS  \(message)")
    }

    mutating func fail(_ message: String) {
        checks.append("FAIL  \(message)")
    }
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

func title(of element: AXUIElement) -> String {
    attribute(element, kAXTitleAttribute) as? String ?? ""
}

func findElement(in element: AXUIElement, where predicate: (AXUIElement) -> Bool) -> AXUIElement? {
    if predicate(element) {
        return element
    }

    for child in children(of: element) {
        if let found = findElement(in: child, where: predicate) {
            return found
        }
    }

    return nil
}

func collectElements(in element: AXUIElement, where predicate: (AXUIElement) -> Bool, into output: inout [AXUIElement]) {
    if predicate(element) {
        output.append(element)
    }

    for child in children(of: element) {
        collectElements(in: child, where: predicate, into: &output)
    }
}

@discardableResult
func press(_ element: AXUIElement) -> Bool {
    AXUIElementPerformAction(element, kAXPressAction as CFString) == .success
}

func runningApp() throws -> NSRunningApplication {
    if let app = NSRunningApplication.runningApplications(withBundleIdentifier: "com.mediflow.mac").first {
        return app
    }

    if let app = NSWorkspace.shared.runningApplications.first(where: { $0.localizedName == "MediFlowMac" }) {
        return app
    }

    throw ProbeFailure(message: "MediFlowMac is not running. Launch the app before running this probe.")
}

func appWindow(for app: NSRunningApplication) throws -> AXUIElement {
    let appElement = AXUIElementCreateApplication(app.processIdentifier)
    guard let windows = attribute(appElement, kAXWindowsAttribute) as? [AXUIElement], let window = windows.first else {
        throw ProbeFailure(message: "Unable to resolve the first MediFlowMac window via AX.")
    }
    return window
}

func requireIdentifier(_ identifierName: String, in window: AXUIElement, report: inout ProbeReport) throws {
    guard findElement(in: window, where: { identifier(of: $0) == identifierName }) != nil else {
        report.fail("Missing identifier \(identifierName)")
        throw ProbeFailure(message: "Missing identifier \(identifierName)")
    }

    report.pass("Identifier \(identifierName)")
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

    var report = ProbeReport()
    let app = try runningApp()
    _ = app.activate()
    RunLoop.current.run(until: Date().addingTimeInterval(0.6))

    let window = try appWindow(for: app)
    report.pass("Attached to window \(title(of: window))")

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
    for line in report.checks {
        print(line)
    }
}

do {
    try main()
} catch {
    fputs("Native click-map probe failed: \(error)\n", stderr)
    exit(1)
}

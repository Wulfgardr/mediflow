import AppKit
import LocalAuthentication

struct Request: Decodable {
    let action: String
    let title: String
    let lines: [String]
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
do {
    let bytes = FileHandle.standardInput.readDataToEndOfFile()
    guard bytes.count <= 65536 else { exit(1) }
    let request = try JSONDecoder().decode(Request.self, from: bytes)
    guard ["select", "approve"].contains(request.action), request.lines.count <= 128 else { exit(1) }
    let alert = NSAlert()
    alert.messageText = request.title
    let text = NSTextView(frame: NSRect(x: 0, y: 0, width: 640, height: 400))
    text.string = request.lines.joined(separator: "\n")
    text.isEditable = false
    text.isSelectable = false
    text.font = NSFont.systemFont(ofSize: 14)
    let scroll = NSScrollView(frame: text.frame)
    scroll.hasVerticalScroller = true
    scroll.documentView = text
    alert.accessoryView = scroll
    alert.addButton(withTitle: request.action == "select" ? "Seleziona" : "Autorizza")
    alert.addButton(withTitle: "Annulla")
    app.activate(ignoringOtherApps: true)
    guard alert.runModal() == .alertFirstButtonReturn else { print("cancelled"); exit(0) }
    if request.action == "select" { print("selected"); exit(0) }
    let authentication = LAContext()
    var failure: NSError?
    guard authentication.canEvaluatePolicy(.deviceOwnerAuthentication, error: &failure) else {
        print("cancelled"); exit(0)
    }
    authentication.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Autorizza questa sola prescrizione inventata") { accepted, _ in
        DispatchQueue.main.async { print(accepted ? "approved" : "cancelled"); exit(0) }
    }
    app.run()
} catch {
    print("cancelled")
    exit(1)
}

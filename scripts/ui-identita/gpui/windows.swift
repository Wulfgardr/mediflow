import Foundation
import CoreGraphics

let windows = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] ?? []
let relevant = windows.filter {
    let owner = ($0[kCGWindowOwnerName as String] as? String ?? "").lowercased()
    return owner.contains("gpui") || owner.contains("mediflow") || owner == "loginwindow"
}.map { window in
    window.filter { key, _ in
        [kCGWindowNumber, kCGWindowOwnerName, kCGWindowOwnerPID,
         kCGWindowBounds, kCGWindowIsOnscreen].map { $0 as String }.contains(key)
    }
}
let session = CGSessionCopyCurrentDictionary() as? [String: Any] ?? [:]
let result: [String: Any] = [
    "at": ISO8601DateFormatter().string(from: Date()),
    "screenLocked": session["CGSSessionScreenIsLocked"] ?? "unknown",
    "windows": relevant
]
let data = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
print(String(decoding: data, as: UTF8.self))

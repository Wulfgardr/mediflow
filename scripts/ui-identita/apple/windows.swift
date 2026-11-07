import Foundation
import CoreGraphics
let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String:Any]] ?? []
let filtered = list.filter { ($0[kCGWindowOwnerPID as String] as? Int) == Int(CommandLine.arguments[1]) }
let data = try JSONSerialization.data(withJSONObject: filtered, options: [.prettyPrinted,.sortedKeys])
print(String(data:data,encoding:.utf8)!)

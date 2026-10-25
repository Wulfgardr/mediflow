import Foundation

public struct MobileVisitEntryPayload: Codable, Equatable, Sendable {
    public let id: String
    public let type: String
    public let title: String?
    public let date: Date
    public let content: String
    public let setting: String?
    public let metadata: String?
    public let attachments: String?

    public init(_ payload: HomeBaseEntryCreatePayload) {
        id = payload.id; type = payload.type; title = payload.title; date = payload.date
        content = payload.content; setting = payload.setting; metadata = payload.metadata; attachments = payload.attachments
    }

    public var payload: HomeBaseEntryCreatePayload {
        HomeBaseEntryCreatePayload(id: id, type: type, title: title, date: date, content: content,
            setting: setting, metadata: metadata,
            attachmentReferences: HomeBaseSealedEntryAttachmentReferences(encodedValue: attachments))
    }

    public func matches(_ entry: HomeBaseEntrySummary, patientID: String) -> Bool {
        entry.id == id && entry.patientId == patientID && entry.deletedAt == nil && entry.version > 0
            && entry.type == type && entry.title == (title ?? "") && entry.content == content
            && abs(entry.date.timeIntervalSince(date)) < 0.001
            && entry.setting == setting && entry.metadata == metadata && entry.attachments == attachments
    }
}

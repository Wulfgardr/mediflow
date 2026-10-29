import Foundation

enum ClinicalDatePresentation {
    static let locale = Locale(identifier: "it_IT")

    static func makeFormatter(dateStyle: DateFormatter.Style, timeStyle: DateFormatter.Style = .none) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.dateStyle = dateStyle
        formatter.timeStyle = timeStyle
        return formatter
    }

    static let day = makeFormatter(dateStyle: .medium)
    static let numericDay = makeFormatter(dateStyle: .short)
    static let timestamp: DateFormatter = {
        let formatter = makeFormatter(dateStyle: .medium, timeStyle: .short)
        formatter.dateFormat = "d MMM yyyy, HH:mm"
        return formatter
    }()
    static let birthDate: DateFormatter = {
        let formatter = makeFormatter(dateStyle: .medium)
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        return formatter
    }()
    static let fileDay: DateFormatter = {
        let formatter = makeFormatter(dateStyle: .short)
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()
    static func makeRelativeFormatter(calendar: Calendar = .current) -> RelativeDateTimeFormatter {
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = locale
        formatter.unitsStyle = .short
        var gregorian = Calendar(identifier: .gregorian)
        gregorian.timeZone = calendar.timeZone
        formatter.calendar = gregorian
        return formatter
    }
    static let relative = makeRelativeFormatter()
}

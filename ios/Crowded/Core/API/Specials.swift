import Foundation

// Bar specials: happy hours, drinks, food, cover and events. The bar (or Crowded) posts them.
// Times are local to the bar and travel as "HH:MM" strings. Days use Monday = 0 to Sunday = 6.

enum SpecialKind: String, CaseIterable, Sendable, Equatable, Identifiable {
    case happyHour = "happy_hour"
    case drink
    case food
    case cover
    case event

    var id: String { rawValue }

    /// Unknown kinds from a newer server fall back to a plain event.
    init(api value: String) {
        self = SpecialKind(rawValue: value) ?? .event
    }

    var label: String {
        switch self {
        case .happyHour: return "Happy hour"
        case .drink: return "Drink"
        case .food: return "Food"
        case .cover: return "Cover"
        case .event: return "Event"
        }
    }
}

enum PostedBy: Sendable, Equatable {
    case bar
    case crowded

    init(api value: String) {
        self = value == "admin" ? .crowded : .bar
    }

    var label: String {
        switch self {
        case .bar: return "Posted by the bar"
        case .crowded: return "Posted by Crowded"
        }
    }
}

struct Special: Sendable, Equatable, Identifiable {
    var id: String
    var kind: SpecialKind
    var title: String
    var details: String
    var days: [Int]
    var startLocal: String
    var endLocal: String
    var priceCents: Int?
    var isActive: Bool
    var postedBy: PostedBy
    var updatedAt: Date

    var window: String {
        return SpecialTime.window(start: startLocal, end: endLocal)
    }

    var priceText: String? {
        return priceCents.map { Money.format(cents: $0) }
    }
}

struct SpecialTonight: Sendable, Equatable, Identifiable {
    var special: Special
    var isNow: Bool

    var id: String { special.id }
}

/// What staff send when they add a special.
struct SpecialInput: Sendable, Equatable {
    var kind: SpecialKind
    var title: String
    var details: String
    var days: [Int]
    var startLocal: String
    var endLocal: String
    var priceCents: Int?
}

/// What staff send when they change a special. Nil fields stay as they are.
struct SpecialPatch: Sendable, Equatable {
    var kind: SpecialKind?
    var title: String?
    var details: String?
    var days: [Int]?
    var startLocal: String?
    var endLocal: String?
    var priceCents: Int?
    var isActive: Bool?

    init(
        kind: SpecialKind? = nil, title: String? = nil, details: String? = nil,
        days: [Int]? = nil, startLocal: String? = nil, endLocal: String? = nil,
        priceCents: Int? = nil, isActive: Bool? = nil
    ) {
        self.kind = kind
        self.title = title
        self.details = details
        self.days = days
        self.startLocal = startLocal
        self.endLocal = endLocal
        self.priceCents = priceCents
        self.isActive = isActive
    }
}

enum SpecialTime {
    /// "17:00" -> (17, 0). Accepts "17:00:00" too. Nil when the text is not a time.
    static func parse(_ hhmm: String) -> (hour: Int, minute: Int)? {
        let parts = hhmm.split(separator: ":")
        guard parts.count >= 2, let hour = Int(parts[0]), let minute = Int(parts[1]) else {
            return nil
        }
        guard (0...23).contains(hour), (0...59).contains(minute) else { return nil }
        return (hour, minute)
    }

    static func minutes(_ hhmm: String) -> Int? {
        guard let t = parse(hhmm) else { return nil }
        return t.hour * 60 + t.minute
    }

    /// "17:00" -> "5 PM", "21:30" -> "9:30 PM", "00:00" -> "12 AM". Bad input comes back as is.
    static func format12(_ hhmm: String) -> String {
        guard let t = parse(hhmm) else { return hhmm }
        let h12 = t.hour % 12 == 0 ? 12 : t.hour % 12
        let suffix = t.hour < 12 ? "AM" : "PM"
        if t.minute == 0 {
            return "\(h12) \(suffix)"
        }
        return "\(h12):\(String(format: "%02d", t.minute)) \(suffix)"
    }

    static func window(start: String, end: String) -> String {
        return "\(format12(start)) to \(format12(end))"
    }

    static func hhmm(hour: Int, minute: Int) -> String {
        return String(format: "%02d:%02d", hour, minute)
    }

    /// A Date for a time picker. Only the hour and minute matter.
    static func date(from hhmm: String, calendar: Calendar = .current) -> Date {
        let t = parse(hhmm) ?? (hour: 18, minute: 0)
        var parts = calendar.dateComponents([.year, .month, .day], from: Date())
        parts.hour = t.hour
        parts.minute = t.minute
        return calendar.date(from: parts) ?? Date()
    }

    static func hhmm(from date: Date, calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        return hhmm(hour: parts.hour ?? 0, minute: parts.minute ?? 0)
    }

    static let shortDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    static let longDays = [
        "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
    ]

    /// "Mon to Fri", "Thu, Sat", "Every night".
    static func daysSummary(_ days: [Int]) -> String {
        let sorted = Array(Set(days.filter { (0...6).contains($0) })).sorted()
        if sorted.count == 7 {
            return "Every night"
        }
        if sorted.count >= 3, let first = sorted.first, let last = sorted.last,
            last - first == sorted.count - 1
        {
            return "\(shortDays[first]) to \(shortDays[last])"
        }
        return sorted.map { shortDays[$0] }.joined(separator: ", ")
    }

    static func relative(_ date: Date, now: Date = Date()) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .full
        return formatter.localizedString(for: date, relativeTo: now)
    }
}

enum SpecialPrice {
    /// "5" -> 500, "5.5" -> 550, "$12.25" -> 1225. Empty or invalid text gives nil.
    static func cents(fromDollars text: String) -> Int? {
        let cleaned = text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "$", with: "")
        if cleaned.isEmpty { return nil }
        let parts = cleaned.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count <= 2 else { return nil }
        let whole = String(parts[0])
        let fraction = parts.count == 2 ? String(parts[1]) : ""
        guard whole.allSatisfy({ $0.isASCII && $0.isNumber }),
            fraction.allSatisfy({ $0.isASCII && $0.isNumber }),
            fraction.count <= 2
        else { return nil }
        guard !(whole.isEmpty && fraction.isEmpty) else { return nil }
        let dollars = Int(whole.isEmpty ? "0" : whole) ?? 0
        let padded = fraction.count == 1 ? fraction + "0" : fraction
        let extra = Int(padded.isEmpty ? "0" : padded) ?? 0
        let total = dollars * 100 + extra
        return total <= 100_000 ? total : nil
    }

    static func isValid(dollars text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty || cents(fromDollars: trimmed) != nil
    }

    /// 500 -> "5", 550 -> "5.50", for the edit field.
    static func dollarsText(cents: Int?) -> String {
        guard let cents else { return "" }
        if cents % 100 == 0 { return "\(cents / 100)" }
        return String(format: "%d.%02d", cents / 100, cents % 100)
    }
}

/// Mirrors the backend's "tonight" and "now" rules so the mock tells the same story.
/// A night runs from local noon to the next local noon.
enum SpecialSchedule {
    static let nightStartHour = 12

    /// Monday = 0 ... Sunday = 6.
    static func weekday(of date: Date, calendar: Calendar) -> Int {
        return (calendar.component(.weekday, from: date) + 5) % 7
    }

    static func nightStartWeekday(_ now: Date, calendar: Calendar) -> Int {
        let today = weekday(of: now, calendar: calendar)
        if calendar.component(.hour, from: now) < nightStartHour {
            return (today + 6) % 7
        }
        return today
    }

    static func isNow(days: [Int], start: String, end: String, now: Date, calendar: Calendar) -> Bool {
        guard let s = SpecialTime.minutes(start), let e = SpecialTime.minutes(end) else {
            return false
        }
        let parts = calendar.dateComponents([.hour, .minute], from: now)
        let current = (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
        let today = weekday(of: now, calendar: calendar)
        let yesterday = (today + 6) % 7
        let overnight = e <= s
        if days.contains(today) {
            if overnight {
                if current >= s { return true }
            } else if current >= s && current < e {
                return true
            }
        }
        if overnight && days.contains(yesterday) && current < e {
            return true
        }
        return false
    }

    /// Active specials for tonight, now first, then by start time.
    static func tonight(_ all: [Special], now: Date, calendar: Calendar) -> [SpecialTonight] {
        let night = nightStartWeekday(now, calendar: calendar)
        let items: [SpecialTonight] = all
            .filter { $0.isActive && $0.days.contains(night) }
            .map { special in
                SpecialTonight(
                    special: special,
                    isNow: isNow(
                        days: special.days, start: special.startLocal, end: special.endLocal,
                        now: now, calendar: calendar)
                )
            }
        return items.sorted { a, b in
            if a.isNow != b.isNow { return a.isNow }
            return a.special.startLocal < b.special.startLocal
        }
    }

    static func cover(in tonight: [SpecialTonight]) -> SpecialTonight? {
        return tonight
            .filter { $0.special.kind == .cover }
            .min { $0.special.startLocal < $1.special.startLocal }
    }
}

/// The one quiet line under a bar row on Tonight.
enum SpecialsText {
    static func label(_ special: Special) -> String {
        switch special.kind {
        case .happyHour:
            return "Happy hour"
        case .cover:
            if let price = special.priceText {
                return "Cover \(price)"
            }
            return "Cover"
        default:
            return special.title
        }
    }

    /// Prefers an item that is on now (not cover), then cover, then a count. Nil when empty.
    static func tonightLine(specials: [SpecialTonight], cover: SpecialTonight?) -> String? {
        if let now = specials.first(where: { $0.isNow && $0.special.kind != .cover }) {
            return "\(label(now.special)) now until \(SpecialTime.format12(now.special.endLocal))"
        }
        if let cover {
            if cover.isNow {
                return "\(label(cover.special)) now"
            }
            return "\(label(cover.special)) from \(SpecialTime.format12(cover.special.startLocal))"
        }
        if specials.isEmpty {
            return nil
        }
        if specials.count == 1 {
            return "1 special tonight"
        }
        return "\(specials.count) specials tonight"
    }

    static func tonightLine(for bar: Bar) -> String? {
        return tonightLine(specials: bar.specialsTonight, cover: bar.coverTonight)
    }
}

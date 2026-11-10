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

/// What kind of thing a deal item is. Unknown values from a newer server fall back to other.
enum DealCategory: String, CaseIterable, Sendable, Equatable, Identifiable {
    case beer
    case pitchers
    case shots
    case mixers
    case wine
    case food
    case other

    var id: String { rawValue }

    init(api value: String) {
        self = DealCategory(rawValue: value) ?? .other
    }

    var label: String {
        switch self {
        case .beer: return "Beer"
        case .pitchers: return "Pitchers"
        case .shots: return "Shots"
        case .mixers: return "Mixers"
        case .wine: return "Wine"
        case .food: return "Food"
        case .other: return "Other"
        }
    }
}

/// One line of a deal menu: "Double wells" at "$2", with an optional short note.
struct DealItem: Sendable, Equatable {
    var name: String
    var priceLabel: String
    var category: DealCategory
    var note: String

    init(name: String, priceLabel: String, category: DealCategory = .other, note: String = "") {
        self.name = name
        self.priceLabel = priceLabel
        self.category = category
        self.note = note
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
    var allDay: Bool = false
    var items: [DealItem] = []

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
    var allDay: Bool = false
    var items: [DealItem] = []
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
    var allDay: Bool?
    var items: [DealItem]?

    init(
        kind: SpecialKind? = nil, title: String? = nil, details: String? = nil,
        days: [Int]? = nil, startLocal: String? = nil, endLocal: String? = nil,
        priceCents: Int? = nil, isActive: Bool? = nil, allDay: Bool? = nil,
        items: [DealItem]? = nil
    ) {
        self.kind = kind
        self.title = title
        self.details = details
        self.days = days
        self.startLocal = startLocal
        self.endLocal = endLocal
        self.priceCents = priceCents
        self.isActive = isActive
        self.allDay = allDay
        self.items = items
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

    /// "21:00" -> "9", "21:30" -> "9:30", "00:00" -> "12". For tight deal lines.
    static func short(_ hhmm: String) -> String {
        guard let t = parse(hhmm) else { return hhmm }
        let h12 = t.hour % 12 == 0 ? 12 : t.hour % 12
        if t.minute == 0 {
            return "\(h12)"
        }
        return "\(h12):\(String(format: "%02d", t.minute))"
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
                    isNow: special.allDay
                        || isNow(
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

    /// Minutes since the night started (local noon). Orders times across midnight.
    static func nightOffset(_ hhmm: String) -> Int {
        let m = SpecialTime.minutes(hhmm) ?? 0
        return (m - nightStartHour * 60 + 1440) % 1440
    }

    static func phase(of item: SpecialTonight, now: Date, calendar: Calendar) -> SpecialPhase {
        if item.special.allDay || item.isNow {
            return .now
        }
        let parts = calendar.dateComponents([.hour, .minute], from: now)
        let minutes = (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
        let current = (minutes - nightStartHour * 60 + 1440) % 1440
        return current < nightOffset(item.special.startLocal) ? .upcoming : .ended
    }
}

/// Where a special sits in tonight's timeline.
enum SpecialPhase: Sendable, Equatable {
    case now
    case upcoming
    case ended
}


/// The one quiet line under a bar row on Tonight, built from deal items.
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

    /// "double wells" from "Double wells". Keeps names like "IPA" as they are.
    static func lowerFirst(_ text: String) -> String {
        guard let first = text.first else { return text }
        let rest = String(text.dropFirst())
        if let second = rest.first, second.isUppercase {
            return text
        }
        return first.lowercased() + rest
    }

    /// "$2 double wells, $2 drafts +2". Two items, then a count of the rest.
    static func dealText(_ items: [DealItem]) -> String {
        let shown = items.prefix(2).map { "\($0.priceLabel) \(lowerFirst($0.name))" }
        var text = shown.joined(separator: ", ")
        if items.count > 2 {
            text += " +\(items.count - 2)"
        }
        return text
    }

    private static func nowLine(_ special: Special) -> String {
        if special.allDay {
            return "All night: " + (special.items.isEmpty ? special.title : dealText(special.items))
        }
        let name = label(special)
        if special.items.isEmpty {
            return "\(name) now"
        }
        return "\(name) now: \(dealText(special.items))"
    }

    private static func nextLine(_ special: Special) -> String {
        let name = label(special)
        let when = "\(name) at \(SpecialTime.short(special.startLocal))"
        if special.items.isEmpty {
            return when
        }
        return "\(when): \(dealText(special.items))"
    }

    /// What is on now, else what starts next, else cover. Nil when there is nothing to say.
    static func tonightLine(
        specials: [SpecialTonight], cover: SpecialTonight?, now: Date = Date(),
        calendar: Calendar = .current
    ) -> String? {
        let others = specials.filter { $0.special.kind != .cover }
        let live = others.filter {
            SpecialSchedule.phase(of: $0, now: now, calendar: calendar) == .now
        }
        let timed = live.filter { !$0.special.allDay }
        let allNight = live.filter { $0.special.allDay }
        let pick: SpecialTonight? =
            timed.first(where: { !$0.special.items.isEmpty })
            ?? allNight.first(where: { !$0.special.items.isEmpty })
            ?? live.first
        if let pick {
            return nowLine(pick.special)
        }
        let upcoming = others
            .filter { SpecialSchedule.phase(of: $0, now: now, calendar: calendar) == .upcoming }
            .sorted {
                SpecialSchedule.nightOffset($0.special.startLocal)
                    < SpecialSchedule.nightOffset($1.special.startLocal)
            }
        if let next = upcoming.first {
            return nextLine(next.special)
        }
        if let cover {
            let name = label(cover.special)
            switch SpecialSchedule.phase(of: cover, now: now, calendar: calendar) {
            case .now:
                return "\(name) now"
            case .upcoming:
                return "\(name) from \(SpecialTime.format12(cover.special.startLocal))"
            case .ended:
                return nil
            }
        }
        return nil
    }

    static func tonightLine(for bar: Bar, now: Date = Date(), calendar: Calendar = .current) -> String? {
        return tonightLine(
            specials: bar.specialsTonight, cover: bar.coverTonight, now: now, calendar: calendar)
    }
}

/// One line in a deal price list.
struct DealRow: Sendable, Equatable, Identifiable {
    var id: String
    var name: String
    var price: String?
    var note: String
}

/// A block of the bar page price list: "All night", or one timed special.
struct DealGroup: Sendable, Equatable, Identifiable {
    var id: String
    var title: String
    var isAllNight: Bool
    var isNow: Bool
    /// "Until 12" or "Starts at 9". Nil on the weekly list.
    var status: String?
    var rows: [DealRow]
    var postedBy: PostedBy
    var updatedAt: Date
}

struct DayDeals: Sendable, Equatable, Identifiable {
    var day: Int
    var groups: [DealGroup]

    var id: Int { day }
}

/// Turns specials into the "Deals tonight" price list and the weekly list.
enum DealMenu {
    private struct Entry {
        var special: Special
        var phase: SpecialPhase?
    }

    /// All night first, then timed groups in time order. Ended groups are left out.
    static func tonight(
        _ list: [SpecialTonight], now: Date = Date(), calendar: Calendar = .current
    ) -> [DealGroup] {
        var entries: [Entry] = []
        for item in list {
            let phase = SpecialSchedule.phase(of: item, now: now, calendar: calendar)
            if phase != .ended {
                entries.append(Entry(special: item.special, phase: phase))
            }
        }
        return build(entries)
    }

    /// Monday to Sunday. A special that runs on several days appears under each of them.
    static func week(_ all: [Special]) -> [DayDeals] {
        var days: [DayDeals] = []
        for day in 0...6 {
            var entries: [Entry] = []
            for special in all where special.days.contains(day) {
                entries.append(Entry(special: special, phase: nil))
            }
            let groups = build(entries)
            if !groups.isEmpty {
                days.append(DayDeals(day: day, groups: groups))
            }
        }
        return days
    }

    private static func build(_ entries: [Entry]) -> [DealGroup] {
        var groups: [DealGroup] = []
        let allNight = entries.filter { $0.special.allDay }
        if let first = allNight.first {
            let newest = allNight.map { $0.special.updatedAt }.max() ?? first.special.updatedAt
            var rows: [DealRow] = []
            for entry in allNight {
                rows.append(contentsOf: Self.rows(for: entry.special))
            }
            groups.append(
                DealGroup(
                    id: "all-night", title: "All night", isAllNight: true,
                    isNow: allNight.contains { $0.phase == SpecialPhase.now }, status: nil,
                    rows: rows, postedBy: first.special.postedBy, updatedAt: newest
                ))
        }
        let timed = entries
            .filter { !$0.special.allDay }
            .sorted { a, b in
                let oa = SpecialSchedule.nightOffset(a.special.startLocal)
                let ob = SpecialSchedule.nightOffset(b.special.startLocal)
                if oa != ob { return oa < ob }
                return a.special.title < b.special.title
            }
        for entry in timed {
            let special = entry.special
            var status: String? = nil
            if entry.phase == SpecialPhase.now {
                status = "Until \(SpecialTime.short(special.endLocal))"
            } else if entry.phase == SpecialPhase.upcoming {
                status = "Starts at \(SpecialTime.short(special.startLocal))"
            }
            groups.append(
                DealGroup(
                    id: special.id, title: timedTitle(special), isAllNight: false,
                    isNow: entry.phase == SpecialPhase.now, status: status,
                    rows: rows(for: special), postedBy: special.postedBy,
                    updatedAt: special.updatedAt
                ))
        }
        return groups
    }

    /// "Happy hour 9 to 12", "DJ from 9", "Cover $5 from 9".
    static func timedTitle(_ special: Special) -> String {
        let start = SpecialTime.short(special.startLocal)
        let end = SpecialTime.short(special.endLocal)
        switch special.kind {
        case .happyHour:
            return "Happy hour \(start) to \(end)"
        case .event:
            return "\(special.title) from \(start)"
        case .cover:
            if let price = special.priceText {
                return "Cover \(price) from \(start)"
            }
            return "Cover from \(start)"
        case .drink, .food:
            return "\(special.title) \(start) to \(end)"
        }
    }

    /// Items become rows. A special without items is one row of title and details, unless the
    /// header already says it all (an event or cover with no details).
    static func rows(for special: Special) -> [DealRow] {
        if !special.items.isEmpty {
            var rows: [DealRow] = []
            for (index, item) in special.items.enumerated() {
                rows.append(
                    DealRow(
                        id: "\(special.id)-\(index)", name: item.name, price: item.priceLabel,
                        note: item.note))
            }
            return rows
        }
        let headerSaysAll =
            !special.allDay && special.details.isEmpty
            && (special.kind == .event || special.kind == .cover)
        if headerSaysAll {
            return []
        }
        return [
            DealRow(
                id: "\(special.id)-row", name: special.title, price: special.priceText,
                note: special.details)
        ]
    }
}

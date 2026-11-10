import Foundation

// App domain models. Views only ever see these types. LiveAPI maps the generated OpenAPI
// types into them and MockAPI builds them directly, so the UI cannot tell the two apart.
// Every enum parsed from the server has a safe fallback for values a newer server might add.

enum Role: String, Sendable, Equatable {
    case user
    case staff
    case admin

    init(api value: String) {
        self = Role(rawValue: value) ?? .user
    }
}

enum CrowdLevel: String, CaseIterable, Sendable, Equatable, Identifiable {
    case easy
    case busy
    case packed

    var id: String { rawValue }

    init?(api value: String?) {
        guard let value else { return nil }
        self.init(rawValue: value)
    }

    var label: String {
        switch self {
        case .easy: return "Easy"
        case .busy: return "Busy"
        case .packed: return "Packed"
        }
    }

    var detail: String {
        switch self {
        case .easy: return "Walk right in"
        case .busy: return "Getting full"
        case .packed: return "Shoulder to shoulder"
        }
    }

    /// Filled segments in the 3 segment meter. The label is always shown next to it.
    var filledSegments: Int {
        switch self {
        case .easy: return 1
        case .busy: return 2
        case .packed: return 3
        }
    }
}

enum LineSize: String, CaseIterable, Sendable, Equatable, Identifiable {
    case none
    case short
    case medium
    case long
    case veryLong = "very_long"

    var id: String { rawValue }

    init?(api value: String?) {
        guard let value else { return nil }
        self.init(rawValue: value)
    }

    var label: String {
        switch self {
        case .none: return "None"
        case .short: return "Short"
        case .medium: return "Medium"
        case .long: return "Long"
        case .veryLong: return "Huge"
        }
    }

    var range: String {
        switch self {
        case .none: return "0"
        case .short: return "1 to 10"
        case .medium: return "11 to 25"
        case .long: return "26 to 50"
        case .veryLong: return "50+"
        }
    }
}

enum Confidence: String, Sendable, Equatable {
    case none
    case low
    case medium
    case high

    init(api value: String) {
        self = Confidence(rawValue: value) ?? .low
    }
}

enum Recommendation: String, Sendable, Equatable {
    case buyPass = "buy_pass"
    case waitItOut = "wait_it_out"
    case noPassAvailable = "no_pass_available"
    case noData = "no_data"

    init(api value: String) {
        self = Recommendation(rawValue: value) ?? .noData
    }
}

enum SessionStatus: String, Sendable, Equatable {
    case active
    case completed
    case abandoned

    init(api value: String) {
        self = SessionStatus(rawValue: value) ?? .abandoned
    }
}

enum EndOutcome: String, Sendable, Equatable {
    case inside
    case gaveUp = "gave_up"
}

/// Staff door counter direction. Raw values match the API ("in" is a Swift keyword).
enum DoorDirection: String, Sendable, Equatable {
    case entry = "in"
    case exit = "out"
}

struct Coordinate: Sendable, Equatable {
    var latitude: Double
    var longitude: Double
}

struct Basis: Sendable, Equatable {
    var text: String
    var windowMin: Int
    var reports: Int
    var timers: Int
    var doorEvents: Int
    var staffLineUpdates: Int

    static let empty = Basis(
        text: "No recent data", windowMin: 30, reports: 0, timers: 0, doorEvents: 0,
        staffLineUpdates: 0
    )
}

struct Live: Sendable, Equatable {
    var hasRecentData: Bool
    var waitMin: Int?
    var waitLowMin: Int?
    var waitHighMin: Int?
    var crowdLevel: CrowdLevel?
    var headcount: Int?
    var capacityRatio: Double?
    var confidence: Confidence
    var basis: Basis
    var flags: [String]
    var updatedAt: Date?

    static let noData = Live(
        hasRecentData: false, waitMin: nil, waitLowMin: nil, waitHighMin: nil, crowdLevel: nil,
        headcount: nil, capacityRatio: nil, confidence: .none, basis: .empty, flags: [],
        updatedAt: nil
    )
}

struct Verdict: Sendable, Equatable {
    var recommendation: Recommendation
    var text: String
    var thresholdMin: Int
    var passPriceCents: Int?
    var minutesSaved: Int?

    /// Short, quiet line for list rows. Crowd and line come first, the pass call is secondary.
    var shortText: String {
        switch recommendation {
        case .buyPass:
            if let cents = passPriceCents {
                return "Pass \(Money.format(cents: cents)) worth it"
            }
            return "Pass worth it"
        case .waitItOut:
            return "Skip the pass"
        case .noPassAvailable:
            return "No pass sold here"
        case .noData:
            return "No pass call yet"
        }
    }
}

struct HourPoint: Sendable, Equatable, Identifiable {
    var hour: Int
    var typicalWaitMin: Int?
    var tonightWaitMin: Int?

    var id: Int { hour }

    /// "6p", "12a" style label for the chart axis.
    var label: String {
        let h12 = hour % 12 == 0 ? 12 : hour % 12
        return "\(h12)\(hour < 12 ? "a" : "p")"
    }
}

struct Bar: Sendable, Equatable, Identifiable {
    var id: String
    var slug: String
    var name: String
    var address: String
    var capacity: Int
    var passPriceCents: Int?
    var live: Live
    var verdict: Verdict
    var specialsTonight: [SpecialTonight] = []
    var coverTonight: SpecialTonight? = nil
}

struct BarDetail: Sendable, Equatable {
    var bar: Bar
    var latitude: Double
    var longitude: Double
    var normalWaitMin: Int?
    var waitByHour: [HourPoint]
    var specialsWeek: [Special] = []
}

struct Me: Sendable, Equatable {
    var id: String
    var role: Role
    var waitThresholdMin: Int
    var staffBarId: String?
    var phoneHint: String?

    var isStaff: Bool { role == .staff && staffBarId != nil }
}

struct LineSession: Sendable, Equatable, Identifiable {
    var id: String
    var barId: String
    var status: SessionStatus
    var startedAt: Date
    var endedAt: Date?
    var predictedWaitMin: Int?
    var actualWaitMin: Double?
    var nearBar: Bool
    var pointsAwarded: Int
    /// True when the student typed the right door code. Defaults to false for older servers.
    var verified: Bool = false
}

/// How a staff line sample ends. Raw values match the API.
enum SampleOutcome: String, Sendable, Equatable {
    case inside
    case cancel
}

/// A staff timed line sample: someone at the back of the line, timed to the door.
struct LineSample: Sendable, Equatable, Identifiable {
    var id: String
    var barId: String
    var status: SessionStatus
    var startedAt: Date
    var endedAt: Date?
    var actualWaitMin: Double?
}

/// The 4 digit door code. It changes every 2 minutes.
struct DoorCode: Sendable, Equatable {
    var code: String
    /// Seconds left when the server answered.
    var expiresIn: Int
}

struct ReportResult: Sendable, Equatable {
    var nearBar: Bool
    var pointsAwarded: Int
}

struct CodeRequest: Sendable, Equatable {
    var expiresIn: Int
    /// Only filled by dev backends and the mock. Real builds never receive it.
    var devCode: String?
}

struct StaffState: Sendable, Equatable {
    var barId: String
    var barName: String
    var capacity: Int
    var headcount: Int
    var entriesTonight: Int
    var exitsTonight: Int
    var lineSize: LineSize?
    var lineUpdatedAt: Date?
    var live: Live

    var fillRatio: Double {
        capacity > 0 ? Double(headcount) / Double(capacity) : 0
    }
}

enum Money {
    /// 1500 -> "$15", 1250 -> "$12.50"
    static func format(cents: Int) -> String {
        if cents % 100 == 0 {
            return "$\(cents / 100)"
        }
        return String(format: "$%d.%02d", cents / 100, cents % 100)
    }
}

enum APIDate {
    /// Parses server timestamps with or without fractional seconds.
    static func parse(_ value: String?) -> Date? {
        guard let value, !value.isEmpty else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: value) {
            return date
        }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        if let date = plain.date(from: value) {
            return date
        }
        // Naive timestamps (no zone) are UTC on this backend.
        return plain.date(from: value + "Z")
    }
}

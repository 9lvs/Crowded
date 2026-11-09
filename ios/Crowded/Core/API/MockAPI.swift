import Foundation

/// In memory backend with FAKE bars. Used by previews, unit tests, UI tests (-mockAPI) and demos.
/// Mirrors web/js/mock.js so both clients tell the same story. Any 6 digit code signs you in.
actor MockAPI: CrowdedAPI {
    struct FakeBar {
        var id: String
        var slug: String
        var name: String
        var address: String
        var capacity: Int
        var passPriceCents: Int?
        var baseWait: Int
        var swing: Int
        var baseFill: Double
        var reports: Int
        var timers: Int
        var hasData: Bool
        var typical: [Int]
    }

    static let hours: [Int] = [18, 19, 20, 21, 22, 23, 0, 1, 2, 3]

    private var fakeBars: [FakeBar] = [
        FakeBar(
            id: "00000000-0000-4000-8000-000000000001", slug: "fake-tipsy-owl",
            name: "FAKE The Tipsy Owl", address: "101 Fake College Ave", capacity: 220,
            passPriceCents: 1500, baseWait: 28, swing: 7, baseFill: 0.93, reports: 7, timers: 3,
            hasData: true, typical: [2, 5, 12, 22, 30, 34, 31, 24, 14, 6]
        ),
        FakeBar(
            id: "00000000-0000-4000-8000-000000000002", slug: "fake-copper-lantern",
            name: "FAKE Copper Lantern", address: "22 Pretend St", capacity: 150,
            passPriceCents: 1000, baseWait: 11, swing: 4, baseFill: 0.71, reports: 4, timers: 1,
            hasData: true, typical: [0, 2, 5, 9, 13, 15, 14, 10, 6, 2]
        ),
        FakeBar(
            id: "00000000-0000-4000-8000-000000000003", slug: "fake-night-heron",
            name: "FAKE Night Heron", address: "9 Sample Row", capacity: 300,
            passPriceCents: nil, baseWait: 0, swing: 0, baseFill: 0, reports: 0, timers: 0,
            hasData: false, typical: [0, 0, 3, 8, 14, 19, 18, 12, 6, 1]
        ),
    ]

    private var signedIn: Bool
    private var meValue: Me
    private var session: LineSession?
    private var staffCounts: [String: (ins: Int, outs: Int)] = [:]
    private var staffLine: [String: LineSize] = [:]
    private var tick: Int = 0
    /// Lets tests make a timer look old without waiting.
    private var clockOffset: TimeInterval = 0

    init(signedIn: Bool = false, role: Role = .user) {
        self.signedIn = signedIn
        let staffBar: String? = role == .staff ? "00000000-0000-4000-8000-000000000001" : nil
        self.meValue = Me(
            id: "fake-user", role: role, waitThresholdMin: 20, staffBarId: staffBar,
            phoneHint: "ending in 00"
        )
    }

    private var now: Date { Date().addingTimeInterval(clockOffset) }

    func advanceClock(seconds: TimeInterval) {
        clockOffset += seconds
    }

    private func requireSignedIn() throws {
        if !signedIn {
            throw APIError.http(status: 401, detail: "not_authenticated")
        }
    }

    // MARK: Session

    func hasStoredSession() async -> Bool {
        return signedIn
    }

    func requestCode(phone: String) async throws -> CodeRequest {
        let digits = phone.filter { $0.isNumber }
        if digits.count < 10 {
            throw APIError.http(status: 422, detail: "validation_error")
        }
        return CodeRequest(expiresIn: 300, devCode: "123456")
    }

    func verifyCode(phone: String, code: String, ageAttested: Bool) async throws -> Me {
        if code.count != 6 || !code.allSatisfy({ $0.isNumber }) {
            throw APIError.http(status: 400, detail: "invalid_code")
        }
        if !ageAttested {
            throw APIError.http(status: 403, detail: "age_gate")
        }
        signedIn = true
        meValue.phoneHint = "ending in \(String(phone.suffix(2)))"
        return meValue
    }

    func signOut() async {
        signedIn = false
        session = nil
    }

    // MARK: Me

    func me() async throws -> Me {
        try requireSignedIn()
        return meValue
    }

    func updateThreshold(minutes: Int) async throws -> Me {
        try requireSignedIn()
        meValue.waitThresholdMin = min(120, max(5, minutes))
        return meValue
    }

    func deleteAccount() async throws {
        try requireSignedIn()
        signedIn = false
        session = nil
        meValue = Me(
            id: "fake-user", role: .user, waitThresholdMin: 20, staffBarId: nil, phoneHint: nil
        )
    }

    // MARK: Bars

    private func liveFor(_ bar: FakeBar) -> Live {
        guard bar.hasData else {
            return Live.noData
        }
        let wobble = bar.swing == 0 ? 0 : (tick % (bar.swing * 2 + 1)) - bar.swing
        let wait = max(0, bar.baseWait + wobble)
        let counts = staffCounts[bar.id]
        let headcount: Int
        if let counts {
            headcount = max(0, counts.ins - counts.outs)
        } else {
            headcount = Int(Double(bar.capacity) * bar.baseFill)
        }
        let ratio = Double(headcount) / Double(bar.capacity)
        let crowd: CrowdLevel = ratio >= 0.9 ? .packed : (ratio >= 0.6 ? .busy : .easy)
        var parts: [String] = []
        parts.append("\(bar.reports) report\(bar.reports == 1 ? "" : "s")")
        parts.append("\(bar.timers) timer\(bar.timers == 1 ? "" : "s")")
        let text = "Based on " + parts.joined(separator: ", ") + " and staff counts in the last 30 min"
        return Live(
            hasRecentData: true,
            waitMin: wait,
            waitLowMin: Int((Double(wait) * 0.75).rounded()),
            waitHighMin: Int((Double(wait) * 1.3).rounded()),
            crowdLevel: crowd,
            headcount: headcount,
            capacityRatio: ratio,
            confidence: bar.timers >= 2 ? .high : .medium,
            basis: Basis(
                text: text, windowMin: 30, reports: bar.reports, timers: bar.timers,
                doorEvents: 12, staffLineUpdates: 1
            ),
            flags: [],
            updatedAt: now
        )
    }

    private func verdictFor(_ bar: FakeBar, live: Live) -> Verdict {
        let threshold = meValue.waitThresholdMin
        guard live.hasRecentData, let wait = live.waitMin else {
            return Verdict(
                recommendation: .noData, text: "No recent data. No call yet.",
                thresholdMin: threshold, passPriceCents: bar.passPriceCents, minutesSaved: nil
            )
        }
        if wait > threshold {
            if let cents = bar.passPriceCents {
                return Verdict(
                    recommendation: .buyPass,
                    text: "Get the pass. Line is about \(wait) min, over your \(threshold) min limit. Pass is \(Money.format(cents: cents)).",
                    thresholdMin: threshold, passPriceCents: cents, minutesSaved: wait
                )
            }
            return Verdict(
                recommendation: .noPassAvailable,
                text: "Long line. About \(wait) min, over your \(threshold) min limit. No pass sold here.",
                thresholdMin: threshold, passPriceCents: nil, minutesSaved: nil
            )
        }
        return Verdict(
            recommendation: .waitItOut,
            text: "Wait it out. About \(wait) min, under your \(threshold) min limit.",
            thresholdMin: threshold, passPriceCents: bar.passPriceCents, minutesSaved: nil
        )
    }

    private func summary(_ bar: FakeBar) -> Bar {
        let live = liveFor(bar)
        return Bar(
            id: bar.id, slug: bar.slug, name: bar.name, address: bar.address,
            capacity: bar.capacity, passPriceCents: bar.passPriceCents, live: live,
            verdict: verdictFor(bar, live: live)
        )
    }

    func bars() async throws -> [Bar] {
        try requireSignedIn()
        tick += 1
        return fakeBars.map { summary($0) }
    }

    func bar(id: String) async throws -> BarDetail {
        try requireSignedIn()
        guard let bar = fakeBars.first(where: { $0.id == id }) else {
            throw APIError.http(status: 404, detail: "not_found")
        }
        let localHour = Calendar.current.component(.hour, from: now)
        var points: [HourPoint] = []
        var tonightEnded = false
        for (index, hour) in Self.hours.enumerated() {
            let typical = bar.typical[index]
            var tonight: Int? = nil
            if bar.hasData && !tonightEnded {
                tonight = Int((Double(typical) * 0.95).rounded())
            }
            if hour == localHour {
                tonightEnded = true
            }
            points.append(HourPoint(hour: hour, typicalWaitMin: typical, tonightWaitMin: tonight))
        }
        let normalIndex = Self.hours.firstIndex(of: localHour)
        let normal: Int? = normalIndex.map { bar.typical[$0] }
        return BarDetail(
            bar: summary(bar), latitude: 0, longitude: 0, normalWaitMin: normal,
            waitByHour: points
        )
    }

    // MARK: Sourcing

    func activeSession() async throws -> LineSession? {
        try requireSignedIn()
        return session
    }

    func startSession(barId: String, location: Coordinate?) async throws -> LineSession {
        try requireSignedIn()
        if session != nil {
            throw APIError.http(status: 409, detail: "session_already_active")
        }
        guard let bar = fakeBars.first(where: { $0.id == barId }) else {
            throw APIError.http(status: 404, detail: "not_found")
        }
        let started = LineSession(
            id: UUID().uuidString, barId: barId, status: .active, startedAt: now, endedAt: nil,
            predictedWaitMin: liveFor(bar).waitMin, actualWaitMin: nil,
            nearBar: location != nil, pointsAwarded: 0
        )
        session = started
        return started
    }

    func endSession(id: String, outcome: EndOutcome) async throws -> LineSession {
        try requireSignedIn()
        guard var current = session, current.id == id else {
            throw APIError.http(status: 404, detail: "not_found")
        }
        let ended = now
        let minutes = ended.timeIntervalSince(current.startedAt) / 60
        current.endedAt = ended
        if outcome == .inside && minutes >= 0.5 {
            current.status = .completed
            current.actualWaitMin = (minutes * 10).rounded() / 10
            current.pointsAwarded = current.nearBar ? 10 : 0
        } else {
            current.status = .abandoned
            current.pointsAwarded = 0
        }
        session = nil
        return current
    }

    func report(
        barId: String, crowd: CrowdLevel?, line: LineSize?, location: Coordinate?
    ) async throws -> ReportResult {
        try requireSignedIn()
        if crowd == nil && line == nil {
            throw APIError.http(status: 422, detail: "validation_error")
        }
        guard let index = fakeBars.firstIndex(where: { $0.id == barId }) else {
            throw APIError.http(status: 404, detail: "not_found")
        }
        fakeBars[index].reports += 1
        let near = location != nil
        return ReportResult(nearBar: near, pointsAwarded: near ? 2 : 0)
    }

    // MARK: Staff

    func redeemInvite(code: String) async throws -> Me {
        try requireSignedIn()
        let cleaned = code.replacingOccurrences(of: "-", with: "")
        if cleaned.count < 8 {
            throw APIError.http(status: 400, detail: "invalid_invite")
        }
        meValue.role = .staff
        meValue.staffBarId = fakeBars[0].id
        return meValue
    }

    private func requireStaff(_ barId: String) throws -> FakeBar {
        try requireSignedIn()
        guard meValue.staffBarId == barId, let bar = fakeBars.first(where: { $0.id == barId }) else {
            throw APIError.http(status: 404, detail: "not_found")
        }
        return bar
    }

    private func staffStateFor(_ bar: FakeBar) -> StaffState {
        let counts = staffCounts[bar.id] ?? (ins: Int(Double(bar.capacity) * bar.baseFill), outs: 0)
        return StaffState(
            barId: bar.id, barName: bar.name, capacity: bar.capacity,
            headcount: max(0, counts.ins - counts.outs), entriesTonight: counts.ins,
            exitsTonight: counts.outs, lineSize: staffLine[bar.id],
            lineUpdatedAt: staffLine[bar.id] == nil ? nil : now, live: liveFor(bar)
        )
    }

    func staffState(barId: String) async throws -> StaffState {
        let bar = try requireStaff(barId)
        return staffStateFor(bar)
    }

    func door(barId: String, direction: DoorDirection, count: Int) async throws -> StaffState {
        let bar = try requireStaff(barId)
        var counts = staffCounts[bar.id] ?? (ins: Int(Double(bar.capacity) * bar.baseFill), outs: 0)
        switch direction {
        case .entry:
            counts.ins += count
        case .exit:
            if counts.ins - counts.outs - count < 0 {
                throw APIError.http(status: 409, detail: "headcount_below_zero")
            }
            counts.outs += count
        }
        staffCounts[bar.id] = counts
        return staffStateFor(bar)
    }

    func setLine(barId: String, size: LineSize) async throws -> StaffState {
        let bar = try requireStaff(barId)
        staffLine[bar.id] = size
        return staffStateFor(bar)
    }
}

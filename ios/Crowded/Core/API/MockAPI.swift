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
        /// False for bars that only count entries at the door.
        var countsExits: Bool = true
        /// FAKE starting drink wait, replaced once staff or a student reports one.
        var drinkWait: DrinkWait? = nil
    }

    static let hours: [Int] = [18, 19, 20, 21, 22, 23, 0, 1, 2, 3]

    private var fakeBars: [FakeBar] = [
        FakeBar(
            id: "00000000-0000-4000-8000-000000000001", slug: "fake-tipsy-owl",
            name: "FAKE The Tipsy Owl", address: "101 Fake College Ave", capacity: 220,
            passPriceCents: 1500, baseWait: 28, swing: 7, baseFill: 0.93, reports: 7, timers: 3,
            hasData: true, typical: [2, 5, 12, 22, 30, 34, 31, 24, 14, 6],
            countsExits: true, drinkWait: .tenToTwenty
        ),
        FakeBar(
            id: "00000000-0000-4000-8000-000000000002", slug: "fake-copper-lantern",
            name: "FAKE Copper Lantern", address: "22 Pretend St", capacity: 150,
            passPriceCents: 1000, baseWait: 11, swing: 4, baseFill: 0.71, reports: 4, timers: 1,
            hasData: true, typical: [0, 2, 5, 9, 13, 15, 14, 10, 6, 2],
            countsExits: false, drinkWait: .fiveToTen
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
    private var specials: [String: [Special]]
    /// Lets tests make a timer look old without waiting.
    private var clockOffset: TimeInterval = 0
    private var offline: Bool = false
    private var samples: [String: [LineSample]] = [:]
    /// What door staff last said about the inside, per bar.
    private var insideStatus: [String: InsideStatus] = [:]
    /// Latest drink wait from staff or a student report, per bar.
    private var drinkOverride: [String: DrinkWait] = [:]

    /// `staffLevel` only matters for staff. It defaults to manager so the specials editor works
    /// in demos. Pass `.door` to preview the door staff view.
    init(signedIn: Bool = false, role: Role = .user, staffLevel: StaffLevel = .manager) {
        self.signedIn = signedIn
        self.specials = Self.seedSpecials()
        let staffBar: String? = role == .staff ? "00000000-0000-4000-8000-000000000001" : nil
        self.meValue = Me(
            id: "fake-user", role: role, waitThresholdMin: 20, staffBarId: staffBar,
            phoneHint: "ending in 00",
            staffLevel: role == .staff ? staffLevel : nil
        )
    }

    /// Lets previews and tests switch the mock staff user between door and manager.
    func setStaffLevel(_ level: StaffLevel) {
        meValue.staffLevel = level
    }

    private var now: Date { Date().addingTimeInterval(clockOffset) }

    func advanceClock(seconds: TimeInterval) {
        clockOffset += seconds
    }

    /// Lets tests simulate a dead connection. Staff calls then throw APIError.network.
    func setOffline(_ value: Bool) {
        offline = value
    }

    private func requireOnline() throws {
        if offline {
            throw APIError.network
        }
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
            id: "fake-user", role: .user, waitThresholdMin: 20, staffBarId: nil, phoneHint: nil,
            staffLevel: nil
        )
    }

    // MARK: Bars

    private func liveFor(_ bar: FakeBar) -> Live {
        let drink = drinkOverride[bar.id] ?? bar.drinkWait
        guard bar.hasData else {
            var empty = Live.noData
            if let reported = drinkOverride[bar.id] {
                empty.drinkWait = reported
                empty.drinkWaitLabel = reported.fullLabel
            }
            return empty
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
        let computed: CrowdLevel = ratio >= 0.9 ? .packed : (ratio >= 0.6 ? .busy : .easy)
        let crowd: CrowdLevel = insideStatus[bar.id]?.crowdLevel ?? computed
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
            updatedAt: now,
            drinkWait: drink,
            drinkWaitLabel: drink?.fullLabel
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
        let tonight = SpecialSchedule.tonight(
            specials[bar.id] ?? [], now: now, calendar: Calendar.current)
        return Bar(
            id: bar.id, slug: bar.slug, name: bar.name, address: bar.address,
            capacity: bar.capacity, passPriceCents: bar.passPriceCents, live: live,
            verdict: verdictFor(bar, live: live),
            specialsTonight: tonight, coverTonight: SpecialSchedule.cover(in: tonight)
        )
    }

    /// FAKE specials. Owl has all night drafts, a four item happy hour, a DJ event, a food item
    /// with a note and a cover. Lantern has a cover every night and a small mixer menu.
    private static func seedSpecials() -> [String: [Special]] {
        let owl = "00000000-0000-4000-8000-000000000001"
        let lantern = "00000000-0000-4000-8000-000000000002"
        let hoursAgo: (Double) -> Date = { Date().addingTimeInterval(-$0 * 3600) }
        let everyNight = [0, 1, 2, 3, 4, 5, 6]
        return [
            owl: [
                Special(
                    id: "fake-special-1", kind: .drink, title: "FAKE All night drafts",
                    details: "", days: everyNight,
                    startLocal: "12:00", endLocal: "04:00", priceCents: nil, isActive: true,
                    postedBy: .bar, updatedAt: hoursAgo(2), allDay: true,
                    items: [
                        DealItem(name: "Lager drafts", priceLabel: "$3", category: .beer)
                    ]
                ),
                Special(
                    id: "fake-special-2", kind: .happyHour, title: "FAKE Happy hour",
                    details: "", days: everyNight,
                    startLocal: "21:00", endLocal: "00:00", priceCents: nil, isActive: true,
                    postedBy: .bar, updatedAt: hoursAgo(3),
                    items: [
                        DealItem(name: "Double wells", priceLabel: "$2", category: .mixers),
                        DealItem(name: "Drafts", priceLabel: "$2", category: .beer),
                        DealItem(name: "Well mixers", priceLabel: "$1", category: .mixers),
                        DealItem(name: "Shots", priceLabel: "$3", category: .shots),
                    ]
                ),
                Special(
                    id: "fake-special-3", kind: .event, title: "FAKE DJ",
                    details: "", days: [3, 4, 5],
                    startLocal: "21:00", endLocal: "02:00", priceCents: nil, isActive: true,
                    postedBy: .bar, updatedAt: hoursAgo(26)
                ),
                Special(
                    id: "fake-special-4", kind: .food, title: "FAKE Wing night",
                    details: "", days: [2],
                    startLocal: "17:00", endLocal: "22:00", priceCents: nil, isActive: true,
                    postedBy: .bar, updatedAt: hoursAgo(50),
                    items: [
                        DealItem(
                            name: "Ten wings", priceLabel: "$6", category: .food,
                            note: "Dine in only")
                    ]
                ),
                Special(
                    id: "fake-special-5", kind: .cover, title: "FAKE Cover",
                    details: "", days: [3, 4, 5],
                    startLocal: "21:00", endLocal: "02:00", priceCents: 500, isActive: true,
                    postedBy: .bar, updatedAt: hoursAgo(26)
                ),
            ],
            lantern: [
                Special(
                    id: "fake-special-6", kind: .cover, title: "FAKE Cover",
                    details: "", days: everyNight,
                    startLocal: "18:00", endLocal: "02:00", priceCents: 1000, isActive: true,
                    postedBy: .crowded, updatedAt: hoursAgo(5)
                ),
                Special(
                    id: "fake-special-7", kind: .drink, title: "FAKE Mixer deals",
                    details: "", days: [0, 1, 2, 3, 4],
                    startLocal: "19:00", endLocal: "22:00", priceCents: nil, isActive: true,
                    postedBy: .bar, updatedAt: hoursAgo(8),
                    items: [
                        DealItem(name: "Well mixers", priceLabel: "$3", category: .mixers),
                        DealItem(name: "House wine", priceLabel: "$4", category: .wine),
                    ]
                ),
            ],
        ]
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
        let week = (specials[bar.id] ?? []).filter { $0.isActive }
        return BarDetail(
            bar: summary(bar), latitude: 0, longitude: 0, normalWaitMin: normal,
            waitByHour: points, specialsWeek: week
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

    func endSession(id: String, outcome: EndOutcome, doorCode: String?) async throws -> LineSession {
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
            // The door code is off. A typed code is ignored, like the server does.
            current.verified = false
            current.pointsAwarded = current.nearBar ? 10 : 0
        } else {
            current.status = .abandoned
            current.pointsAwarded = 0
        }
        session = nil
        return current
    }

    func report(
        barId: String, crowd: CrowdLevel?, line: LineSize?, drinkWait: DrinkWait?,
        location: Coordinate?
    ) async throws -> ReportResult {
        try requireSignedIn()
        if crowd == nil && line == nil && drinkWait == nil {
            throw APIError.http(status: 422, detail: "validation_error")
        }
        guard let index = fakeBars.firstIndex(where: { $0.id == barId }) else {
            throw APIError.http(status: 404, detail: "not_found")
        }
        fakeBars[index].reports += 1
        if let drinkWait {
            drinkOverride[barId] = drinkWait
        }
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
        if meValue.staffLevel == nil {
            meValue.staffLevel = .door
        }
        return meValue
    }

    private func requireStaff(_ barId: String) throws -> FakeBar {
        try requireSignedIn()
        guard meValue.staffBarId == barId, let bar = fakeBars.first(where: { $0.id == barId }) else {
            throw APIError.http(status: 404, detail: "not_found")
        }
        return bar
    }

    /// Mirrors the server: specials and settings are manager only.
    private func requireManager(_ barId: String) throws -> FakeBar {
        let bar = try requireStaff(barId)
        if meValue.staffLevel != .manager && meValue.role != .admin {
            throw APIError.http(status: 403, detail: "manager_only")
        }
        return bar
    }

    private func staffStateFor(_ bar: FakeBar) -> StaffState {
        let counts = staffCounts[bar.id] ?? (ins: Int(Double(bar.capacity) * bar.baseFill), outs: 0)
        return StaffState(
            barId: bar.id, barName: bar.name, capacity: bar.capacity,
            headcount: max(0, counts.ins - counts.outs), entriesTonight: counts.ins,
            exitsTonight: counts.outs, lineSize: staffLine[bar.id],
            lineUpdatedAt: staffLine[bar.id] == nil ? nil : now, live: liveFor(bar),
            countsExits: bar.countsExits, inside: insideStatus[bar.id]
        )
    }

    func staffState(barId: String) async throws -> StaffState {
        try requireOnline()
        let bar = try requireStaff(barId)
        return staffStateFor(bar)
    }

    func door(barId: String, direction: DoorDirection, count: Int) async throws -> StaffState {
        try requireOnline()
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

    func postInside(barId: String, crowd: CrowdLevel?, drinkWait: DrinkWait?) async throws -> StaffState {
        try requireOnline()
        let bar = try requireStaff(barId)
        if crowd == nil && drinkWait == nil {
            throw APIError.http(status: 422, detail: "validation_error")
        }
        var status = insideStatus[bar.id] ?? InsideStatus(crowdLevel: nil, drinkWait: nil, updatedAt: nil)
        if let crowd { status.crowdLevel = crowd }
        if let drinkWait {
            status.drinkWait = drinkWait
            drinkOverride[bar.id] = drinkWait
        }
        status.updatedAt = now
        insideStatus[bar.id] = status
        return staffStateFor(bar)
    }

    func setCountsExits(barId: String, value: Bool) async throws -> StaffState {
        try requireOnline()
        let bar = try requireManager(barId)
        guard let index = fakeBars.firstIndex(where: { $0.id == bar.id }) else {
            throw APIError.http(status: 404, detail: "not_found")
        }
        fakeBars[index].countsExits = value
        return staffStateFor(fakeBars[index])
    }

    // MARK: Staff line samples, door code, clicker sync

    func startLineSample(barId: String) async throws -> LineSample {
        try requireOnline()
        let bar = try requireStaff(barId)
        var list = samples[bar.id] ?? []
        if list.count >= 2 {
            throw APIError.http(status: 409, detail: "too_many_active_samples")
        }
        let sample = LineSample(
            id: UUID().uuidString, barId: bar.id, status: .active, startedAt: now,
            endedAt: nil, actualWaitMin: nil
        )
        list.append(sample)
        samples[bar.id] = list
        return sample
    }

    func endLineSample(barId: String, sampleId: String, outcome: SampleOutcome) async throws -> LineSample {
        try requireOnline()
        let bar = try requireStaff(barId)
        var list = samples[bar.id] ?? []
        guard let index = list.firstIndex(where: { $0.id == sampleId }) else {
            throw APIError.http(status: 409, detail: "sample_not_active")
        }
        var sample = list.remove(at: index)
        samples[bar.id] = list
        let ended = now
        let minutes = ended.timeIntervalSince(sample.startedAt) / 60
        sample.endedAt = ended
        if outcome == .inside && minutes >= 0.5 {
            sample.status = .completed
            sample.actualWaitMin = (minutes * 10).rounded() / 10
        } else {
            sample.status = .abandoned
        }
        return sample
    }

    func activeLineSamples(barId: String) async throws -> [LineSample] {
        try requireOnline()
        let bar = try requireStaff(barId)
        return samples[bar.id] ?? []
    }

    func doorCode(barId: String) async throws -> DoorCode {
        try requireOnline()
        _ = try requireStaff(barId)
        // The door code is off by default on the server.
        throw APIError.http(status: 404, detail: "door_code_disabled")
    }

    func countSync(barId: String, insideNow: Int) async throws -> StaffState {
        try requireOnline()
        let bar = try requireStaff(barId)
        if insideNow < 0 || insideNow > 5000 {
            throw APIError.http(status: 422, detail: "validation_error")
        }
        var counts = staffCounts[bar.id] ?? (ins: Int(Double(bar.capacity) * bar.baseFill), outs: 0)
        let delta = insideNow - (counts.ins - counts.outs)
        if delta > 0 {
            counts.ins += delta
        } else if delta < 0 {
            counts.outs += -delta
        }
        staffCounts[bar.id] = counts
        return staffStateFor(bar)
    }

    // MARK: Staff specials

    private static func sortedSpecials(_ list: [Special]) -> [Special] {
        return list.sorted { a, b in
            let da = a.days.min() ?? 0
            let db = b.days.min() ?? 0
            if da != db { return da < db }
            if a.startLocal != b.startLocal { return a.startLocal < b.startLocal }
            return a.title < b.title
        }
    }

    private func checkSpecial(
        days: [Int]?, start: String?, end: String?, title: String?, items: [DealItem]? = nil
    ) throws {
        if let items {
            let bad = items.contains {
                $0.name.trimmingCharacters(in: .whitespaces).isEmpty
                    || $0.priceLabel.trimmingCharacters(in: .whitespaces).isEmpty
            }
            if items.count > 20 || bad {
                throw APIError.http(status: 422, detail: "validation_error")
            }
        }
        if let title, title.trimmingCharacters(in: .whitespaces).isEmpty {
            throw APIError.http(status: 422, detail: "validation_error")
        }
        if let days, days.isEmpty || days.contains(where: { $0 < 0 || $0 > 6 }) {
            throw APIError.http(status: 422, detail: "validation_error")
        }
        for time in [start, end] {
            if let time, SpecialTime.parse(time) == nil {
                throw APIError.http(status: 422, detail: "validation_error")
            }
        }
    }

    func listSpecials(barID: String) async throws -> [Special] {
        let bar = try requireManager(barID)
        return Self.sortedSpecials(specials[bar.id] ?? [])
    }

    func createSpecial(barID: String, input: SpecialInput) async throws -> Special {
        let bar = try requireManager(barID)
        try checkSpecial(
            days: input.days, start: input.startLocal, end: input.endLocal, title: input.title,
            items: input.items)
        if !input.allDay && input.startLocal == input.endLocal {
            throw APIError.http(status: 422, detail: "start_equals_end")
        }
        var list = specials[bar.id] ?? []
        if list.count >= 30 {
            throw APIError.http(status: 409, detail: "too_many_specials")
        }
        let created = Special(
            id: UUID().uuidString, kind: input.kind, title: input.title, details: input.details,
            days: input.days.sorted(),
            startLocal: input.allDay ? "12:00" : input.startLocal,
            endLocal: input.allDay ? "04:00" : input.endLocal,
            priceCents: input.priceCents, isActive: true, postedBy: .bar, updatedAt: now,
            allDay: input.allDay, items: input.items
        )
        list.append(created)
        specials[bar.id] = list
        return created
    }

    func updateSpecial(barID: String, specialID: String, update: SpecialPatch) async throws -> Special {
        let bar = try requireManager(barID)
        var list = specials[bar.id] ?? []
        guard let index = list.firstIndex(where: { $0.id == specialID }) else {
            throw APIError.http(status: 404, detail: "not_found")
        }
        try checkSpecial(
            days: update.days, start: update.startLocal, end: update.endLocal, title: update.title,
            items: update.items)
        var item = list[index]
        if let kind = update.kind { item.kind = kind }
        if let title = update.title { item.title = title }
        if let details = update.details { item.details = details }
        if let days = update.days { item.days = days.sorted() }
        if let start = update.startLocal { item.startLocal = start }
        if let end = update.endLocal { item.endLocal = end }
        if let price = update.priceCents { item.priceCents = price }
        if let active = update.isActive { item.isActive = active }
        if let items = update.items { item.items = items }
        if let allDay = update.allDay { item.allDay = allDay }
        if item.allDay {
            item.startLocal = "12:00"
            item.endLocal = "04:00"
        }
        if item.startLocal == item.endLocal {
            throw APIError.http(status: 422, detail: "start_equals_end")
        }
        item.updatedAt = now
        list[index] = item
        specials[bar.id] = list
        return item
    }

    func deleteSpecial(barID: String, specialID: String) async throws {
        let bar = try requireManager(barID)
        var list = specials[bar.id] ?? []
        guard let index = list.firstIndex(where: { $0.id == specialID }) else {
            throw APIError.http(status: 404, detail: "not_found")
        }
        list.remove(at: index)
        specials[bar.id] = list
    }
}

import Foundation
import Observation

/// One door tap waiting to reach the server.
struct QueuedTap: Equatable, Sendable {
    var direction: DoorDirection
    var count: Int
}

/// The last tap, kept for Undo.
struct LastTap: Equatable, Sendable {
    var direction: DoorDirection
    var count: Int
    var at: Date
}

/// A line size or timing reminder shown as a banner while the door tab is open.
enum DoorReminder: Equatable, Sendable {
    case updateLine
    case updateInside
    case timeLine

    var text: String {
        switch self {
        case .updateLine: return "Update the line size"
        case .updateInside: return "Update inside"
        case .timeLine: return "Time the line"
        }
    }
}

/// Door mode for bar staff. Optimistic: the number moves on tap, then reconciles with the
/// server's count. Taps that fail because of the network wait in a memory queue and retry with
/// backoff. Nothing is written to disk.
@Observable
@MainActor
final class StaffViewModel {
    static let undoWindow: TimeInterval = 30
    static let lineReminderInterval: TimeInterval = 15 * 60
    static let insideReminderInterval: TimeInterval = 15 * 60
    static let sampleReminderInterval: TimeInterval = 20 * 60
    static let maxActiveSamples = 2

    var state: StaffState?
    var inviteCode: String = ""
    var isRedeeming: Bool = false
    var errorMessage: String?
    var pendingDelta: Int = 0

    /// Door or manager. Set by the view from the signed in user. Anything but manager gets the
    /// door view, so an unknown level is treated as door.
    var staffLevel: StaffLevel?

    /// Taps not yet saved. Shown as "Saving when back online".
    private(set) var queue: [QueuedTap] = []
    private(set) var lastTap: LastTap?

    // Line samples
    private(set) var samples: [LineSample] = []
    private(set) var lastCheck: LineSample?
    var sampleError: String?

    // Reminders
    var reminder: DoorReminder?
    @ObservationIgnored private var openedAt: Date
    @ObservationIgnored private var lastLineReminderAt: Date?
    @ObservationIgnored private var lastInsideReminderAt: Date?
    @ObservationIgnored private var lastSampleReminderAt: Date?

    /// Tests replace this to move time without waiting.
    @ObservationIgnored var clock: () -> Date = { Date() }

    private let api: CrowdedAPI
    private let poller: Poller
    private let retryDelays: [TimeInterval]
    @ObservationIgnored private var flushTask: Task<Void, Never>?

    init(
        api: CrowdedAPI,
        pollInterval: TimeInterval = 15,
        retryDelays: [TimeInterval] = [1, 2, 4, 8, 15]
    ) {
        self.api = api
        self.poller = Poller(interval: pollInterval)
        self.retryDelays = retryDelays.isEmpty ? [1] : retryDelays
        self.openedAt = Date()
    }

    var displayedHeadcount: Int {
        return max(0, (state?.headcount ?? 0) + pendingDelta)
    }

    /// Only managers see the Manage section and the specials editor.
    var canManage: Bool {
        return staffLevel == .manager
    }

    /// False for bars that only count people in. Older servers omit it, which reads as true.
    var countsExits: Bool {
        return state?.countsExits ?? true
    }

    /// Entries tonight with taps that are still saving. At a bar that counts entries only, the
    /// only OUT events are Undo taps, so entries net of undone taps is the same as the count.
    var displayedEntries: Int {
        if !countsExits {
            return displayedHeadcount
        }
        return max(0, (state?.entriesTonight ?? 0) + pendingDelta)
    }

    var capacityPercent: Int {
        guard let state, state.capacity > 0 else { return 0 }
        return Int((Double(displayedHeadcount) / Double(state.capacity) * 100).rounded())
    }

    var isSavingOffline: Bool {
        return !queue.isEmpty
    }

    var canRedeem: Bool {
        return inviteCode.replacingOccurrences(of: "-", with: "").count >= 8 && !isRedeeming
    }

    func redeem() async -> Me? {
        isRedeeming = true
        errorMessage = nil
        defer { isRedeeming = false }
        do {
            return try await api.redeemInvite(code: inviteCode.uppercased())
        } catch {
            errorMessage = APIError.wrap(error).errorDescription
            return nil
        }
    }

    // MARK: Loading

    func load(barId: String) async {
        do {
            state = try await api.staffState(barId: barId)
            errorMessage = nil
        } catch {
            errorMessage = APIError.wrap(error).errorDescription
        }
        if !queue.isEmpty {
            startFlush(barId: barId)
        }
    }

    func startPolling(barId: String) {
        poller.start { [weak self] in
            await self?.load(barId: barId)
        }
    }

    func stopPolling() {
        poller.stop()
        flushTask?.cancel()
        flushTask = nil
    }

    /// Call when the door tab appears. Resets the reminder clock.
    func doorOpened() {
        openedAt = clock()
        lastLineReminderAt = nil
        lastInsideReminderAt = nil
        lastSampleReminderAt = nil
        reminder = nil
    }

    // MARK: Door taps

    private func isRetryable(_ error: Error) -> Bool {
        let api = APIError.wrap(error)
        if case .network = api {
            return true
        }
        if let status = api.status {
            return status >= 500 || status == 429
        }
        return false
    }

    /// Counts one tap or a group. Moves the number now, saves in the background.
    func count(barId: String, direction: DoorDirection, by amount: Int = 1, recordUndo: Bool = true) async {
        // Out taps are ignored at bars that count entries only. Undo of an entry still goes through.
        if direction == .exit && recordUndo && !countsExits {
            return
        }
        let delta = direction == .entry ? amount : -amount
        if direction == .exit && displayedHeadcount - amount < 0 {
            errorMessage = APIError.http(status: 409, detail: "headcount_below_zero").errorDescription
            return
        }
        pendingDelta += delta
        if recordUndo {
            lastTap = LastTap(direction: direction, count: amount, at: clock())
        }
        let tap = QueuedTap(direction: direction, count: amount)
        // Keep order: if older taps are waiting, this one waits behind them.
        if !queue.isEmpty {
            queue.append(tap)
            startFlush(barId: barId)
            return
        }
        do {
            let fresh = try await api.door(barId: barId, direction: direction, count: amount)
            pendingDelta -= delta
            state = fresh
            errorMessage = nil
        } catch {
            if isRetryable(error) {
                queue.append(tap)
                startFlush(barId: barId)
            } else {
                pendingDelta -= delta
                if recordUndo { lastTap = nil }
                errorMessage = APIError.wrap(error).errorDescription
            }
        }
    }

    /// True while Undo is allowed for the last tap.
    func canUndo(at date: Date) -> Bool {
        guard let lastTap else { return false }
        return date.timeIntervalSince(lastTap.at) <= Self.undoWindow
    }

    /// Sends the opposite event for the last tap.
    func undo(barId: String) async {
        guard let tap = lastTap, canUndo(at: clock()) else {
            lastTap = nil
            return
        }
        lastTap = nil
        let opposite: DoorDirection = tap.direction == .entry ? .exit : .entry
        await count(barId: barId, direction: opposite, by: tap.count, recordUndo: false)
    }

    private func startFlush(barId: String) {
        if flushTask != nil { return }
        flushTask = Task { @MainActor [weak self] in
            await self?.runFlush(barId: barId)
            self?.flushTask = nil
        }
    }

    /// Waits until the queue is empty or retrying is stopped. Safe to call twice.
    func flushQueue(barId: String) async {
        startFlush(barId: barId)
        await flushTask?.value
    }

    private func runFlush(barId: String) async {
        var attempt = 0
        while !queue.isEmpty && !Task.isCancelled {
            let tap = queue[0]
            let delta = tap.direction == .entry ? tap.count : -tap.count
            do {
                let fresh = try await api.door(barId: barId, direction: tap.direction, count: tap.count)
                if !queue.isEmpty { queue.removeFirst() }
                pendingDelta -= delta
                state = fresh
                errorMessage = nil
                attempt = 0
            } catch {
                if isRetryable(error) {
                    let index = min(attempt, retryDelays.count - 1)
                    attempt += 1
                    try? await Task.sleep(nanoseconds: UInt64(retryDelays[index] * 1_000_000_000))
                } else {
                    // The server refused this tap for good. Drop it so the rest can go.
                    if !queue.isEmpty { queue.removeFirst() }
                    pendingDelta -= delta
                    errorMessage = APIError.wrap(error).errorDescription
                }
            }
        }
    }

    // MARK: Line size and clicker total

    func setLine(barId: String, size: LineSize) async {
        do {
            state = try await api.setLine(barId: barId, size: size)
            errorMessage = nil
            reminder = reminder == .updateLine ? nil : reminder
        } catch {
            errorMessage = APIError.wrap(error).errorDescription
        }
    }

    /// Sets "inside now" from a clicker total. Returns true when saved.
    @discardableResult
    func syncCount(barId: String, insideNow: Int) async -> Bool {
        if insideNow < 0 || insideNow > 5000 {
            errorMessage = APIError.http(status: 422, detail: "validation_error").errorDescription
            return false
        }
        do {
            state = try await api.countSync(barId: barId, insideNow: insideNow)
            // The total replaces any guesses we were holding.
            pendingDelta = queue.reduce(0) { total, tap in
                total + (tap.direction == .entry ? tap.count : -tap.count)
            }
            lastTap = nil
            errorMessage = nil
            return true
        } catch {
            errorMessage = APIError.wrap(error).errorDescription
            return false
        }
    }

    // MARK: Line samples

    var canStartSample: Bool {
        return samples.count < Self.maxActiveSamples
    }

    func loadSamples(barId: String) async {
        do {
            samples = try await api.activeLineSamples(barId: barId)
        } catch {
            sampleError = APIError.wrap(error).errorDescription
        }
    }

    func startSample(barId: String) async {
        if !canStartSample {
            sampleError = APIError.http(status: 409, detail: "too_many_active_samples").errorDescription
            return
        }
        do {
            let sample = try await api.startLineSample(barId: barId)
            samples.append(sample)
            sampleError = nil
            if reminder == .timeLine { reminder = nil }
        } catch {
            sampleError = APIError.wrap(error).errorDescription
        }
    }

    func endSample(barId: String, sampleId: String, outcome: SampleOutcome) async {
        do {
            let done = try await api.endLineSample(barId: barId, sampleId: sampleId, outcome: outcome)
            samples.removeAll { $0.id == sampleId }
            sampleError = nil
            if done.status == .completed {
                lastCheck = done
            }
        } catch {
            sampleError = APIError.wrap(error).errorDescription
            if APIError.wrap(error).detail == "sample_not_active" {
                samples.removeAll { $0.id == sampleId }
            }
        }
    }

    /// "Last line check: 14 min, 6 min ago", or nil before the first finished check.
    func lastCheckText(at date: Date) -> String? {
        guard let lastCheck, let wait = lastCheck.actualWaitMin else { return nil }
        let ended = lastCheck.endedAt ?? date
        let ago = max(0, Int((date.timeIntervalSince(ended) / 60).rounded(.down)))
        return "Last line check: \(Int(wait.rounded())) min, \(ago) min ago"
    }

    // MARK: Inside conditions and settings

    /// One tap on "How busy inside?" or "How long for a drink?". Sends only the field tapped.
    func postInside(barId: String, crowd: CrowdLevel? = nil, drinkWait: DrinkWait? = nil) async {
        if crowd == nil && drinkWait == nil { return }
        do {
            state = try await api.postInside(barId: barId, crowd: crowd, drinkWait: drinkWait)
            errorMessage = nil
            reminder = reminder == .updateInside ? nil : reminder
        } catch {
            errorMessage = APIError.wrap(error).errorDescription
        }
    }

    /// "Updated 4 min ago", or nil before the first inside update.
    func insideUpdatedText(at date: Date) -> String? {
        guard let updated = state?.inside?.updatedAt else { return nil }
        let minutes = max(0, Int((date.timeIntervalSince(updated) / 60).rounded(.down)))
        if minutes < 1 {
            return "Updated just now"
        }
        return "Updated \(minutes) min ago"
    }

    /// Manager only. Turns exit counting on or off for the bar.
    func setCountsExits(barId: String, value: Bool) async {
        if !canManage {
            errorMessage = APIError.http(status: 403, detail: "manager_only").errorDescription
            return
        }
        do {
            state = try await api.setCountsExits(barId: barId, value: value)
            errorMessage = nil
        } catch {
            errorMessage = APIError.wrap(error).errorDescription
        }
    }

    // MARK: Reminders

    /// Checks the 15 minute line and inside reminders and the 20 minute timing reminder. Returns
    /// true when a new one appeared, so the view can fire a haptic. In app only, no push. If
    /// several are due at once, the banner shows the first of line, inside, timing.
    @discardableResult
    func evaluateReminders() -> Bool {
        let current = clock()
        var due: [DoorReminder] = []

        let lineRef = state?.lineUpdatedAt ?? openedAt
        let lineSince = current.timeIntervalSince(max(lineRef, openedAt))
        let lineLast = lastLineReminderAt.map { current.timeIntervalSince($0) } ?? .infinity
        if lineSince >= Self.lineReminderInterval && lineLast >= Self.lineReminderInterval {
            lastLineReminderAt = current
            due.append(.updateLine)
        }

        let insideRef = state?.inside?.updatedAt ?? openedAt
        let insideSince = current.timeIntervalSince(max(insideRef, openedAt))
        let insideLast = lastInsideReminderAt.map { current.timeIntervalSince($0) } ?? .infinity
        if insideSince >= Self.insideReminderInterval && insideLast >= Self.insideReminderInterval {
            lastInsideReminderAt = current
            due.append(.updateInside)
        }

        if samples.isEmpty {
            let sampleRef = lastCheck?.endedAt ?? openedAt
            let sampleSince = current.timeIntervalSince(max(sampleRef, openedAt))
            let sampleLast = lastSampleReminderAt.map { current.timeIntervalSince($0) } ?? .infinity
            if sampleSince >= Self.sampleReminderInterval && sampleLast >= Self.sampleReminderInterval {
                lastSampleReminderAt = current
                due.append(.timeLine)
            }
        }

        if let first = due.first {
            reminder = first
            return true
        }
        return false
    }

    func dismissReminder() {
        reminder = nil
    }
}

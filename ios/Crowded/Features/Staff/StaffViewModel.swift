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
    case timeLine

    var text: String {
        switch self {
        case .updateLine: return "Update the line size"
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
    static let sampleReminderInterval: TimeInterval = 20 * 60
    static let maxActiveSamples = 2

    var state: StaffState?
    var inviteCode: String = ""
    var isRedeeming: Bool = false
    var errorMessage: String?
    var pendingDelta: Int = 0

    /// Taps not yet saved. Shown as "Saving when back online".
    private(set) var queue: [QueuedTap] = []
    private(set) var lastTap: LastTap?

    // Line samples
    private(set) var samples: [LineSample] = []
    private(set) var lastCheck: LineSample?
    var sampleError: String?

    // Door code
    private(set) var doorCode: DoorCode?
    private(set) var doorCodeFetchedAt: Date?
    @ObservationIgnored private var doorCodeLastAttempt: Date?

    // Reminders
    var reminder: DoorReminder?
    @ObservationIgnored private var openedAt: Date
    @ObservationIgnored private var lastLineReminderAt: Date?
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

    // MARK: Door code

    func loadDoorCode(barId: String) async {
        doorCodeLastAttempt = clock()
        do {
            doorCode = try await api.doorCode(barId: barId)
            doorCodeFetchedAt = clock()
        } catch {
            // Keep showing the old code until it expires. Do not show a stale one after that.
        }
    }

    func doorCodeSecondsLeft(at date: Date) -> Int {
        guard let doorCode, let fetched = doorCodeFetchedAt else { return 0 }
        let used = date.timeIntervalSince(fetched)
        return max(0, Int((Double(doorCode.expiresIn) - used).rounded(.up)))
    }

    /// Refresh when the code ran out or is about to.
    func refreshDoorCodeIfNeeded(barId: String) async {
        let current = clock()
        if let last = doorCodeLastAttempt, current.timeIntervalSince(last) < 5 {
            return
        }
        if doorCode == nil || doorCodeSecondsLeft(at: current) <= 1 {
            await loadDoorCode(barId: barId)
        }
    }

    // MARK: Reminders

    /// Checks the 15 and 20 minute reminders. Returns true when a new one appeared, so the view
    /// can fire a haptic. In app only, no push.
    @discardableResult
    func evaluateReminders() -> Bool {
        let current = clock()
        let lineRef = state?.lineUpdatedAt ?? openedAt
        let lineSince = current.timeIntervalSince(max(lineRef, openedAt))
        let lineLast = lastLineReminderAt.map { current.timeIntervalSince($0) } ?? .infinity
        if lineSince >= Self.lineReminderInterval && lineLast >= Self.lineReminderInterval {
            lastLineReminderAt = current
            reminder = .updateLine
            return true
        }
        if samples.isEmpty {
            let sampleRef = lastCheck?.endedAt ?? openedAt
            let sampleSince = current.timeIntervalSince(max(sampleRef, openedAt))
            let sampleLast = lastSampleReminderAt.map { current.timeIntervalSince($0) } ?? .infinity
            if sampleSince >= Self.sampleReminderInterval && sampleLast >= Self.sampleReminderInterval {
                lastSampleReminderAt = current
                reminder = .timeLine
                return true
            }
        }
        return false
    }

    func dismissReminder() {
        reminder = nil
    }
}

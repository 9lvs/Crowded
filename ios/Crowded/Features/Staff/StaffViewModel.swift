import Foundation
import Observation

/// Door counter for bar staff. Optimistic: the number moves on tap, then reconciles with the
/// server's count.
@Observable
@MainActor
final class StaffViewModel {
    var state: StaffState?
    var inviteCode: String = ""
    var isRedeeming: Bool = false
    var errorMessage: String?
    var pendingDelta: Int = 0

    private let api: CrowdedAPI
    private let poller: Poller

    init(api: CrowdedAPI, pollInterval: TimeInterval = 15) {
        self.api = api
        self.poller = Poller(interval: pollInterval)
    }

    var displayedHeadcount: Int {
        return max(0, (state?.headcount ?? 0) + pendingDelta)
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

    func load(barId: String) async {
        do {
            state = try await api.staffState(barId: barId)
            errorMessage = nil
        } catch {
            errorMessage = APIError.wrap(error).errorDescription
        }
    }

    func startPolling(barId: String) {
        poller.start { [weak self] in
            await self?.load(barId: barId)
        }
    }

    func stopPolling() {
        poller.stop()
    }

    func count(barId: String, direction: DoorDirection, by amount: Int = 1) async {
        let delta = direction == .entry ? amount : -amount
        if direction == .exit && displayedHeadcount - amount < 0 {
            errorMessage = APIError.http(status: 409, detail: "headcount_below_zero").errorDescription
            return
        }
        pendingDelta += delta
        do {
            let fresh = try await api.door(barId: barId, direction: direction, count: amount)
            pendingDelta -= delta
            state = fresh
            errorMessage = nil
        } catch {
            pendingDelta -= delta
            errorMessage = APIError.wrap(error).errorDescription
        }
    }

    func setLine(barId: String, size: LineSize) async {
        do {
            state = try await api.setLine(barId: barId, size: size)
            errorMessage = nil
        } catch {
            errorMessage = APIError.wrap(error).errorDescription
        }
    }
}

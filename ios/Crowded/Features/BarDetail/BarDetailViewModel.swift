import Foundation
import Observation

@Observable
@MainActor
final class BarDetailViewModel {
    let barId: String
    var detail: BarDetail?
    var errorMessage: String?
    var isStarting: Bool = false

    private let api: CrowdedAPI
    private let poller: Poller

    init(api: CrowdedAPI, barId: String, pollInterval: TimeInterval = 15) {
        self.api = api
        self.barId = barId
        self.poller = Poller(interval: pollInterval)
    }

    func load() async {
        do {
            detail = try await api.bar(id: barId)
            errorMessage = nil
        } catch {
            errorMessage = APIError.wrap(error).errorDescription
        }
    }

    func startPolling() {
        poller.start { [weak self] in
            await self?.load()
        }
    }

    func stopPolling() {
        poller.stop()
    }

    /// "I'm in line": reads location once, then starts the timer.
    func startLine(location: LocationProviding) async -> LineSession? {
        isStarting = true
        defer { isStarting = false }
        let coordinate = await location.currentLocation(timeout: 6)
        do {
            return try await api.startSession(barId: barId, location: coordinate)
        } catch {
            errorMessage = APIError.wrap(error).errorDescription
            return nil
        }
    }
}

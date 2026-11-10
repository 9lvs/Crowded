import Foundation
import Observation

@Observable
@MainActor
final class TonightViewModel {
    var bars: [Bar] = []
    var isLoading: Bool = false
    var hasLoaded: Bool = false
    var errorMessage: String?

    private let api: CrowdedAPI
    private let poller: Poller

    init(api: CrowdedAPI, pollInterval: TimeInterval = 15) {
        self.api = api
        self.poller = Poller(interval: pollInterval)
    }

    var isPolling: Bool { poller.isRunning }

    func load() async {
        isLoading = !hasLoaded
        defer { isLoading = false }
        do {
            bars = try await api.bars()
            hasLoaded = true
            errorMessage = nil
        } catch {
            errorMessage = APIError.wrap(error).errorDescription
        }
    }

    /// Foreground only. RootView stops it when the app goes to the background.
    func startPolling() {
        poller.start { [weak self] in
            await self?.load()
        }
    }

    func stopPolling() {
        poller.stop()
    }
}

import Foundation

/// Runs `work` now and then every `interval` seconds until stopped. Screens start it when the app
/// is in the foreground and stop it on background (scenePhase), so we never poll in background.
@MainActor
final class Poller {
    private var task: Task<Void, Never>?
    let interval: TimeInterval

    init(interval: TimeInterval = 15) {
        self.interval = interval
    }

    var isRunning: Bool { task != nil }

    func start(_ work: @escaping @MainActor () async -> Void) {
        stop()
        let interval = self.interval
        task = Task { @MainActor in
            while !Task.isCancelled {
                await work()
                try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
            }
        }
    }

    func stop() {
        task?.cancel()
        task = nil
    }
}

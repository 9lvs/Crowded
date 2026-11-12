import Foundation
import Observation

@Observable
@MainActor
final class LineTimerViewModel {
    enum ResultKind: Equatable {
        case inside
        case tooQuick
        case leftLine
    }

    let session: LineSession
    var now: Date = Date()
    var finished: LineSession?
    var lastOutcome: EndOutcome?
    var isSaving: Bool = false
    var errorMessage: String?

    private let api: CrowdedAPI
    @ObservationIgnored private var ticker: Task<Void, Never>?

    init(api: CrowdedAPI, session: LineSession) {
        self.api = api
        self.session = session
    }

    var elapsed: TimeInterval {
        return max(0, now.timeIntervalSince(session.startedAt))
    }

    func startTicking() {
        ticker?.cancel()
        ticker = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                self?.now = Date()
                try? await Task.sleep(nanoseconds: 1_000_000_000)
            }
        }
    }

    func stopTicking() {
        ticker?.cancel()
        ticker = nil
    }

    /// Ends the timer. The door code is off, so none is sent.
    func end(_ outcome: EndOutcome) async {
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }
        do {
            finished = try await api.endSession(id: session.id, outcome: outcome, doorCode: nil)
            lastOutcome = outcome
            stopTicking()
        } catch {
            errorMessage = APIError.wrap(error).errorDescription
        }
    }

    var resultKind: ResultKind? {
        guard let finished else { return nil }
        if finished.status == .completed {
            return .inside
        }
        // Tapped "I'm inside" but too fast to be a real wait. The server marks it abandoned.
        if lastOutcome == .inside {
            return .tooQuick
        }
        return .leftLine
    }

    var resultTitle: String {
        switch resultKind {
        case .some(.inside): return "You're in"
        case .some(.tooQuick): return "Too quick to count"
        case .some(.leftLine): return "Line left"
        case .none: return ""
        }
    }

    var resultNote: String {
        switch resultKind {
        case .some(.inside): return "Your time makes everyone's wait estimate sharper."
        case .some(.tooQuick): return "Waits under 30 seconds are not used for the estimate."
        case .some(.leftLine): return "Thanks. Short visits help us spot slow lines too."
        case .none: return ""
        }
    }

    var resultMinutes: Int {
        guard let finished else { return 0 }
        if let actual = finished.actualWaitMin {
            return max(0, Int(actual.rounded()))
        }
        let end = finished.endedAt ?? now
        return max(0, Int((end.timeIntervalSince(finished.startedAt) / 60).rounded()))
    }
}

import Foundation
import Observation

/// App wide state: who is signed in, the running line timer, theme. Screens get it from the
/// environment. Feature view models get the API from here.
@Observable
@MainActor
final class AppModel {
    enum Phase: Equatable {
        case loading
        case signedOut
        case signedIn
    }

    var phase: Phase = .loading
    var me: Me?
    var activeSession: LineSession?
    /// The session shown in the timer screen. Kept after the session ends so the result shows.
    var timerSession: LineSession?
    var activeBarName: String?
    var theme: ThemePreference
    var showTimer: Bool = false
    var toast: String?

    let api: CrowdedAPI
    let location: LocationProviding
    let isMock: Bool

    init(api: CrowdedAPI, location: LocationProviding, isMock: Bool, theme: ThemePreference = .system) {
        self.api = api
        self.location = location
        self.isMock = isMock
        self.theme = theme
    }

    /// Real backend unless launched with -mockAPI (UI tests, demos without a server).
    static func makeDefault() -> AppModel {
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("-mockAPI") {
            return AppModel(api: MockAPI(), location: FixedLocation(), isMock: true)
        }
        let raw = Bundle.main.object(forInfoDictionaryKey: "CrowdedAPIBaseURL") as? String
        let url = URL(string: raw ?? "") ?? URL(string: "http://localhost:8000")!
        let api = LiveAPI(baseURL: url, secureStore: KeychainStore())
        return AppModel(api: api, location: OneShotLocation(), isMock: false, theme: ThemePreference.load())
    }

    static var signInWithAppleEnabled: Bool {
        let raw = Bundle.main.object(forInfoDictionaryKey: "CrowdedSignInWithApple") as? String
        return raw == "YES"
    }

    func bootstrap() async {
        guard await api.hasStoredSession() else {
            phase = .signedOut
            return
        }
        do {
            me = try await api.me()
            phase = .signedIn
            await refreshSession()
        } catch {
            phase = .signedOut
        }
    }

    func didSignIn(_ me: Me) {
        self.me = me
        phase = .signedIn
        Task { await self.refreshSession() }
    }

    func refreshMe() async {
        if let fresh = try? await api.me() {
            me = fresh
        }
    }

    func refreshSession() async {
        do {
            activeSession = try await api.activeSession()
        } catch {
            // Keep what we have. The next poll tries again.
        }
    }

    func sessionStarted(_ session: LineSession, barName: String) {
        activeSession = session
        activeBarName = barName
        timerSession = session
        showTimer = true
    }

    func openTimer() {
        guard let session = activeSession else { return }
        timerSession = session
        showTimer = true
    }

    func sessionEnded() {
        activeSession = nil
    }

    func setTheme(_ preference: ThemePreference) {
        theme = preference
        preference.save()
    }

    func signOut() async {
        await api.signOut()
        resetToSignedOut()
    }

    func resetToSignedOut() {
        me = nil
        activeSession = nil
        timerSession = nil
        showTimer = false
        phase = .signedOut
    }

    func showToast(_ message: String) {
        toast = message
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            if self.toast == message {
                self.toast = nil
            }
        }
    }
}

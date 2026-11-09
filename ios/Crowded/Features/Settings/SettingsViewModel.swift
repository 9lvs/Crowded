import Foundation
import Observation

@Observable
@MainActor
final class SettingsViewModel {
    var threshold: Double
    var isSaving: Bool = false
    var isDeleting: Bool = false
    var errorMessage: String?
    var savedThreshold: Int

    private let api: CrowdedAPI

    init(api: CrowdedAPI, currentThreshold: Int) {
        self.api = api
        self.threshold = Double(currentThreshold)
        self.savedThreshold = currentThreshold
    }

    var thresholdMinutes: Int {
        return Int(threshold.rounded())
    }

    var thresholdText: String {
        return "Suggest the pass when the wait is over \(thresholdMinutes) min"
    }

    /// Called when the slider is released.
    func saveThreshold() async -> Me? {
        let minutes = min(120, max(5, thresholdMinutes))
        guard minutes != savedThreshold else { return nil }
        isSaving = true
        defer { isSaving = false }
        do {
            let me = try await api.updateThreshold(minutes: minutes)
            savedThreshold = me.waitThresholdMin
            errorMessage = nil
            return me
        } catch {
            errorMessage = APIError.wrap(error).errorDescription
            return nil
        }
    }

    /// Hard delete on the server, then the local session is wiped (Keychain included).
    func deleteAccount() async -> Bool {
        isDeleting = true
        defer { isDeleting = false }
        do {
            try await api.deleteAccount()
            return true
        } catch {
            errorMessage = APIError.wrap(error).errorDescription
            return false
        }
    }
}

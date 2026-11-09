import Foundation
import Observation

@Observable
@MainActor
final class ReportViewModel {
    let barId: String
    let barName: String
    var crowd: CrowdLevel?
    var line: LineSize?
    var isSending: Bool = false
    var result: ReportResult?
    var errorMessage: String?

    private let api: CrowdedAPI

    init(api: CrowdedAPI, barId: String, barName: String) {
        self.api = api
        self.barId = barId
        self.barName = barName
    }

    var canSend: Bool {
        return (crowd != nil || line != nil) && !isSending
    }

    var thanksText: String {
        guard let result else { return "" }
        if result.pointsAwarded > 0 {
            return "Thanks. +\(result.pointsAwarded) points."
        }
        return "Thanks. Reports from near the door count the most."
    }

    func send(location: LocationProviding) async {
        guard canSend else { return }
        isSending = true
        errorMessage = nil
        defer { isSending = false }
        let coordinate = await location.currentLocation(timeout: 6)
        do {
            result = try await api.report(barId: barId, crowd: crowd, line: line, location: coordinate)
        } catch {
            errorMessage = APIError.wrap(error).errorDescription
        }
    }
}

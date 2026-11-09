import Foundation

/// Everything the app asks of the backend. Two implementations: LiveAPI (generated OpenAPI
/// client) and MockAPI (in memory FAKE data for previews, tests and demos).
protocol CrowdedAPI: AnyObject, Sendable {
    // Session
    func hasStoredSession() async -> Bool
    func requestCode(phone: String) async throws -> CodeRequest
    func verifyCode(phone: String, code: String, ageAttested: Bool) async throws -> Me
    func signOut() async

    // Me
    func me() async throws -> Me
    func updateThreshold(minutes: Int) async throws -> Me
    func deleteAccount() async throws

    // Bars
    func bars() async throws -> [Bar]
    func bar(id: String) async throws -> BarDetail

    // Sourcing: line timers and crowd reports
    func activeSession() async throws -> LineSession?
    func startSession(barId: String, location: Coordinate?) async throws -> LineSession
    func endSession(id: String, outcome: EndOutcome) async throws -> LineSession
    func report(
        barId: String, crowd: CrowdLevel?, line: LineSize?, location: Coordinate?
    ) async throws -> ReportResult

    // Staff
    func redeemInvite(code: String) async throws -> Me
    func staffState(barId: String) async throws -> StaffState
    func door(barId: String, direction: DoorDirection, count: Int) async throws -> StaffState
    func setLine(barId: String, size: LineSize) async throws -> StaffState
}

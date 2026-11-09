import XCTest
@testable import Crowded

@MainActor
final class OnboardingViewModelTests: XCTestCase {
    func testBlocksWithoutAgeAttestation() async {
        var signedIn: Me?
        let vm = OnboardingViewModel(api: MockAPI()) { signedIn = $0 }
        vm.phone = "5550101234"
        XCTAssertFalse(vm.canRequestCode)
        await vm.requestCode()
        XCTAssertEqual(vm.step, .phone)
        XCTAssertEqual(vm.errorMessage, "Confirm you're 21 or older to continue.")
        XCTAssertNil(signedIn)
    }

    func testPhoneNormalization() {
        let vm = OnboardingViewModel(api: MockAPI()) { _ in }
        vm.phone = "(555) 010-1234"
        XCTAssertEqual(vm.normalizedPhone, "+15550101234")
        vm.phone = "1 555 010 1234"
        XCTAssertEqual(vm.normalizedPhone, "+15550101234")
        vm.phone = "+44 20 7946 0958"
        XCTAssertEqual(vm.normalizedPhone, "+442079460958")
        vm.phone = "12345"
        XCTAssertNil(vm.normalizedPhone)
    }

    func testFullSignInWithDevCode() async {
        var signedIn: Me?
        let vm = OnboardingViewModel(api: MockAPI()) { signedIn = $0 }
        vm.ageAttested = true
        vm.phone = "5550101234"
        await vm.requestCode()
        XCTAssertEqual(vm.step, .code)
        XCTAssertEqual(vm.devCode, "123456")
        vm.useDevCode()
        XCTAssertTrue(vm.canVerify)
        await vm.verify()
        XCTAssertNotNil(signedIn)
        XCTAssertNil(vm.errorMessage)
    }
}

@MainActor
final class TonightViewModelTests: XCTestCase {
    func testLoadsBarsWithBasis() async {
        let vm = TonightViewModel(api: MockAPI(signedIn: true))
        await vm.load()
        XCTAssertEqual(vm.bars.count, 3)
        XCTAssertTrue(vm.bars.allSatisfy { $0.name.hasPrefix("FAKE ") })
        XCTAssertTrue(vm.bars[0].live.basis.text.hasPrefix("Based on"))
        let noData = vm.bars.first { !$0.live.hasRecentData }
        XCTAssertNotNil(noData)
        XCTAssertNil(noData?.live.waitMin, "no recent data must never show a stale number")
    }

    func testPollingStartsAndStops() async throws {
        let vm = TonightViewModel(api: MockAPI(signedIn: true), pollInterval: 0.05)
        vm.startPolling()
        XCTAssertTrue(vm.isPolling)
        try await Task.sleep(nanoseconds: 200_000_000)
        XCTAssertEqual(vm.bars.count, 3)
        vm.stopPolling()
        XCTAssertFalse(vm.isPolling)
    }

    func testSignedOutShowsError() async {
        let vm = TonightViewModel(api: MockAPI(signedIn: false))
        await vm.load()
        XCTAssertTrue(vm.bars.isEmpty)
        XCTAssertNotNil(vm.errorMessage)
    }
}

@MainActor
final class ReportViewModelTests: XCTestCase {
    private let owl = "00000000-0000-4000-8000-000000000001"

    func testNeedsAChoiceBeforeSending() {
        let vm = ReportViewModel(api: MockAPI(signedIn: true), barId: owl, barName: "FAKE The Tipsy Owl")
        XCTAssertFalse(vm.canSend)
        vm.line = .long
        XCTAssertTrue(vm.canSend)
    }

    func testSendNearBarAwardsPoints() async {
        let vm = ReportViewModel(api: MockAPI(signedIn: true), barId: owl, barName: "FAKE The Tipsy Owl")
        vm.crowd = .packed
        await vm.send(location: FixedLocation(Coordinate(latitude: 0, longitude: 0)))
        XCTAssertEqual(vm.result?.pointsAwarded, 2)
        XCTAssertEqual(vm.thanksText, "Thanks. +2 points.")
    }

    func testSendWithoutLocationStillWorks() async {
        let vm = ReportViewModel(api: MockAPI(signedIn: true), barId: owl, barName: "FAKE The Tipsy Owl")
        vm.crowd = .easy
        await vm.send(location: FixedLocation(nil))
        XCTAssertEqual(vm.result?.pointsAwarded, 0)
        XCTAssertNil(vm.errorMessage)
    }
}

@MainActor
final class LineTimerViewModelTests: XCTestCase {
    private let owl = "00000000-0000-4000-8000-000000000001"

    func testTooQuickInsideIsNotCounted() async throws {
        let api = MockAPI(signedIn: true)
        let session = try await api.startSession(barId: owl, location: Coordinate(latitude: 0, longitude: 0))
        let vm = LineTimerViewModel(api: api, session: session)
        await vm.end(.inside)
        XCTAssertEqual(vm.resultKind, .tooQuick)
        XCTAssertEqual(vm.resultTitle, "Too quick to count")
    }

    func testRealWaitCompletesWithPoints() async throws {
        let api = MockAPI(signedIn: true)
        let session = try await api.startSession(barId: owl, location: Coordinate(latitude: 0, longitude: 0))
        await api.advanceClock(seconds: 12 * 60)
        let vm = LineTimerViewModel(api: api, session: session)
        await vm.end(.inside)
        XCTAssertEqual(vm.resultKind, .inside)
        XCTAssertEqual(vm.resultMinutes, 12)
        XCTAssertEqual(vm.finished?.pointsAwarded, 10)
        let active = try await api.activeSession()
        XCTAssertNil(active)
    }

    func testLeftTheLine() async throws {
        let api = MockAPI(signedIn: true)
        let session = try await api.startSession(barId: owl, location: nil)
        await api.advanceClock(seconds: 5 * 60)
        let vm = LineTimerViewModel(api: api, session: session)
        await vm.end(.gaveUp)
        XCTAssertEqual(vm.resultKind, .leftLine)
        XCTAssertEqual(vm.finished?.pointsAwarded, 0)
    }

    func testOnlyOneActiveSession() async throws {
        let api = MockAPI(signedIn: true)
        _ = try await api.startSession(barId: owl, location: nil)
        do {
            _ = try await api.startSession(barId: owl, location: nil)
            XCTFail("expected a conflict")
        } catch let error as APIError {
            XCTAssertEqual(error.detail, "session_already_active")
        }
    }
}

@MainActor
final class SettingsViewModelTests: XCTestCase {
    func testThresholdSavesOnRelease() async {
        let api = MockAPI(signedIn: true)
        let vm = SettingsViewModel(api: api, currentThreshold: 20)
        vm.threshold = 35
        XCTAssertEqual(vm.thresholdText, "Suggest the pass when the wait is over 35 min")
        let me = await vm.saveThreshold()
        XCTAssertEqual(me?.waitThresholdMin, 35)
        let fresh = try? await api.me()
        XCTAssertEqual(fresh?.waitThresholdMin, 35)
    }

    func testUnchangedThresholdDoesNotCallServer() async {
        let vm = SettingsViewModel(api: MockAPI(signedIn: true), currentThreshold: 20)
        let me = await vm.saveThreshold()
        XCTAssertNil(me)
    }

    func testDeleteAccountSignsOut() async {
        let api = MockAPI(signedIn: true)
        let vm = SettingsViewModel(api: api, currentThreshold: 20)
        let ok = await vm.deleteAccount()
        XCTAssertTrue(ok)
        let stillSignedIn = await api.hasStoredSession()
        XCTAssertFalse(stillSignedIn)
    }
}

@MainActor
final class StaffViewModelTests: XCTestCase {
    private let owl = "00000000-0000-4000-8000-000000000001"

    func testRedeemThenCount() async {
        let api = MockAPI(signedIn: true)
        let vm = StaffViewModel(api: api)
        vm.inviteCode = "ABCDE-FGHJK"
        let me = await vm.redeem()
        XCTAssertEqual(me?.role, .staff)
        XCTAssertEqual(me?.staffBarId, owl)
        await vm.load(barId: owl)
        let before = vm.displayedHeadcount
        await vm.count(barId: owl, direction: .entry)
        await vm.count(barId: owl, direction: .entry, by: 5)
        XCTAssertEqual(vm.displayedHeadcount, before + 6)
        await vm.count(barId: owl, direction: .exit)
        XCTAssertEqual(vm.displayedHeadcount, before + 5)
        await vm.setLine(barId: owl, size: .long)
        XCTAssertEqual(vm.state?.lineSize, .long)
    }

    func testStudentCannotUseCounter() async {
        let vm = StaffViewModel(api: MockAPI(signedIn: true))
        await vm.load(barId: owl)
        XCTAssertNil(vm.state)
        XCTAssertNotNil(vm.errorMessage)
    }
}

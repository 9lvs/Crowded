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

@MainActor
final class DoorModeTests: XCTestCase {
    private let owl = "00000000-0000-4000-8000-000000000001"

    private func makeVM(_ api: MockAPI) async -> StaffViewModel {
        let vm = StaffViewModel(api: api, pollInterval: 60, retryDelays: [0.01])
        await vm.load(barId: owl)
        return vm
    }

    func testTapThenUndoRestoresCount() async {
        let api = MockAPI(signedIn: true, role: .staff)
        let vm = await makeVM(api)
        let before = vm.displayedHeadcount
        await vm.count(barId: owl, direction: .entry, by: 3)
        XCTAssertEqual(vm.displayedHeadcount, before + 3)
        XCTAssertTrue(vm.canUndo(at: vm.clock()))
        await vm.undo(barId: owl)
        XCTAssertEqual(vm.displayedHeadcount, before)
        XCTAssertFalse(vm.canUndo(at: vm.clock()))
    }

    func testUndoExpiresAfterThirtySeconds() async {
        let api = MockAPI(signedIn: true, role: .staff)
        let vm = await makeVM(api)
        let start = Date()
        var current = start
        vm.clock = { current }
        await vm.count(barId: owl, direction: .entry)
        current = start.addingTimeInterval(31)
        XCTAssertFalse(vm.canUndo(at: vm.clock()))
        let before = vm.displayedHeadcount
        await vm.undo(barId: owl)
        XCTAssertEqual(vm.displayedHeadcount, before)
    }

    func testOfflineTapsQueueThenRetry() async {
        let api = MockAPI(signedIn: true, role: .staff)
        let vm = await makeVM(api)
        let before = vm.displayedHeadcount
        await api.setOffline(true)
        await vm.count(barId: owl, direction: .entry)
        await vm.count(barId: owl, direction: .entry, by: 2)
        XCTAssertEqual(vm.queue.count, 2)
        XCTAssertTrue(vm.isSavingOffline)
        XCTAssertEqual(vm.displayedHeadcount, before + 3)
        await api.setOffline(false)
        await vm.flushQueue(barId: owl)
        XCTAssertTrue(vm.queue.isEmpty)
        XCTAssertFalse(vm.isSavingOffline)
        XCTAssertEqual(vm.state?.headcount, before + 3)
        XCTAssertEqual(vm.displayedHeadcount, before + 3)
        vm.stopPolling()
    }

    func testCountSyncSetsInsideNow() async {
        let api = MockAPI(signedIn: true, role: .staff)
        let vm = await makeVM(api)
        let ok = await vm.syncCount(barId: owl, insideNow: 123)
        XCTAssertTrue(ok)
        XCTAssertEqual(vm.displayedHeadcount, 123)
        let bad = await vm.syncCount(barId: owl, insideNow: 9000)
        XCTAssertFalse(bad)
        XCTAssertEqual(vm.displayedHeadcount, 123)
    }

    func testLineSampleStartEndAndLimit() async {
        let api = MockAPI(signedIn: true, role: .staff)
        let vm = await makeVM(api)
        await vm.startSample(barId: owl)
        await vm.startSample(barId: owl)
        XCTAssertEqual(vm.samples.count, 2)
        XCTAssertFalse(vm.canStartSample)
        await vm.startSample(barId: owl)
        XCTAssertEqual(vm.samples.count, 2)
        XCTAssertNotNil(vm.sampleError)
        let first = vm.samples[0]
        let second = vm.samples[1]
        await api.advanceClock(seconds: 14 * 60)
        await vm.endSample(barId: owl, sampleId: first.id, outcome: .inside)
        XCTAssertEqual(vm.samples.count, 1)
        XCTAssertTrue(vm.lastCheckText(at: Date().addingTimeInterval(14 * 60 + 360))?.hasPrefix("Last line check: 14 min, 6 min ago") == true)
        await vm.endSample(barId: owl, sampleId: second.id, outcome: .cancel)
        XCTAssertTrue(vm.samples.isEmpty)
    }

    func testRemindersFireAtFifteenAndTwentyMinutes() async {
        let api = MockAPI(signedIn: true, role: .staff)
        let vm = await makeVM(api)
        let start = Date()
        var current = start
        vm.clock = { current }
        vm.doorOpened()
        XCTAssertFalse(vm.evaluateReminders())
        current = start.addingTimeInterval(16 * 60)
        XCTAssertTrue(vm.evaluateReminders())
        XCTAssertEqual(vm.reminder, .updateLine)
        XCTAssertFalse(vm.evaluateReminders())
        current = start.addingTimeInterval(21 * 60)
        XCTAssertTrue(vm.evaluateReminders())
        XCTAssertEqual(vm.reminder, .timeLine)
    }

    func testDoorCodeChangesEveryTwoMinutes() async throws {
        let api = MockAPI(signedIn: true, role: .staff)
        let first = try await api.doorCode(barId: owl)
        XCTAssertEqual(first.code.count, 4)
        XCTAssertTrue(first.expiresIn > 0 && first.expiresIn <= 120)
        await api.advanceClock(seconds: 120)
        let second = try await api.doorCode(barId: owl)
        XCTAssertNotEqual(first.code, second.code)
    }
}

@MainActor
final class DoorCodeStudentTests: XCTestCase {
    private let owl = "00000000-0000-4000-8000-000000000001"

    func testRightCodeVerifiesAndPaysMore() async throws {
        let api = MockAPI(signedIn: true, role: .staff)
        let session = try await api.startSession(barId: owl, location: Coordinate(latitude: 0, longitude: 0))
        await api.advanceClock(seconds: 12 * 60)
        let code = try await api.doorCode(barId: owl).code
        let vm = LineTimerViewModel(api: api, session: session)
        vm.doorCodeInput = code
        await vm.end(.inside, doorCode: vm.validDoorCode)
        XCTAssertTrue(vm.isVerified)
        XCTAssertEqual(vm.finished?.pointsAwarded, 20)
        XCTAssertFalse(vm.codeDidNotMatch)
    }

    func testWrongCodeStillEndsUnverified() async throws {
        let api = MockAPI(signedIn: true, role: .staff)
        let session = try await api.startSession(barId: owl, location: Coordinate(latitude: 0, longitude: 0))
        await api.advanceClock(seconds: 12 * 60)
        let real = try await api.doorCode(barId: owl).code
        let wrong = real == "0000" ? "1111" : "0000"
        let vm = LineTimerViewModel(api: api, session: session)
        await vm.end(.inside, doorCode: wrong)
        XCTAssertEqual(vm.resultKind, .inside)
        XCTAssertFalse(vm.isVerified)
        XCTAssertTrue(vm.codeDidNotMatch)
        XCTAssertEqual(vm.finished?.pointsAwarded, 10)
    }

    func testSkippingTheCodeEndsNormally() async throws {
        let api = MockAPI(signedIn: true)
        let session = try await api.startSession(barId: owl, location: Coordinate(latitude: 0, longitude: 0))
        await api.advanceClock(seconds: 12 * 60)
        let vm = LineTimerViewModel(api: api, session: session)
        vm.doorCodeInput = "12"
        XCTAssertNil(vm.validDoorCode)
        await vm.end(.inside, doorCode: vm.validDoorCode)
        XCTAssertEqual(vm.resultKind, .inside)
        XCTAssertFalse(vm.isVerified)
        XCTAssertFalse(vm.codeDidNotMatch)
    }
}

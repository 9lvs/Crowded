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

    func testDoorCodeRouteIsOffByDefault() async {
        let api = MockAPI(signedIn: true, role: .staff)
        do {
            _ = try await api.doorCode(barId: owl)
            XCTFail("expected the door code to be off")
        } catch let error as APIError {
            XCTAssertEqual(error.status, 404)
            XCTAssertEqual(error.detail, "door_code_disabled")
        } catch {
            XCTFail("unexpected error")
        }
    }

    func testInsideReminderTextAndPriority() async {
        XCTAssertEqual(DoorReminder.updateInside.text, "Update inside")
        let api = MockAPI(signedIn: true, role: .staff)
        let vm = await makeVM(api)
        let start = Date()
        var current = start
        vm.clock = { current }
        vm.doorOpened()
        current = start.addingTimeInterval(16 * 60)
        XCTAssertTrue(vm.evaluateReminders())
        // Line and inside are both due. The banner shows the line one first.
        XCTAssertEqual(vm.reminder, .updateLine)
        XCTAssertFalse(vm.evaluateReminders())
    }
}

@MainActor
final class DoorCodeOffTests: XCTestCase {
    private let owl = "00000000-0000-4000-8000-000000000001"

    func testInsideEndsDirectlyAndIsNotVerified() async throws {
        let api = MockAPI(signedIn: true)
        let session = try await api.startSession(barId: owl, location: Coordinate(latitude: 0, longitude: 0))
        await api.advanceClock(seconds: 12 * 60)
        let vm = LineTimerViewModel(api: api, session: session)
        await vm.end(.inside)
        XCTAssertEqual(vm.resultKind, .inside)
        XCTAssertEqual(vm.finished?.verified, false)
        XCTAssertEqual(vm.finished?.pointsAwarded, 10)
    }
}

@MainActor
final class StaffLevelTests: XCTestCase {
    private let owl = "00000000-0000-4000-8000-000000000001"

    func testDoorStaffHaveNoSpecialsAccess() async {
        let api = MockAPI(signedIn: true, role: .staff, staffLevel: .door)
        let me = try? await api.me()
        XCTAssertEqual(me?.staffLevel, .door)
        XCTAssertEqual(me?.isManager, false)
        let vm = StaffViewModel(api: api)
        vm.staffLevel = me?.staffLevel
        XCTAssertFalse(vm.canManage)
        let specials = StaffSpecialsViewModel(api: api, barId: owl)
        await specials.load()
        XCTAssertTrue(specials.specials.isEmpty)
        XCTAssertEqual(specials.errorMessage, "Only managers can change this.")
    }

    func testManagerHasSpecialsAccess() async {
        let api = MockAPI(signedIn: true, role: .staff, staffLevel: .manager)
        let me = try? await api.me()
        XCTAssertEqual(me?.isManager, true)
        let vm = StaffViewModel(api: api)
        vm.staffLevel = me?.staffLevel
        XCTAssertTrue(vm.canManage)
        let specials = StaffSpecialsViewModel(api: api, barId: owl)
        await specials.load()
        XCTAssertEqual(specials.specials.count, 5)
        XCTAssertNil(specials.errorMessage)
    }

    func testMockStaffLevelCanSwitch() async {
        let api = MockAPI(signedIn: true, role: .staff, staffLevel: .manager)
        await api.setStaffLevel(.door)
        let me = try? await api.me()
        XCTAssertEqual(me?.staffLevel, .door)
    }

    func testInsideTapsPostAndShowUpdatedText() async {
        let api = MockAPI(signedIn: true, role: .staff, staffLevel: .door)
        let vm = StaffViewModel(api: api, pollInterval: 60, retryDelays: [0.01])
        await vm.load(barId: owl)
        XCTAssertNil(vm.state?.inside)
        XCTAssertNil(vm.insideUpdatedText(at: Date()))
        await vm.postInside(barId: owl, crowd: .busy)
        await vm.postInside(barId: owl, drinkWait: .over20)
        XCTAssertEqual(vm.state?.inside?.crowdLevel, .busy)
        XCTAssertEqual(vm.state?.inside?.drinkWait, .over20)
        XCTAssertEqual(vm.state?.live.drinkWaitLabel, "Over 20 min")
        XCTAssertEqual(vm.insideUpdatedText(at: Date()), "Updated just now")
        XCTAssertEqual(vm.insideUpdatedText(at: Date().addingTimeInterval(4 * 60 + 5)), "Updated 4 min ago")
        XCTAssertNil(vm.errorMessage)
    }

    func testPostingInsideClearsTheInsideReminder() async {
        let api = MockAPI(signedIn: true, role: .staff, staffLevel: .door)
        let vm = StaffViewModel(api: api, pollInterval: 60, retryDelays: [0.01])
        await vm.load(barId: owl)
        vm.reminder = .updateInside
        await vm.postInside(barId: owl, crowd: .easy)
        XCTAssertNil(vm.reminder)
    }

    func testDoorStaffCannotChangeCountsExits() async {
        let api = MockAPI(signedIn: true, role: .staff, staffLevel: .door)
        let vm = StaffViewModel(api: api, pollInterval: 60, retryDelays: [0.01])
        vm.staffLevel = .door
        await vm.load(barId: owl)
        await vm.setCountsExits(barId: owl, value: false)
        XCTAssertTrue(vm.countsExits)
        XCTAssertEqual(vm.errorMessage, "Only managers can change this.")
    }

    func testServerRefusesCountsExitsForDoorStaff() async {
        let api = MockAPI(signedIn: true, role: .staff, staffLevel: .door)
        do {
            _ = try await api.setCountsExits(barId: owl, value: false)
            XCTFail("expected manager_only")
        } catch let error as APIError {
            XCTAssertEqual(error.status, 403)
            XCTAssertEqual(error.detail, "manager_only")
        } catch {
            XCTFail("unexpected error")
        }
    }

    func testCountInOnlyBarIgnoresOutAndShowsEntries() async {
        let api = MockAPI(signedIn: true, role: .staff, staffLevel: .manager)
        let vm = StaffViewModel(api: api, pollInterval: 60, retryDelays: [0.01])
        vm.staffLevel = .manager
        await vm.load(barId: owl)
        XCTAssertTrue(vm.countsExits)
        await vm.setCountsExits(barId: owl, value: false)
        XCTAssertFalse(vm.countsExits)
        XCTAssertEqual(vm.state?.countsExits, false)
        let entries = vm.displayedEntries
        let headcount = vm.displayedHeadcount
        await vm.count(barId: owl, direction: .exit)
        XCTAssertEqual(vm.displayedHeadcount, headcount)
        XCTAssertEqual(vm.displayedEntries, entries)
        await vm.count(barId: owl, direction: .entry, by: 2)
        XCTAssertEqual(vm.displayedEntries, entries + 2)
        // Undo of an entry still works.
        await vm.undo(barId: owl)
        XCTAssertEqual(vm.displayedEntries, entries)
        XCTAssertNil(vm.errorMessage)
    }

    func testManagerOnlyErrorText() {
        let error = APIError.http(status: 403, detail: "manager_only")
        XCTAssertEqual(error.errorDescription, "Only managers can change this.")
    }
}

@MainActor
final class DrinkWaitTests: XCTestCase {
    private let owl = "00000000-0000-4000-8000-000000000001"
    private let heron = "00000000-0000-4000-8000-000000000003"

    func testBarDetailShowsDrinkWaitLabelOrNoData() async {
        let api = MockAPI(signedIn: true)
        let owlVM = BarDetailViewModel(api: api, barId: owl)
        await owlVM.load()
        XCTAssertEqual(owlVM.detail?.bar.live.drinkWaitLabel, "10 to 20 min")
        XCTAssertEqual(owlVM.detail?.bar.live.drinkText, "10 to 20 min")
        let heronVM = BarDetailViewModel(api: api, barId: heron)
        await heronVM.load()
        XCTAssertNil(heronVM.detail?.bar.live.drinkWaitLabel)
        XCTAssertEqual(heronVM.detail?.bar.live.drinkText, "No recent data")
    }

    func testReportCanBeJustADrinkWait() async {
        let api = MockAPI(signedIn: true)
        let vm = ReportViewModel(api: api, barId: owl, barName: "FAKE The Tipsy Owl")
        XCTAssertFalse(vm.canSend)
        vm.drinkWait = .fiveToTen
        XCTAssertTrue(vm.canSend)
    }

    func testReportIncludesDrinkWait() async throws {
        let api = MockAPI(signedIn: true)
        let vm = ReportViewModel(api: api, barId: owl, barName: "FAKE The Tipsy Owl")
        vm.drinkWait = .over20
        await vm.send(location: FixedLocation(nil))
        XCTAssertNotNil(vm.result)
        XCTAssertNil(vm.errorMessage)
        let detail = try await api.bar(id: owl)
        XCTAssertEqual(detail.bar.live.drinkWait, .over20)
        XCTAssertEqual(detail.bar.live.drinkWaitLabel, "Over 20 min")
    }

    func testDrinkWaitLabelsAndRawValues() {
        XCTAssertEqual(DrinkWait.allCases.count, 4)
        XCTAssertEqual(DrinkWait.under5.rawValue, "under_5")
        XCTAssertEqual(DrinkWait.fiveToTen.rawValue, "5_to_10")
        XCTAssertEqual(DrinkWait.tenToTwenty.rawValue, "10_to_20")
        XCTAssertEqual(DrinkWait.over20.rawValue, "over_20")
        XCTAssertEqual(DrinkWait.tenToTwenty.label, "10 to 20")
        XCTAssertNil(DrinkWait(api: "some_future_value"))
    }
}

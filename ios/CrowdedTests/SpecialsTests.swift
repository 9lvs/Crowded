import XCTest
@testable import Crowded

final class SpecialsFormattingTests: XCTestCase {
    private func special(
        _ kind: SpecialKind, title: String = "FAKE Item", start: String = "17:00",
        end: String = "20:00", price: Int? = nil
    ) -> Special {
        return Special(
            id: UUID().uuidString, kind: kind, title: title, details: "", days: [0, 1, 2, 3, 4],
            startLocal: start, endLocal: end, priceCents: price, isActive: true, postedBy: .bar,
            updatedAt: Date()
        )
    }

    private func tonight(_ item: Special, now: Bool) -> SpecialTonight {
        return SpecialTonight(special: item, isNow: now)
    }

    func testTwelveHourFormat() {
        XCTAssertEqual(SpecialTime.format12("17:00"), "5 PM")
        XCTAssertEqual(SpecialTime.format12("21:30"), "9:30 PM")
        XCTAssertEqual(SpecialTime.format12("00:00"), "12 AM")
        XCTAssertEqual(SpecialTime.format12("12:00"), "12 PM")
        XCTAssertEqual(SpecialTime.format12("02:05"), "2:05 AM")
        XCTAssertEqual(SpecialTime.format12("17:00:00"), "5 PM")
        XCTAssertEqual(SpecialTime.format12("nonsense"), "nonsense")
    }

    func testWindowAndHHMM() {
        XCTAssertEqual(SpecialTime.window(start: "17:00", end: "20:00"), "5 PM to 8 PM")
        XCTAssertEqual(SpecialTime.hhmm(hour: 9, minute: 5), "09:05")
        let date = SpecialTime.date(from: "21:30")
        XCTAssertEqual(SpecialTime.hhmm(from: date), "21:30")
    }

    func testDaysSummary() {
        XCTAssertEqual(SpecialTime.daysSummary([0, 1, 2, 3, 4]), "Mon to Fri")
        XCTAssertEqual(SpecialTime.daysSummary([0, 1, 2, 3, 4, 5, 6]), "Every night")
        XCTAssertEqual(SpecialTime.daysSummary([3, 5]), "Thu, Sat")
        XCTAssertEqual(SpecialTime.daysSummary([2]), "Wed")
    }

    func testPriceParsing() {
        XCTAssertEqual(SpecialPrice.cents(fromDollars: "5"), 500)
        XCTAssertEqual(SpecialPrice.cents(fromDollars: "5.5"), 550)
        XCTAssertEqual(SpecialPrice.cents(fromDollars: "$12.25"), 1225)
        XCTAssertNil(SpecialPrice.cents(fromDollars: ""))
        XCTAssertNil(SpecialPrice.cents(fromDollars: "abc"))
        XCTAssertNil(SpecialPrice.cents(fromDollars: "1.234"))
        XCTAssertTrue(SpecialPrice.isValid(dollars: ""))
        XCTAssertFalse(SpecialPrice.isValid(dollars: "five"))
        XCTAssertEqual(SpecialPrice.dollarsText(cents: 550), "5.50")
        XCTAssertEqual(SpecialPrice.dollarsText(cents: 500), "5")
    }

    func testLinePrefersNowItem() {
        let happy = tonight(special(.happyHour, title: "FAKE Happy hour"), now: true)
        let cover = tonight(special(.cover, start: "21:00", end: "02:00", price: 500), now: false)
        let line = SpecialsText.tonightLine(specials: [happy, cover], cover: cover)
        XCTAssertEqual(line, "Happy hour now until 8 PM")
    }

    func testLineFallsBackToCover() {
        let food = tonight(special(.food, title: "FAKE Wings"), now: false)
        let cover = tonight(special(.cover, start: "21:00", end: "02:00", price: 500), now: false)
        let line = SpecialsText.tonightLine(specials: [food, cover], cover: cover)
        XCTAssertEqual(line, "Cover $5 from 9 PM")
    }

    func testLineForCoverThatIsOn() {
        let cover = tonight(special(.cover, start: "18:00", end: "02:00", price: 1000), now: true)
        XCTAssertEqual(
            SpecialsText.tonightLine(specials: [cover], cover: cover), "Cover $10 now")
    }

    func testLineFallsBackToCount() {
        let a = tonight(special(.food, title: "FAKE Wings"), now: false)
        let b = tonight(special(.event, title: "FAKE Trivia"), now: false)
        XCTAssertEqual(
            SpecialsText.tonightLine(specials: [a, b], cover: nil), "2 specials tonight")
        XCTAssertEqual(SpecialsText.tonightLine(specials: [a], cover: nil), "1 special tonight")
    }

    func testNoSpecialsMeansNoLine() {
        XCTAssertNil(SpecialsText.tonightLine(specials: [], cover: nil))
    }

    func testScheduleNowAndOvernight() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        // Friday 2026-11-13 at 23:00 and Saturday 2026-11-14 at 01:00 (still Friday night).
        let friday11pm = calendar.date(from: DateComponents(year: 2026, month: 11, day: 13, hour: 23))!
        let saturday1am = calendar.date(from: DateComponents(year: 2026, month: 11, day: 14, hour: 1))!
        XCTAssertTrue(
            SpecialSchedule.isNow(
                days: [4], start: "21:00", end: "02:00", now: friday11pm, calendar: calendar))
        XCTAssertTrue(
            SpecialSchedule.isNow(
                days: [4], start: "21:00", end: "02:00", now: saturday1am, calendar: calendar))
        XCTAssertFalse(
            SpecialSchedule.isNow(
                days: [3], start: "21:00", end: "02:00", now: saturday1am, calendar: calendar))
        XCTAssertEqual(SpecialSchedule.nightStartWeekday(saturday1am, calendar: calendar), 4)
    }
}

@MainActor
final class StaffSpecialsViewModelTests: XCTestCase {
    private let owl = "00000000-0000-4000-8000-000000000001"

    private func makeVM() -> (StaffSpecialsViewModel, MockAPI) {
        let api = MockAPI(signedIn: true, role: .staff)
        return (StaffSpecialsViewModel(api: api, barId: owl), api)
    }

    func testLoadsSeededSpecials() async {
        let (vm, _) = makeVM()
        await vm.load()
        XCTAssertEqual(vm.specials.count, 4)
        XCTAssertNil(vm.errorMessage)
    }

    func testAddSpecial() async {
        let (vm, _) = makeVM()
        await vm.load()
        let input = SpecialInput(
            kind: .drink, title: "FAKE Dollar drafts", details: "", days: [1, 2],
            startLocal: "21:00", endLocal: "23:00", priceCents: 100
        )
        let ok = await vm.add(input)
        XCTAssertTrue(ok)
        XCTAssertEqual(vm.specials.count, 5)
        XCTAssertEqual(vm.specials.last?.title, "FAKE Dollar drafts")
        XCTAssertEqual(vm.specials.last?.priceCents, 100)
    }

    func testAddRejectsSameStartAndEnd() async {
        let (vm, _) = makeVM()
        await vm.load()
        let input = SpecialInput(
            kind: .event, title: "FAKE Bad", details: "", days: [1], startLocal: "20:00",
            endLocal: "20:00", priceCents: nil
        )
        let ok = await vm.add(input)
        XCTAssertFalse(ok)
        XCTAssertEqual(vm.errorMessage, "Start and end times must be different.")
        XCTAssertEqual(vm.specials.count, 4)
    }

    func testToggleActive() async throws {
        let (vm, api) = makeVM()
        await vm.load()
        let first = try XCTUnwrap(vm.specials.first)
        XCTAssertTrue(first.isActive)
        await vm.setActive(first, active: false)
        XCTAssertEqual(vm.specials.first(where: { $0.id == first.id })?.isActive, false)
        let stored = try await api.listSpecials(barID: owl)
        XCTAssertEqual(stored.first(where: { $0.id == first.id })?.isActive, false)
        await vm.setActive(first, active: true)
        XCTAssertEqual(vm.specials.first(where: { $0.id == first.id })?.isActive, true)
    }

    func testDeleteSpecial() async throws {
        let (vm, api) = makeVM()
        await vm.load()
        let target = try XCTUnwrap(vm.specials.first)
        let ok = await vm.delete(target)
        XCTAssertTrue(ok)
        XCTAssertEqual(vm.specials.count, 3)
        let stored = try await api.listSpecials(barID: owl)
        XCTAssertEqual(stored.count, 3)
    }

    func testStudentCannotManageSpecials() async {
        let vm = StaffSpecialsViewModel(api: MockAPI(signedIn: true), barId: owl)
        await vm.load()
        XCTAssertTrue(vm.specials.isEmpty)
        XCTAssertNotNil(vm.errorMessage)
    }

    func testDraftValidationAndOutput() {
        var draft = SpecialDraft()
        XCTAssertEqual(draft.problem, "Add a title.")
        draft.title = "  FAKE Cover  "
        draft.kind = .cover
        draft.days = [5, 3]
        draft.start = "21:00"
        draft.end = "02:00"
        draft.priceText = "5"
        XCTAssertNil(draft.problem)
        XCTAssertEqual(draft.input.title, "FAKE Cover")
        XCTAssertEqual(draft.input.days, [3, 5])
        XCTAssertEqual(draft.input.priceCents, 500)
        draft.priceText = "five"
        XCTAssertNotNil(draft.problem)
        draft.priceText = ""
        draft.days = []
        XCTAssertEqual(draft.problem, "Pick at least one day.")
    }
}

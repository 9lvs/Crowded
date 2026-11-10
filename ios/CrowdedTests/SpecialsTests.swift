import XCTest
@testable import Crowded

final class SpecialsFormattingTests: XCTestCase {
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }

    /// Friday 2026-11-13 at the given UTC hour. 20 is before 9 PM, 22 is inside it.
    private func friday(hour: Int) -> Date {
        return calendar.date(from: DateComponents(year: 2026, month: 11, day: 13, hour: hour))!
    }

    private func special(
        _ kind: SpecialKind, title: String = "FAKE Item", start: String = "17:00",
        end: String = "20:00", price: Int? = nil, allDay: Bool = false,
        items: [DealItem] = [], details: String = ""
    ) -> Special {
        return Special(
            id: UUID().uuidString, kind: kind, title: title, details: details,
            days: [0, 1, 2, 3, 4, 5, 6],
            startLocal: allDay ? "12:00" : start, endLocal: allDay ? "04:00" : end,
            priceCents: price, isActive: true, postedBy: .bar, updatedAt: Date(),
            allDay: allDay, items: items
        )
    }

    private func tonight(_ item: Special, now: Bool) -> SpecialTonight {
        return SpecialTonight(special: item, isNow: now || item.allDay)
    }

    private let fourItems = [
        DealItem(name: "Double wells", priceLabel: "$2", category: .mixers),
        DealItem(name: "Drafts", priceLabel: "$2", category: .beer),
        DealItem(name: "Well mixers", priceLabel: "$1", category: .mixers),
        DealItem(name: "Shots", priceLabel: "$3", category: .shots),
    ]

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

    func testDealTextShowsTwoItemsAndCount() {
        XCTAssertEqual(SpecialsText.dealText(fourItems), "$2 double wells, $2 drafts +2")
        XCTAssertEqual(SpecialsText.dealText([fourItems[1]]), "$2 drafts")
        let ipa = DealItem(name: "IPA drafts", priceLabel: "$4", category: .beer)
        XCTAssertEqual(SpecialsText.dealText([ipa]), "$4 IPA drafts")
    }

    func testLineHappyHourNowWithItems() {
        let happy = tonight(
            special(.happyHour, start: "21:00", end: "00:00", items: fourItems), now: true)
        let line = SpecialsText.tonightLine(
            specials: [happy], cover: nil, now: friday(hour: 22), calendar: calendar)
        XCTAssertEqual(line, "Happy hour now: $2 double wells, $2 drafts +2")
    }

    func testLineAllNight() {
        let drafts = special(
            .drink, title: "FAKE Drafts", allDay: true,
            items: [DealItem(name: "Lager drafts", priceLabel: "$3", category: .beer)])
        let line = SpecialsText.tonightLine(
            specials: [tonight(drafts, now: true)], cover: nil, now: friday(hour: 22),
            calendar: calendar)
        XCTAssertEqual(line, "All night: $3 lager drafts")
    }

    func testLineTimedNowBeatsAllNight() {
        let drafts = special(
            .drink, allDay: true,
            items: [DealItem(name: "Lager drafts", priceLabel: "$3", category: .beer)])
        let happy = tonight(
            special(.happyHour, start: "21:00", end: "00:00", items: fourItems), now: true)
        let line = SpecialsText.tonightLine(
            specials: [tonight(drafts, now: true), happy], cover: nil, now: friday(hour: 22),
            calendar: calendar)
        XCTAssertEqual(line, "Happy hour now: $2 double wells, $2 drafts +2")
    }

    func testLineNextUp() {
        let happy = tonight(
            special(.happyHour, start: "21:00", end: "00:00", items: fourItems), now: false)
        let line = SpecialsText.tonightLine(
            specials: [happy], cover: nil, now: friday(hour: 20), calendar: calendar)
        XCTAssertEqual(line, "Happy hour at 9: $2 double wells, $2 drafts +2")
    }

    func testLineNextUpWithoutItems() {
        let dj = tonight(special(.event, title: "DJ", start: "21:00", end: "02:00"), now: false)
        let line = SpecialsText.tonightLine(
            specials: [dj], cover: nil, now: friday(hour: 20), calendar: calendar)
        XCTAssertEqual(line, "DJ at 9")
    }

    func testLineIgnoresEndedSpecial() {
        let happy = tonight(
            special(.happyHour, start: "17:00", end: "20:00", items: fourItems), now: false)
        XCTAssertNil(
            SpecialsText.tonightLine(
                specials: [happy], cover: nil, now: friday(hour: 22), calendar: calendar))
    }

    func testLineFallsBackToCover() {
        let food = tonight(
            special(.food, title: "FAKE Wings", start: "17:00", end: "19:00"), now: false)
        let cover = tonight(special(.cover, start: "21:00", end: "02:00", price: 500), now: false)
        let line = SpecialsText.tonightLine(
            specials: [food, cover], cover: cover, now: friday(hour: 20), calendar: calendar)
        XCTAssertEqual(line, "Cover $5 from 9 PM")
    }

    func testLineForCoverThatIsOn() {
        let cover = tonight(special(.cover, start: "18:00", end: "02:00", price: 1000), now: true)
        XCTAssertEqual(
            SpecialsText.tonightLine(
                specials: [cover], cover: cover, now: friday(hour: 22), calendar: calendar),
            "Cover $10 now")
    }

    func testNoSpecialsMeansNoLine() {
        XCTAssertNil(SpecialsText.tonightLine(specials: [], cover: nil))
    }

    func testMenuOrdersAllNightFirstThenTimedAndHidesEnded() {
        let allNight = tonight(
            special(
                .drink, title: "FAKE Drafts", allDay: true,
                items: [DealItem(name: "Lager drafts", priceLabel: "$3", category: .beer)]),
            now: true)
        let early = tonight(
            special(.food, title: "FAKE Wings", start: "17:00", end: "19:00"), now: false)
        let happy = tonight(
            special(.happyHour, start: "21:00", end: "00:00", items: fourItems), now: true)
        let dj = tonight(special(.event, title: "DJ", start: "23:00", end: "02:00"), now: false)
        let groups = DealMenu.tonight(
            [dj, happy, early, allNight], now: friday(hour: 22), calendar: calendar)
        XCTAssertEqual(groups.map { $0.title }, ["All night", "Happy hour 9 to 12", "DJ from 11"])
        XCTAssertTrue(groups[0].isAllNight)
        XCTAssertTrue(groups[0].isNow)
        XCTAssertNil(groups[0].status)
        XCTAssertTrue(groups[1].isNow)
        XCTAssertEqual(groups[1].status, "Until 12")
        XCTAssertEqual(groups[1].rows.count, 4)
        XCTAssertEqual(groups[1].rows[0].name, "Double wells")
        XCTAssertEqual(groups[1].rows[0].price, "$2")
        XCTAssertFalse(groups[2].isNow)
        XCTAssertEqual(groups[2].status, "Starts at 11")
        XCTAssertTrue(groups[2].rows.isEmpty)
    }

    func testMenuKeepsNoteAndRendersItemlessSpecialAsOneRow() {
        let food = special(
            .food, title: "FAKE Wings", start: "17:00", end: "23:00",
            items: [
                DealItem(name: "Ten wings", priceLabel: "$6", category: .food, note: "Dine in only")
            ],
            details: "Ten for six.")
        let plain = special(
            .drink, title: "FAKE Wells", start: "22:00", end: "23:30", details: "Cheap.")
        let groups = DealMenu.tonight(
            [tonight(food, now: true), tonight(plain, now: false)], now: friday(hour: 21),
            calendar: calendar)
        XCTAssertEqual(groups.count, 2)
        XCTAssertEqual(groups[0].rows.first?.note, "Dine in only")
        XCTAssertEqual(groups[1].rows.count, 1)
        XCTAssertEqual(groups[1].rows.first?.name, "FAKE Wells")
        XCTAssertEqual(groups[1].rows.first?.note, "Cheap.")
    }

    func testCoverGroupSaysPriceInHeader() {
        let cover = special(.cover, start: "21:00", end: "02:00", price: 500)
        let groups = DealMenu.tonight(
            [tonight(cover, now: false)], now: friday(hour: 20), calendar: calendar)
        XCTAssertEqual(groups.first?.title, "Cover $5 from 9")
        XCTAssertEqual(groups.first?.rows.count, 0)
    }

    func testWeekGroupsByDayWithoutStatus() {
        var wings = special(
            .food, title: "FAKE Wings", start: "17:00", end: "22:00",
            items: [DealItem(name: "Ten wings", priceLabel: "$6", category: .food)])
        wings.days = [2]
        var happy = special(.happyHour, start: "21:00", end: "00:00", items: fourItems)
        happy.days = [2, 3]
        let days = DealMenu.week([wings, happy])
        XCTAssertEqual(days.map { $0.day }, [2, 3])
        XCTAssertEqual(days[0].groups.count, 2)
        XCTAssertEqual(days[1].groups.count, 1)
        XCTAssertNil(days[0].groups[0].status)
        XCTAssertFalse(days[0].groups[0].isNow)
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
        XCTAssertEqual(vm.specials.count, 5)
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
        XCTAssertEqual(vm.specials.count, 6)
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
        XCTAssertEqual(vm.specials.count, 5)
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
        XCTAssertEqual(vm.specials.count, 4)
        let stored = try await api.listSpecials(barID: owl)
        XCTAssertEqual(stored.count, 4)
    }

    func testAddSpecialWithItemsAndAllNight() async throws {
        let (vm, _) = makeVM()
        await vm.load()
        var draft = SpecialDraft()
        draft.kind = .drink
        draft.title = "FAKE Late drafts"
        draft.allDay = true
        draft.days = [4, 5]
        var item = DealItemDraft()
        item.name = " Lager drafts "
        item.priceLabel = "$3"
        item.category = .beer
        item.note = "Dine in only"
        draft.items = [item, DealItemDraft()]
        XCTAssertNil(draft.problem)
        XCTAssertEqual(draft.input.items.count, 1)
        let ok = await vm.add(draft.input)
        XCTAssertTrue(ok)
        let created = try XCTUnwrap(vm.specials.last)
        XCTAssertTrue(created.allDay)
        XCTAssertEqual(created.startLocal, "12:00")
        XCTAssertEqual(created.endLocal, "04:00")
        XCTAssertEqual(created.items.count, 1)
        XCTAssertEqual(created.items[0].name, "Lager drafts")
        XCTAssertEqual(created.items[0].category, .beer)
        XCTAssertEqual(created.items[0].note, "Dine in only")
    }

    func testUpdateItemsAndAllNight() async throws {
        let (vm, _) = makeVM()
        await vm.load()
        let target = try XCTUnwrap(vm.specials.first(where: { $0.id == "fake-special-2" }))
        XCTAssertEqual(target.items.count, 4)
        var draft = SpecialDraft(editing: target)
        XCTAssertEqual(draft.items.count, 4)
        draft.items.removeLast()
        draft.allDay = true
        let ok = await vm.update(target, patch: draft.patch)
        XCTAssertTrue(ok)
        let fresh = try XCTUnwrap(vm.specials.first(where: { $0.id == target.id }))
        XCTAssertEqual(fresh.items.count, 3)
        XCTAssertTrue(fresh.allDay)
    }

    func testDraftItemValidation() {
        var draft = SpecialDraft()
        draft.title = "FAKE Deal"
        draft.items = [DealItemDraft()]
        XCTAssertNil(draft.problem, "a blank row is ignored")
        var half = DealItemDraft()
        half.name = "Drafts"
        draft.items = [half]
        XCTAssertEqual(draft.problem, "Each item needs a name and a price.")
        var full = DealItemDraft()
        full.name = "Drafts"
        full.priceLabel = "$2"
        draft.items = Array(repeating: full, count: 21)
        XCTAssertEqual(draft.problem, "Add up to 20 items.")
        draft.items = Array(repeating: full, count: 20)
        XCTAssertNil(draft.problem)
    }

    func testAllNightIgnoresMatchingTimes() {
        var draft = SpecialDraft()
        draft.title = "FAKE All night"
        draft.start = "20:00"
        draft.end = "20:00"
        XCTAssertNotNil(draft.problem)
        draft.allDay = true
        XCTAssertNil(draft.problem)
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

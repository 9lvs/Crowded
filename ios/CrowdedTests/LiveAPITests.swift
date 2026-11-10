import XCTest
@testable import Crowded

/// Runs LiveAPI and the generated OpenAPI client end to end against stubbed HTTP responses.
final class LiveAPITests: XCTestCase {
    private var store: InMemorySecureStore!
    private var api: LiveAPI!

    override func setUp() {
        super.setUp()
        StubURLProtocol.reset()
        store = InMemorySecureStore()
        api = LiveAPI(
            baseURL: URL(string: "http://test.local")!,
            secureStore: store,
            session: StubURLProtocol.makeSession()
        )
    }

    private func signIn() async throws {
        StubURLProtocol.stub("POST", "/v1/auth/verify-code", json: Fixtures.tokenPair())
        _ = try await api.verifyCode(phone: "+15550001234", code: "123456", ageAttested: true)
    }

    func testVerifyCodeStoresRefreshTokenAndMapsMe() async throws {
        StubURLProtocol.stub("POST", "/v1/auth/verify-code", json: Fixtures.tokenPair())
        let me = try await api.verifyCode(phone: "+15550001234", code: "123456", ageAttested: true)
        XCTAssertEqual(me.role, .user)
        XCTAssertEqual(me.waitThresholdMin, 20)
        XCTAssertNil(me.staffBarId)
        XCTAssertEqual(store.read(TokenStore.refreshKey), "refresh-1")
        let hasSession = await api.hasStoredSession()
        XCTAssertTrue(hasSession)
    }

    func testBarsDecodeWithNullsAndUnknownFields() async throws {
        try await signIn()
        StubURLProtocol.stub("GET", "/v1/bars", json: Fixtures.bars)
        let bars = try await api.bars()
        XCTAssertEqual(bars.count, 2)
        XCTAssertEqual(bars[0].live.waitMin, 31)
        XCTAssertEqual(bars[0].live.crowdLevel, .packed)
        XCTAssertEqual(bars[0].verdict.recommendation, .buyPass)
        XCTAssertNotNil(bars[0].live.updatedAt)
        XCTAssertFalse(bars[1].live.hasRecentData)
        XCTAssertNil(bars[1].live.waitMin)
        XCTAssertNil(bars[1].passPriceCents)
        XCTAssertEqual(bars[1].verdict.recommendation, .noData)
    }

    func testBarsDecodeSpecialsAndCover() async throws {
        try await signIn()
        StubURLProtocol.stub("GET", "/v1/bars", json: Fixtures.barsWithSpecials)
        let bars = try await api.bars()
        XCTAssertEqual(bars.count, 2)
        XCTAssertEqual(bars[0].specialsTonight.count, 2)
        XCTAssertEqual(bars[0].specialsTonight[0].special.kind, .happyHour)
        XCTAssertTrue(bars[0].specialsTonight[0].isNow)
        XCTAssertEqual(bars[0].specialsTonight[0].special.postedBy, .crowded)
        XCTAssertNil(bars[0].specialsTonight[0].special.priceCents)
        XCTAssertEqual(bars[0].coverTonight?.special.kind, .cover)
        XCTAssertEqual(bars[0].coverTonight?.special.priceCents, 500)
        XCTAssertEqual(bars[0].coverTonight?.special.startLocal, "21:00")
        XCTAssertEqual(bars[0].coverTonight?.special.postedBy, .bar)
        XCTAssertEqual(
            SpecialsText.tonightLine(for: bars[0]), "Happy hour now: $2 double wells, $2 drafts +2")
        XCTAssertTrue(bars[1].specialsTonight.isEmpty)
        XCTAssertNil(bars[1].coverTonight)
        XCTAssertNil(SpecialsText.tonightLine(for: bars[1]))
    }

    func testSpecialTonightDecodesItemsAndAllDay() async throws {
        try await signIn()
        StubURLProtocol.stub("GET", "/v1/bars", json: Fixtures.barsWithSpecials)
        let bars = try await api.bars()
        let happy = bars[0].specialsTonight[0].special
        XCTAssertFalse(happy.allDay)
        XCTAssertEqual(happy.items.count, 4)
        XCTAssertEqual(happy.items[0].name, "Double wells")
        XCTAssertEqual(happy.items[0].priceLabel, "$2")
        XCTAssertEqual(happy.items[0].category, .mixers)
        XCTAssertEqual(happy.items[0].note, "")
        XCTAssertEqual(happy.items[1].note, "")
        XCTAssertEqual(happy.items[2].category, .food)
        XCTAssertEqual(happy.items[2].note, "Dine in only")
        XCTAssertEqual(happy.items[3].category, .other)
        XCTAssertFalse(bars[0].specialsTonight[1].special.allDay)
        XCTAssertTrue(bars[0].specialsTonight[1].special.items.isEmpty)
    }

    // Separate test: StubURLProtocol keeps the first stub registered for a path in a test.
    func testAllNightSpecialDecodesAndBuildsTonightLine() async throws {
        try await signIn()
        StubURLProtocol.stub("GET", "/v1/bars", json: Fixtures.barsAllNight)
        let nightBars = try await api.bars()
        let night = nightBars[0].specialsTonight[0].special
        XCTAssertTrue(night.allDay)
        XCTAssertEqual(night.items.count, 1)
        XCTAssertEqual(night.items[0].category, .beer)
        XCTAssertEqual(SpecialsText.tonightLine(for: nightBars[0]), "All night: $3 lager drafts")
    }

    func testBarsWithoutSpecialFieldsStillDecode() async throws {
        try await signIn()
        StubURLProtocol.stub("GET", "/v1/bars", json: Fixtures.bars)
        let bars = try await api.bars()
        XCTAssertTrue(bars[0].specialsTonight.isEmpty)
        XCTAssertNil(bars[0].coverTonight)
    }

    func testBearerTokenIsSent() async throws {
        try await signIn()
        StubURLProtocol.stub("GET", "/v1/me", json: Fixtures.me)
        _ = try await api.me()
        let request = StubURLProtocol.requests.last { $0.url?.path == "/v1/me" }
        XCTAssertEqual(request?.value(forHTTPHeaderField: "Authorization"), "Bearer access-1")
    }

    func testActiveSessionNullMeansNone() async throws {
        try await signIn()
        StubURLProtocol.stub("GET", "/v1/line-sessions/active", json: "null")
        let none = try await api.activeSession()
        XCTAssertNil(none)
    }

    func testActiveSessionDecodes() async throws {
        try await signIn()
        StubURLProtocol.stub("GET", "/v1/line-sessions/active", json: Fixtures.session)
        let session = try await api.activeSession()
        XCTAssertEqual(session?.status, .active)
        XCTAssertEqual(session?.predictedWaitMin, 31)
    }

    func testExpiredAccessTokenRefreshesOnceAndRetries() async throws {
        try await signIn()
        StubURLProtocol.stub("GET", "/v1/me", status: 401, json: "{\"detail\":\"not_authenticated\"}")
        StubURLProtocol.stub("GET", "/v1/me", json: Fixtures.me)
        StubURLProtocol.stub(
            "POST", "/v1/auth/refresh",
            json: Fixtures.tokenPair(access: "access-2", refresh: "refresh-2")
        )
        let me = try await api.me()
        XCTAssertEqual(me.phoneHint, "ending in 34")
        XCTAssertEqual(StubURLProtocol.count("POST", "/v1/auth/refresh"), 1)
        XCTAssertEqual(store.read(TokenStore.refreshKey), "refresh-2")
        let last = StubURLProtocol.requests.last { $0.url?.path == "/v1/me" }
        XCTAssertEqual(last?.value(forHTTPHeaderField: "Authorization"), "Bearer access-2")
    }

    func testRejectedRefreshSignsOutLocally() async throws {
        try await signIn()
        StubURLProtocol.stub("GET", "/v1/me", status: 401, json: "{\"detail\":\"not_authenticated\"}")
        StubURLProtocol.stub("POST", "/v1/auth/refresh", status: 401, json: "{\"detail\":\"invalid_refresh\"}")
        do {
            _ = try await api.me()
            XCTFail("expected an error")
        } catch let error as APIError {
            XCTAssertEqual(error.status, 401)
        }
        XCTAssertNil(store.read(TokenStore.refreshKey))
    }

    func testServerDetailBecomesFriendlyError() async throws {
        StubURLProtocol.stub("POST", "/v1/auth/verify-code", status: 400, json: "{\"detail\":\"invalid_code\"}")
        do {
            _ = try await api.verifyCode(phone: "+15550001234", code: "000000", ageAttested: true)
            XCTFail("expected an error")
        } catch let error as APIError {
            XCTAssertEqual(error.detail, "invalid_code")
            XCTAssertEqual(error.errorDescription, "That code didn't work. Check it and try again.")
        }
    }

    func testDeleteAccountClearsKeychain() async throws {
        try await signIn()
        StubURLProtocol.stub("DELETE", "/v1/me", status: 204, json: "")
        try await api.deleteAccount()
        XCTAssertNil(store.read(TokenStore.refreshKey))
        let hasSession = await api.hasStoredSession()
        XCTAssertFalse(hasSession)
    }

    func testSignOutRevokesAndClears() async throws {
        try await signIn()
        StubURLProtocol.stub("POST", "/v1/auth/logout", status: 204, json: "")
        await api.signOut()
        XCTAssertEqual(StubURLProtocol.count("POST", "/v1/auth/logout"), 1)
        XCTAssertNil(store.read(TokenStore.refreshKey))
    }

    func testEndSessionDecodesVerifiedTrue() async throws {
        try await signIn()
        StubURLProtocol.stub(
            "POST", "/v1/line-sessions/s1/end",
            json: """
            {"id":"s1","bar_id":"b1","status":"completed","started_at":"2026-11-14T03:30:00Z",
             "ended_at":"2026-11-14T03:42:00Z","predicted_wait_min":31,"actual_wait_min":12.0,
             "near_bar":true,"points_awarded":20,"verified":true}
            """
        )
        let done = try await api.endSession(id: "s1", outcome: .inside, doorCode: "1234")
        XCTAssertTrue(done.verified)
        XCTAssertEqual(done.pointsAwarded, 20)
        XCTAssertEqual(done.status, .completed)
    }

    func testSessionWithoutVerifiedFieldIsNotVerified() async throws {
        try await signIn()
        StubURLProtocol.stub("GET", "/v1/line-sessions/active", json: Fixtures.session)
        let session = try await api.activeSession()
        XCTAssertEqual(session?.verified, false)
    }

    func testDoorCodeDecodes() async throws {
        try await signIn()
        StubURLProtocol.stub(
            "GET", "/v1/staff/bars/b1/door-code", json: "{\"code\":\"4821\",\"expires_in\":97}")
        let code = try await api.doorCode(barId: "b1")
        XCTAssertEqual(code.code, "4821")
        XCTAssertEqual(code.expiresIn, 97)
    }

    func testStartAndEndLineSample() async throws {
        try await signIn()
        StubURLProtocol.stub(
            "POST", "/v1/staff/bars/b1/line-samples", status: 201,
            json: "{\"id\":\"x1\",\"bar_id\":\"b1\",\"status\":\"active\",\"started_at\":\"2026-11-14T03:30:00Z\"}"
        )
        let started = try await api.startLineSample(barId: "b1")
        XCTAssertEqual(started.status, .active)
        StubURLProtocol.stub(
            "POST", "/v1/staff/bars/b1/line-samples/x1/end",
            json: "{\"id\":\"x1\",\"bar_id\":\"b1\",\"status\":\"completed\",\"started_at\":\"2026-11-14T03:30:00Z\",\"ended_at\":\"2026-11-14T03:44:00Z\",\"actual_wait_min\":14.0}"
        )
        let ended = try await api.endLineSample(barId: "b1", sampleId: "x1", outcome: .inside)
        XCTAssertEqual(ended.status, .completed)
        XCTAssertEqual(ended.actualWaitMin, 14.0)
    }

    func testStaffStateDecodesCountsExitsAndInside() async throws {
        try await signIn()
        StubURLProtocol.stub(
            "GET", "/v1/staff/bars/b1",
            json: """
            {"bar_id":"b1","bar_name":"FAKE Owl","capacity":220,"headcount":0,
             "entries_tonight":42,"exits_tonight":0,"line_size":"long",
             "line_updated_at":"2026-11-14T03:30:00Z","counts_exits":false,
             "inside":{"crowd_level":"busy","drink_wait":"10_to_20","updated_at":"2026-11-14T03:31:00Z"},
             "live":\(Fixtures.live)}
            """
        )
        let state = try await api.staffState(barId: "b1")
        XCTAssertFalse(state.countsExits)
        XCTAssertEqual(state.entriesTonight, 42)
        XCTAssertEqual(state.inside?.crowdLevel, .busy)
        XCTAssertEqual(state.inside?.drinkWait, .tenToTwenty)
        XCTAssertNotNil(state.inside?.updatedAt)
    }

    func testStaffStateWithoutNewFieldsStillDecodes() async throws {
        try await signIn()
        StubURLProtocol.stub(
            "GET", "/v1/staff/bars/b2",
            json: """
            {"bar_id":"b2","bar_name":"FAKE Heron","capacity":300,"headcount":10,
             "entries_tonight":12,"exits_tonight":2,"live":\(Fixtures.noDataLive)}
            """
        )
        let state = try await api.staffState(barId: "b2")
        XCTAssertTrue(state.countsExits)
        XCTAssertNil(state.inside)
        XCTAssertNil(state.live.drinkWait)
    }

    func testLiveDecodesDrinkWait() async throws {
        try await signIn()
        StubURLProtocol.stub(
            "GET", "/v1/bars",
            json: """
            [{"id":"b1","slug":"fake-owl","name":"FAKE Owl","address":"1 Fake St","capacity":220,
              "pass_price_cents":1500,
              "live":{"has_recent_data":true,"wait_min":31,"wait_low_min":23,"wait_high_min":40,
                      "crowd_level":"packed","headcount":205,"capacity_ratio":0.932,
                      "drink_wait":"over_20","drink_wait_label":"Over 20 min",
                      "confidence":"high",
                      "basis":{"text":"Based on 2 inside updates","window_min":30,"reports":0,
                               "timers":0,"door_events":0,"staff_line_updates":0,
                               "inside_updates":2},
                      "flags":[],"updated_at":"2026-11-14T03:30:00Z"},
              "verdict":{"recommendation":"buy_pass","text":"Get the pass.","threshold_min":20,
                         "pass_price_cents":1500,"minutes_saved":31}}]
            """
        )
        let bars = try await api.bars()
        XCTAssertEqual(bars[0].live.drinkWait, .over20)
        XCTAssertEqual(bars[0].live.drinkWaitLabel, "Over 20 min")
        XCTAssertEqual(bars[0].live.drinkText, "Over 20 min")
        XCTAssertEqual(bars[0].live.basis.insideUpdates, 2)
    }

    func testMeDecodesStaffLevel() async throws {
        StubURLProtocol.stub(
            "POST", "/v1/auth/verify-code",
            json: """
            {"access_token":"access-1","refresh_token":"refresh-1","token_type":"bearer",
             "expires_in":900,
             "user":{"id":"u1","role":"staff","wait_threshold_min":20,"staff_bar_id":"b1",
                     "staff_level":"door","phone_hint":"ending in 34",
                     "created_at":"2026-11-09T04:25:07Z"}}
            """
        )
        let me = try await api.verifyCode(phone: "+15550001234", code: "123456", ageAttested: true)
        XCTAssertEqual(me.staffLevel, .door)
        XCTAssertTrue(me.isStaff)
        XCTAssertFalse(me.isManager)
    }

    func testPostInsideAndSettingsDecodeStaffState() async throws {
        try await signIn()
        StubURLProtocol.stub(
            "POST", "/v1/staff/bars/b1/inside",
            json: """
            {"bar_id":"b1","bar_name":"FAKE Owl","capacity":220,"headcount":5,
             "entries_tonight":5,"exits_tonight":0,"counts_exits":true,
             "inside":{"crowd_level":"easy","updated_at":"2026-11-14T03:31:00Z"},
             "live":\(Fixtures.live)}
            """
        )
        let state = try await api.postInside(barId: "b1", crowd: .easy, drinkWait: nil)
        XCTAssertEqual(state.inside?.crowdLevel, .easy)
        XCTAssertNil(state.inside?.drinkWait)
        let request = StubURLProtocol.requests.last { $0.url?.path == "/v1/staff/bars/b1/inside" }
        XCTAssertEqual(request?.httpMethod, "POST")
    }

    func testManagerOnlyErrorMapsToPlainLanguage() async throws {
        try await signIn()
        StubURLProtocol.stub(
            "PATCH", "/v1/staff/bars/b1/settings", status: 403,
            json: "{\"detail\":\"manager_only\"}")
        do {
            _ = try await api.setCountsExits(barId: "b1", value: false)
            XCTFail("expected an error")
        } catch let error as APIError {
            XCTAssertEqual(error.status, 403)
            XCTAssertEqual(error.errorDescription, "Only managers can change this.")
        }
    }
}

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
        XCTAssertEqual(SpecialsText.tonightLine(for: bars[0]), "Happy hour now until 8 PM")
        XCTAssertTrue(bars[1].specialsTonight.isEmpty)
        XCTAssertNil(bars[1].coverTonight)
        XCTAssertNil(SpecialsText.tonightLine(for: bars[1]))
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
}

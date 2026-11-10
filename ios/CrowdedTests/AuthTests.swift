import XCTest
@testable import Crowded

final class TokenStoreTests: XCTestCase {
    /// Counts refresher calls across concurrent tasks.
    actor Counter {
        var value = 0
        func increment() -> Int {
            value += 1
            return value
        }
    }

    func testConcurrentRefreshesShareOneServerCall() async throws {
        let store = InMemorySecureStore()
        _ = store.write(TokenStore.refreshKey, value: "refresh-1")
        let counter = Counter()
        let tokens = TokenStore(secureStore: store) { _ in
            let n = await counter.increment()
            try await Task.sleep(nanoseconds: 100_000_000)
            return TokenPairValue(access: "access-\(n + 1)", refresh: "refresh-\(n + 1)")
        }

        let results: [String] = try await withThrowingTaskGroup(of: String.self) { group in
            for _ in 0..<5 {
                group.addTask {
                    return try await tokens.refreshAccessToken(failedToken: nil)
                }
            }
            var collected: [String] = []
            for try await value in group {
                collected.append(value)
            }
            return collected
        }

        let calls = await counter.value
        XCTAssertEqual(calls, 1)
        XCTAssertEqual(Set(results), ["access-2"])
        XCTAssertEqual(store.read(TokenStore.refreshKey), "refresh-2")
    }

    func testNoRefreshTokenMeansSignedOut() async {
        let tokens = TokenStore(secureStore: InMemorySecureStore()) { _ in
            XCTFail("should not call the server")
            return TokenPairValue(access: "x", refresh: "y")
        }
        do {
            _ = try await tokens.refreshAccessToken(failedToken: nil)
            XCTFail("expected notSignedIn")
        } catch {
            XCTAssertEqual(error as? APIError, .notSignedIn)
        }
    }

    func testClearRemovesEverything() async {
        let store = InMemorySecureStore()
        let tokens = TokenStore(secureStore: store) { _ in TokenPairValue(access: "a", refresh: "r") }
        await tokens.store(TokenPairValue(access: "a1", refresh: "r1"))
        XCTAssertEqual(store.read(TokenStore.refreshKey), "r1")
        await tokens.clear()
        XCTAssertNil(store.read(TokenStore.refreshKey))
        let access = await tokens.accessToken()
        XCTAssertNil(access)
    }
}

final class SecureStoreTests: XCTestCase {
    func testInMemoryStoreRoundTrip() {
        let store = InMemorySecureStore()
        XCTAssertNil(store.read("k"))
        XCTAssertTrue(store.write("k", value: "v1"))
        XCTAssertTrue(store.write("k", value: "v2"))
        XCTAssertEqual(store.read("k"), "v2")
        store.delete("k")
        XCTAssertNil(store.read("k"))
    }

    func testKeychainRoundTripWhenAvailable() throws {
        let store = KeychainStore(service: "app.crowded.ios.tests.\(UUID().uuidString)")
        // Unsigned simulator builds in CI can lack keychain access. Skip rather than fail.
        guard store.write("k", value: "v1") else {
            throw XCTSkip("Keychain not available in this test environment")
        }
        XCTAssertEqual(store.read("k"), "v1")
        XCTAssertTrue(store.write("k", value: "v2"))
        XCTAssertEqual(store.read("k"), "v2")
        store.delete("k")
        XCTAssertNil(store.read("k"))
    }
}

final class ModelTests: XCTestCase {
    func testMoneyFormatting() {
        XCTAssertEqual(Money.format(cents: 1500), "$15")
        XCTAssertEqual(Money.format(cents: 1250), "$12.50")
        XCTAssertEqual(Money.format(cents: 5), "$0.05")
    }

    func testDatesWithAndWithoutFractions() {
        XCTAssertNotNil(APIDate.parse("2026-11-09T04:25:07.123456Z"))
        XCTAssertNotNil(APIDate.parse("2026-11-09T04:25:07Z"))
        XCTAssertNotNil(APIDate.parse("2026-11-09T04:25:07+00:00"))
        XCTAssertNil(APIDate.parse(nil))
        XCTAssertNil(APIDate.parse("not a date"))
    }

    func testUnknownServerValuesFallBack() {
        XCTAssertEqual(Role(api: "superuser"), .user)
        XCTAssertEqual(Confidence(api: "very_high"), .low)
        XCTAssertEqual(Recommendation(api: "new_thing"), .noData)
        XCTAssertNil(CrowdLevel(api: "insane"))
        XCTAssertEqual(LineSize(api: "very_long"), .veryLong)
        XCTAssertEqual(DoorDirection.entry.rawValue, "in")
    }

    func testVerdictShortText() {
        XCTAssertEqual(PreviewData.buyPass.shortText, "Pass $15 worth it")
    }
}

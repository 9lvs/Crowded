import Foundation

struct TokenPairValue: Sendable, Equatable {
    var access: String
    var refresh: String
}

/// Holds the session. The access token (15 min) lives only in memory. The refresh token lives in
/// the SecureStore (Keychain in production). Refreshes are single flight: concurrent 401s share
/// one refresh call, so the server never sees the same refresh token twice from this device.
actor TokenStore {
    typealias Refresher = @Sendable (String) async throws -> TokenPairValue

    static let refreshKey = "refresh_token"

    private let secureStore: SecureStore
    private let refresher: Refresher
    private var access: String?
    private var inFlight: Task<TokenPairValue, Error>?
    /// Number of times the server refresh was actually called. Read by tests.
    private(set) var refreshCalls = 0

    init(secureStore: SecureStore, refresher: @escaping Refresher) {
        self.secureStore = secureStore
        self.refresher = refresher
    }

    func accessToken() -> String? {
        return access
    }

    func hasRefreshToken() -> Bool {
        return secureStore.read(Self.refreshKey) != nil
    }

    func store(_ pair: TokenPairValue) {
        access = pair.access
        _ = secureStore.write(Self.refreshKey, value: pair.refresh)
    }

    func refreshToken() -> String? {
        return secureStore.read(Self.refreshKey)
    }

    func clear() {
        access = nil
        inFlight?.cancel()
        inFlight = nil
        secureStore.delete(Self.refreshKey)
    }

    /// Returns a fresh access token. If another caller already refreshed after `failedToken`
    /// was issued, returns the newer token without calling the server again.
    func refreshAccessToken(failedToken: String?) async throws -> String {
        if let current = access, current != failedToken {
            return current
        }
        if let task = inFlight {
            let pair = try await task.value
            return pair.access
        }
        guard let refresh = secureStore.read(Self.refreshKey) else {
            throw APIError.notSignedIn
        }
        let refresher = self.refresher
        refreshCalls += 1
        let task = Task<TokenPairValue, Error> {
            return try await refresher(refresh)
        }
        inFlight = task
        do {
            let pair = try await task.value
            access = pair.access
            _ = secureStore.write(Self.refreshKey, value: pair.refresh)
            inFlight = nil
            return pair.access
        } catch {
            inFlight = nil
            if let api = error as? APIError, api.status == 401 {
                // Refresh token rejected (expired, revoked, reused). Sign out locally.
                access = nil
                secureStore.delete(Self.refreshKey)
            }
            throw error
        }
    }
}

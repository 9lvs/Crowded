import Foundation
import Security

/// Where the refresh token lives. Production uses the Keychain. Tests and the mock use memory.
/// Tokens never go to UserDefaults.
protocol SecureStore: AnyObject, Sendable {
    func read(_ key: String) -> String?
    func write(_ key: String, value: String) -> Bool
    func delete(_ key: String)
}

final class KeychainStore: SecureStore, @unchecked Sendable {
    private let service: String

    init(service: String = "app.crowded.ios.auth") {
        self.service = service
    }

    private func baseQuery(_ key: String) -> [String: Any] {
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
    }

    func read(_ key: String) -> String? {
        var query = baseQuery(key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    @discardableResult
    func write(_ key: String, value: String) -> Bool {
        let data = Data(value.utf8)
        let query = baseQuery(key)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecSuccess {
            return true
        }
        if status == errSecItemNotFound {
            var insert = query
            insert[kSecValueData as String] = data
            insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            return SecItemAdd(insert as CFDictionary, nil) == errSecSuccess
        }
        return false
    }

    func delete(_ key: String) {
        SecItemDelete(baseQuery(key) as CFDictionary)
    }
}

/// In memory store for previews, the mock API and unit tests.
final class InMemorySecureStore: SecureStore, @unchecked Sendable {
    private var values: [String: String] = [:]
    private let lock = NSLock()

    init() {}

    func read(_ key: String) -> String? {
        lock.lock()
        defer { lock.unlock() }
        return values[key]
    }

    @discardableResult
    func write(_ key: String, value: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        values[key] = value
        return true
    }

    func delete(_ key: String) {
        lock.lock()
        defer { lock.unlock() }
        values[key] = nil
    }
}

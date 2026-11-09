import SwiftUI

/// System, Light or Dark. Stored in UserDefaults (a display preference, not a secret).
enum ThemePreference: String, CaseIterable, Identifiable {
    case system
    case light
    case dark

    var id: String { rawValue }

    var label: String {
        switch self {
        case .system: return "System"
        case .light: return "Light"
        case .dark: return "Dark"
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }

    static let storageKey = "crowded.theme"

    static func load(_ defaults: UserDefaults = .standard) -> ThemePreference {
        guard let raw = defaults.string(forKey: storageKey) else { return .system }
        return ThemePreference(rawValue: raw) ?? .system
    }

    func save(_ defaults: UserDefaults = .standard) {
        defaults.set(rawValue, forKey: Self.storageKey)
    }
}

extension View {
    /// Standard screen background and text color.
    func crowdedScreen() -> some View {
        return self
            .foregroundStyle(Colors.text)
            .background(Colors.bg.ignoresSafeArea())
    }

    /// Hairline divider under a row, like the web client.
    func hairlineBottom() -> some View {
        return self.overlay(alignment: .bottom) {
            Rectangle().fill(Colors.border).frame(height: 1)
        }
    }
}

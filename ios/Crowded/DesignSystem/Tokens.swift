import SwiftUI
import UIKit

// Crowded design tokens for iOS. These mirror web/css/tokens.css one to one.
// Quick tweaks (see docs/DESIGN_GUIDE.md):
//   Accent color ....... Palette.accentLight / accentDark (monochrome for now)
//   Fonts .............. CrowdedFont.bodyFamily / displayFamily
//   Corner roundness ... Knobs.radiusScale (1 = default, 0 = square, 1.5 = rounder)
//   Density ............ Knobs.density (1 = default, 0.85 = tighter, 1.15 = airier)

enum Knobs {
    static let radiusScale: CGFloat = 1
    static let density: CGFloat = 1
}

/// Raw hex values per theme. Change these to restyle. Components only use `Colors`.
enum Palette {
    // Light (Uber like monochrome)
    static let bgLight = 0xFFFFFF
    static let surfaceLight = 0xF5F5F5
    static let elevatedLight = 0xFFFFFF
    static let borderLight = 0xE6E6E6
    static let borderStrongLight = 0x000000
    static let textLight = 0x000000
    static let text2Light = 0x545454
    static let text3Light = 0x767676
    static let primaryLight = 0x000000
    static let primaryInkLight = 0xFFFFFF
    static let accentLight = 0x000000  // color hook, set to a hue to bring color back
    static let meterOnLight = 0x000000
    static let meterOffLight = 0xE0E0E0
    static let chartTypicalLight = 0xD6D6D6
    static let chartTonightLight = 0x000000

    // Dark (true black)
    static let bgDark = 0x000000
    static let surfaceDark = 0x161616
    static let elevatedDark = 0x121212
    static let borderDark = 0x262626
    static let borderStrongDark = 0xFFFFFF
    static let textDark = 0xFFFFFF
    static let text2Dark = 0xB3B3B3
    static let text3Dark = 0x8A8A8A
    static let primaryDark = 0xFFFFFF
    static let primaryInkDark = 0x000000
    static let accentDark = 0xFFFFFF
    static let meterOnDark = 0xFFFFFF
    static let meterOffDark = 0x333333
    static let chartTypicalDark = 0x3A3A3A
    static let chartTonightDark = 0xFFFFFF
}

extension UIColor {
    convenience init(hex: Int) {
        let r = CGFloat((hex >> 16) & 0xFF) / 255
        let g = CGFloat((hex >> 8) & 0xFF) / 255
        let b = CGFloat(hex & 0xFF) / 255
        self.init(red: r, green: g, blue: b, alpha: 1)
    }
}

extension Color {
    /// A color that follows light and dark mode without an asset catalog.
    static func adaptive(light: Int, dark: Int) -> Color {
        let ui = UIColor { traits in
            traits.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light)
        }
        return Color(uiColor: ui)
    }
}

enum Colors {
    static let bg = Color.adaptive(light: Palette.bgLight, dark: Palette.bgDark)
    static let surface = Color.adaptive(light: Palette.surfaceLight, dark: Palette.surfaceDark)
    static let elevated = Color.adaptive(light: Palette.elevatedLight, dark: Palette.elevatedDark)
    static let border = Color.adaptive(light: Palette.borderLight, dark: Palette.borderDark)
    static let borderStrong = Color.adaptive(light: Palette.borderStrongLight, dark: Palette.borderStrongDark)
    static let text = Color.adaptive(light: Palette.textLight, dark: Palette.textDark)
    static let text2 = Color.adaptive(light: Palette.text2Light, dark: Palette.text2Dark)
    static let text3 = Color.adaptive(light: Palette.text3Light, dark: Palette.text3Dark)
    static let primary = Color.adaptive(light: Palette.primaryLight, dark: Palette.primaryDark)
    static let primaryInk = Color.adaptive(light: Palette.primaryInkLight, dark: Palette.primaryInkDark)
    static let accent = Color.adaptive(light: Palette.accentLight, dark: Palette.accentDark)
    static let meterOn = Color.adaptive(light: Palette.meterOnLight, dark: Palette.meterOnDark)
    static let meterOff = Color.adaptive(light: Palette.meterOffLight, dark: Palette.meterOffDark)
    static let chartTypical = Color.adaptive(light: Palette.chartTypicalLight, dark: Palette.chartTypicalDark)
    static let chartTonight = Color.adaptive(light: Palette.chartTonightLight, dark: Palette.chartTonightDark)
}

enum Spacing {
    static let s1: CGFloat = 4 * Knobs.density
    static let s2: CGFloat = 8 * Knobs.density
    static let s3: CGFloat = 12 * Knobs.density
    static let s4: CGFloat = 16 * Knobs.density
    static let s5: CGFloat = 20 * Knobs.density
    static let s6: CGFloat = 24 * Knobs.density
    static let s8: CGFloat = 32 * Knobs.density
    static let s10: CGFloat = 40 * Knobs.density
    static let gutter: CGFloat = 20
    /// Minimum touch target. Apple asks for 44 pt, we use 48 like the web client.
    static let touch: CGFloat = 48
}

enum Radius {
    static let sm: CGFloat = 6 * Knobs.radiusScale
    static let md: CGFloat = 8 * Knobs.radiusScale
    static let lg: CGFloat = 12 * Knobs.radiusScale
}

enum Motion {
    static let fast: Double = 0.12
    static let base: Double = 0.2
    static let slow: Double = 0.3

    /// Animation that collapses to none when Reduce Motion is on.
    static func animation(_ duration: Double, reduceMotion: Bool) -> Animation? {
        return reduceMotion ? nil : .easeOut(duration: duration)
    }
}

import SwiftUI

/// Fonts are bundled (SIL OFL 1.1, see Resources/Fonts/OFL.txt) and registered via UIAppFonts.
/// DM Sans for all text. Bricolage Grotesque only for big numbers. Every style scales with
/// Dynamic Type through `relativeTo`.
enum CrowdedFont {
    static let regular = "DMSans-Regular"
    static let medium = "DMSans-Medium"
    static let bold = "DMSans-Bold"
    static let numberSemibold = "BricolageGrotesque-SemiBold"
    static let numberHeavy = "BricolageGrotesque-ExtraBold"

    // Type scale (pt), same steps as the web tokens.
    static let xs: CGFloat = 12
    static let sm: CGFloat = 14
    static let md: CGFloat = 16
    static let lg: CGFloat = 18
    static let xl: CGFloat = 24
    static let xxl: CGFloat = 32
    static let hero: CGFloat = 44
    static let giant: CGFloat = 72
}

extension Font {
    static let crowdedTitle = Font.custom(CrowdedFont.bold, size: CrowdedFont.xxl, relativeTo: .largeTitle)
    static let crowdedSection = Font.custom(CrowdedFont.bold, size: CrowdedFont.xl, relativeTo: .title2)
    static let crowdedRowTitle = Font.custom(CrowdedFont.bold, size: CrowdedFont.lg, relativeTo: .headline)
    static let crowdedBody = Font.custom(CrowdedFont.regular, size: CrowdedFont.md, relativeTo: .body)
    static let crowdedBodyStrong = Font.custom(CrowdedFont.medium, size: CrowdedFont.md, relativeTo: .body)
    static let crowdedButton = Font.custom(CrowdedFont.bold, size: CrowdedFont.md, relativeTo: .body)
    static let crowdedSmall = Font.custom(CrowdedFont.regular, size: CrowdedFont.sm, relativeTo: .subheadline)
    static let crowdedCaption = Font.custom(CrowdedFont.regular, size: CrowdedFont.xs, relativeTo: .caption)
    static let crowdedLabel = Font.custom(CrowdedFont.medium, size: CrowdedFont.sm, relativeTo: .subheadline)

    /// Big numbers: wait minutes, headcount, timer.
    static func crowdedNumber(_ size: CGFloat = CrowdedFont.hero) -> Font {
        return Font.custom(CrowdedFont.numberHeavy, size: size, relativeTo: .largeTitle)
    }
}

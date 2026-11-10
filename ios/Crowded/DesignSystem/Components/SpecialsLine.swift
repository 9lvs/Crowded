import SwiftUI

/// One quiet deal line under the basis line: "Happy hour now: $2 double wells, $2 drafts +2",
/// "Happy hour at 9: $1 well mixers +3", "Cover $5 from 9 PM". Always one line, cut with an
/// ellipsis. Draws nothing when the bar has no deals. The words carry the meaning, the small
/// tag icon is decoration, and VoiceOver reads the full text.
struct SpecialsLine: View {
    let specials: [SpecialTonight]
    let cover: SpecialTonight?

    init(specials: [SpecialTonight], cover: SpecialTonight?) {
        self.specials = specials
        self.cover = cover
    }

    init(bar: Bar) {
        self.specials = bar.specialsTonight
        self.cover = bar.coverTonight
    }

    var body: some View {
        if let text = SpecialsText.tonightLine(specials: specials, cover: cover) {
            HStack(spacing: Spacing.s1) {
                Image(systemName: "tag")
                    .font(.crowdedCaption)
                    .accessibilityHidden(true)
                Text(text)
                    .font(.crowdedCaption)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            .foregroundStyle(Colors.text2)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(text)
        }
    }
}

#Preview("SpecialsLine") {
    VStack(alignment: .leading, spacing: 8) {
        SpecialsLine(bar: PreviewData.owl)
        SpecialsLine(specials: PreviewData.coverOnly, cover: PreviewData.coverOnly.first)
        SpecialsLine(specials: PreviewData.twoSpecials, cover: nil)
        SpecialsLine(bar: PreviewData.heron)
    }
    .padding()
    .crowdedScreen()
}

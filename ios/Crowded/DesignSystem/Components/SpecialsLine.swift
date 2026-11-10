import SwiftUI

/// One quiet line under the basis line: "Happy hour now until 8 PM", "Cover $5 from 9 PM",
/// "2 specials tonight". Draws nothing when the bar has no specials. The words carry the
/// meaning, the small tag icon is decoration.
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
                    .fixedSize(horizontal: false, vertical: true)
            }
            .foregroundStyle(Colors.text2)
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

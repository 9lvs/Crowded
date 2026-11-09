import SwiftUI

/// Plain typographic wordmark, no logo box.
struct Wordmark: View {
    var suffix: String? = nil

    var body: some View {
        HStack(spacing: 6) {
            Text("Crowded")
                .font(.custom(CrowdedFont.bold, size: CrowdedFont.xl, relativeTo: .title2))
            if let suffix {
                Text(suffix)
                    .font(.custom(CrowdedFont.regular, size: CrowdedFont.xl, relativeTo: .title2))
                    .foregroundStyle(Colors.text2)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

#Preview("Wordmark") {
    VStack(spacing: 12) {
        Wordmark()
        Wordmark(suffix: "for staff")
    }
    .padding()
    .crowdedScreen()
}

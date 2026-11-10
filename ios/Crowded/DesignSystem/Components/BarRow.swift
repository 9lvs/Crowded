import SwiftUI

/// One bar on the Tonight list (the BarCard of the spec, drawn as a flat row with a hairline).
/// Name, crowd level, wait, basis, then one quiet deal line. The whole row opens the bar page,
/// where the pass verdict and the report actions live.
struct BarRow: View {
    let bar: Bar

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s2) {
            HStack(alignment: .top, spacing: Spacing.s3) {
                VStack(alignment: .leading, spacing: Spacing.s2) {
                    Text(bar.name)
                        .font(.crowdedRowTitle)
                        .multilineTextAlignment(.leading)
                    CrowdMeter(level: bar.live.crowdLevel)
                    BasisLine(live: bar.live)
                }
                Spacer(minLength: Spacing.s2)
                WaitStat(live: bar.live)
            }
            SpecialsLine(bar: bar)
        }
        .frame(minHeight: Spacing.touch)
        .padding(.vertical, Spacing.s4)
        .hairlineBottom()
    }
}

#Preview("BarRow") {
    VStack(spacing: 0) {
        BarRow(bar: PreviewData.owl)
        BarRow(bar: PreviewData.heron)
    }
    .padding(.horizontal, Spacing.gutter)
    .crowdedScreen()
}

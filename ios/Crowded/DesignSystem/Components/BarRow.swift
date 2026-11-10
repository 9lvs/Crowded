import SwiftUI

/// One bar on the Tonight list (the BarCard of the spec, drawn as a flat row with a hairline).
/// Crowd first: name, crowd level, basis, then the quiet pass line and a Report button.
struct BarRow: View {
    let bar: Bar
    var onReport: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s2) {
            HStack(alignment: .top, spacing: Spacing.s3) {
                VStack(alignment: .leading, spacing: Spacing.s2) {
                    Text(bar.name)
                        .font(.crowdedRowTitle)
                        .multilineTextAlignment(.leading)
                    CrowdMeter(level: bar.live.crowdLevel)
                    BasisLine(live: bar.live)
                    SpecialsLine(bar: bar)
                }
                Spacer(minLength: Spacing.s2)
                WaitStat(live: bar.live)
            }
            HStack {
                VerdictLine(verdict: bar.verdict)
                Spacer()
                Button("Report", action: onReport)
                    .buttonStyle(ChipButtonStyle())
                    .accessibilityLabel("Report crowd at \(bar.name)")
            }
        }
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

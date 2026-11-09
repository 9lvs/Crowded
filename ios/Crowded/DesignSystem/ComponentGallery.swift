#if DEBUG
import SwiftUI

/// Debug only screen with every design system component, reachable from Settings.
/// Use it to check a token change across all components at once, in light and dark.
struct ComponentGallery: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.s6) {
                group("Wordmark") {
                    Wordmark()
                    Wordmark(suffix: "for staff")
                }
                group("Crowd meter") {
                    CrowdMeter(level: .easy)
                    CrowdMeter(level: .busy)
                    CrowdMeter(level: .packed)
                    CrowdMeter(level: nil)
                }
                group("Wait") {
                    HStack {
                        WaitStat(live: PreviewData.packedLive, showRange: true)
                        Spacer()
                        WaitStat(live: Live.noData)
                    }
                }
                group("Basis and verdict") {
                    BasisLine(live: PreviewData.packedLive)
                    VerdictLine(verdict: PreviewData.buyPass)
                    VerdictLine(verdict: PreviewData.buyPass, long: true)
                }
                group("Bar rows") {
                    BarRow(bar: PreviewData.owl)
                    BarRow(bar: PreviewData.heron)
                }
                group("Buttons") {
                    PrimaryButton(title: "Report crowd") {}
                    SecondaryButton(title: "I'm in line") {}
                    Button("Report") {}.buttonStyle(ChipButtonStyle())
                }
                group("Timer ring") {
                    TimerRing(elapsed: 754, predictedMinutes: 30)
                        .frame(maxWidth: .infinity)
                }
                group("Chart") {
                    WaitByHourChart(points: PreviewData.hours)
                }
            }
            .padding(Spacing.gutter)
        }
        .crowdedScreen()
        .navigationTitle("Components")
    }

    @ViewBuilder
    private func group<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: Spacing.s3) {
            Text(title.uppercased())
                .font(.crowdedCaption)
                .foregroundStyle(Colors.text2)
                .tracking(1)
            content()
        }
    }
}

#Preview("Gallery") {
    NavigationStack { ComponentGallery() }
}
#endif

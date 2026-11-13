import SwiftUI

/// The big wait number ("32 min") or "No data" when nothing is recent. Never a stale number.
struct WaitStat: View {
    let live: Live
    var size: CGFloat = CrowdedFont.xxl
    var showRange: Bool = false

    var body: some View {
        VStack(alignment: .trailing, spacing: 2) {
            if live.hasRecentData, let wait = live.waitMin {
                HStack(alignment: .firstTextBaseline, spacing: 3) {
                    Text("\(wait)")
                        .font(.crowdedNumber(size))
                        .monospacedDigit()
                        .contentTransition(.numericText())
                        .animation(Motion.fadeAnimation, value: wait)
                    Text("min")
                        .font(.crowdedSmall)
                        .foregroundStyle(Colors.text2)
                }
                if showRange, let low = live.waitLowMin, let high = live.waitHighMin {
                    Text("\(low) to \(high) min")
                        .font(.crowdedSmall)
                        .foregroundStyle(Colors.text2)
                }
            } else {
                Text(live.hasRecentData ? "Not enough data" : "No data")
                    .font(.crowdedSmall)
                    .foregroundStyle(Colors.text3)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    private var accessibilityText: String {
        guard live.hasRecentData, let wait = live.waitMin else {
            return "Wait: no recent data"
        }
        return "Wait about \(wait) minutes"
    }
}

#Preview("WaitStat") {
    VStack(spacing: 16) {
        WaitStat(live: PreviewData.packedLive, showRange: true)
        WaitStat(live: Live.noData)
    }
    .padding()
    .crowdedScreen()
}

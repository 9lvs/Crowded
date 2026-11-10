import SwiftUI

/// "Based on 6 reports in the last 30 min". Every number in the app ships with its basis.
struct BasisLine: View {
    let live: Live

    var body: some View {
        Text(live.hasRecentData ? live.basis.text : "Nobody has reported in the last 30 min")
            .font(.crowdedCaption)
            .foregroundStyle(Colors.text2)
            .fixedSize(horizontal: false, vertical: true)
    }
}

#Preview("BasisLine") {
    VStack(alignment: .leading, spacing: 8) {
        BasisLine(live: PreviewData.packedLive)
        BasisLine(live: Live.noData)
    }
    .padding()
    .crowdedScreen()
}

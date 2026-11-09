import SwiftUI

/// Quiet pass suggestion. Secondary to crowd and line, so it is plain text, not a colored chip.
struct VerdictLine: View {
    let verdict: Verdict
    var long: Bool = false

    var body: some View {
        Text(long ? verdict.text : verdict.shortText)
            .font(verdict.recommendation == .buyPass ? Font.crowdedBodyStrong : Font.crowdedSmall)
            .foregroundStyle(verdict.recommendation == .noData ? Colors.text3 : Colors.text)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityLabel("Pass: \(long ? verdict.text : verdict.shortText)")
    }
}

#Preview("VerdictLine") {
    VStack(alignment: .leading, spacing: 8) {
        VerdictLine(verdict: PreviewData.buyPass)
        VerdictLine(verdict: PreviewData.buyPass, long: true)
        VerdictLine(verdict: Verdict(
            recommendation: .noData, text: "No recent data. No call yet.", thresholdMin: 20,
            passPriceCents: nil, minutesSaved: nil
        ))
    }
    .padding()
    .crowdedScreen()
}

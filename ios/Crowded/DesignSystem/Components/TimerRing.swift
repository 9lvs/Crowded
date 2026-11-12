import SwiftUI

/// Running line timer. The ring fills toward the predicted wait. Respects Reduce Motion.
struct TimerRing: View {
    let elapsed: TimeInterval
    let predictedMinutes: Int?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var progress: Double {
        guard let predicted = predictedMinutes, predicted > 0 else { return 0 }
        return min(1, elapsed / (Double(predicted) * 60))
    }

    private var clock: String {
        let total = max(0, Int(elapsed))
        let minutes = total / 60
        let seconds = total % 60
        return String(format: "%d:%02d", minutes, seconds)
    }

    var body: some View {
        ZStack {
            Circle()
                .stroke(Colors.meterOff, lineWidth: 10)
            Circle()
                .trim(from: 0, to: progress)
                .stroke(Colors.accent, style: StrokeStyle(lineWidth: 10, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(Motion.animation(Motion.sheet, reduceMotion: reduceMotion), value: progress)
            VStack(spacing: Spacing.s1) {
                Text(clock)
                    .font(.crowdedNumber(CrowdedFont.giant))
                    .monospacedDigit()
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
                if let predicted = predictedMinutes {
                    Text("of about \(predicted) min")
                        .font(.crowdedSmall)
                        .foregroundStyle(Colors.text2)
                }
            }
            .padding(Spacing.s6)
        }
        .frame(maxWidth: 280, maxHeight: 280)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("In line for \(Int(elapsed) / 60) minutes")
    }
}

#Preview("TimerRing") {
    TimerRing(elapsed: 754, predictedMinutes: 30)
        .padding()
        .crowdedScreen()
}

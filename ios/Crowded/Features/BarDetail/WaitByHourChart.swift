import Charts
import SwiftUI

/// Typical wait (grey) vs tonight (solid) by hour. Monochrome, so tonight is also labeled.
struct WaitByHourChart: View {
    let points: [HourPoint]

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s2) {
            Chart {
                ForEach(points) { point in
                    BarMark(
                        x: .value("Hour", point.label),
                        y: .value("Typical", point.typicalWaitMin ?? 0),
                        width: .ratio(0.7),
                        stacking: .unstacked
                    )
                    .foregroundStyle(Colors.chartTypical)
                    .cornerRadius(2)
                    if let tonight = point.tonightWaitMin {
                        BarMark(
                            x: .value("Hour", point.label),
                            y: .value("Tonight", tonight),
                            width: .ratio(0.35),
                            stacking: .unstacked
                        )
                        .foregroundStyle(Colors.chartTonight)
                        .cornerRadius(2)
                    }
                }
            }
            .chartYAxis {
                AxisMarks(position: .leading) { value in
                    AxisGridLine().foregroundStyle(Colors.border)
                    AxisValueLabel {
                        if let minutes = value.as(Int.self) {
                            Text("\(minutes)m")
                                .font(.crowdedCaption)
                                .foregroundStyle(Colors.text2)
                        }
                    }
                }
            }
            .chartXAxis {
                AxisMarks { _ in
                    AxisValueLabel()
                        .font(.crowdedCaption)
                        .foregroundStyle(Colors.text2)
                }
            }
            .frame(height: 180)
            .accessibilityLabel("Wait by hour")
            .accessibilityValue(summary)

            HStack(spacing: Spacing.s4) {
                legend(color: Colors.chartTypical, text: "Typical")
                legend(color: Colors.chartTonight, text: "Tonight")
            }
            .font(.crowdedCaption)
            .foregroundStyle(Colors.text2)
        }
    }

    private func legend(color: Color, text: String) -> some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 2).fill(color).frame(width: 12, height: 12)
            Text(text)
        }
    }

    private var summary: String {
        let parts: [String] = points.compactMap { point in
            guard let typical = point.typicalWaitMin else { return nil }
            if let tonight = point.tonightWaitMin {
                return "\(point.label): typical \(typical) min, tonight \(tonight) min"
            }
            return "\(point.label): typical \(typical) min"
        }
        return parts.joined(separator: ". ")
    }
}

#Preview("WaitByHourChart") {
    WaitByHourChart(points: PreviewData.hours)
        .padding()
        .crowdedScreen()
}

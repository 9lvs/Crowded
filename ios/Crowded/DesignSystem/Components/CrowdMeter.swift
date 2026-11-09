import SwiftUI

/// 3 segment meter plus a text label. Crowd level is never shown by color alone.
struct CrowdMeter: View {
    let level: CrowdLevel?
    var showLabel: Bool = true

    var body: some View {
        HStack(spacing: Spacing.s2) {
            HStack(spacing: 3) {
                ForEach(0..<3, id: \.self) { index in
                    RoundedRectangle(cornerRadius: 1)
                        .fill(index < (level?.filledSegments ?? 0) ? Colors.meterOn : Colors.meterOff)
                        .frame(width: 16, height: 4)
                }
            }
            .accessibilityHidden(true)
            if showLabel {
                Text(level?.label ?? "Crowd unknown")
                    .font(.crowdedBodyStrong)
                    .foregroundStyle(level == nil ? Colors.text3 : Colors.text)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(level.map { "Crowd: \($0.label)" } ?? "Crowd unknown")
    }
}

#Preview("CrowdMeter") {
    VStack(alignment: .leading, spacing: 12) {
        CrowdMeter(level: .easy)
        CrowdMeter(level: .busy)
        CrowdMeter(level: .packed)
        CrowdMeter(level: nil)
    }
    .padding()
    .crowdedScreen()
}

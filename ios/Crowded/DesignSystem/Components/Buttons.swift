import SwiftUI

/// Solid black (light) or white (dark) button. One per screen at most.
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.crowdedButton)
            .frame(maxWidth: .infinity, minHeight: Spacing.touch)
            .padding(.horizontal, Spacing.s4)
            .foregroundStyle(Colors.primaryInk)
            .background(
                RoundedRectangle(cornerRadius: Radius.md)
                    .fill(Colors.primary)
                    .opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.35)
            )
            .contentShape(Rectangle())
    }
}

/// Outlined button for the second action.
struct SecondaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.crowdedButton)
            .frame(maxWidth: .infinity, minHeight: Spacing.touch)
            .padding(.horizontal, Spacing.s4)
            .foregroundStyle(Colors.text)
            .background(
                RoundedRectangle(cornerRadius: Radius.md)
                    .stroke(Colors.borderStrong, lineWidth: 1.5)
            )
            .opacity(isEnabled ? (configuration.isPressed ? 0.7 : 1) : 0.35)
            .contentShape(Rectangle())
    }
}

/// Small grey button used inside list rows ("Report").
struct ChipButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.crowdedLabel)
            .padding(.horizontal, Spacing.s4)
            .frame(minWidth: Spacing.touch, minHeight: 44)
            .foregroundStyle(Colors.text)
            .background(
                RoundedRectangle(cornerRadius: Radius.md)
                    .fill(Colors.surface)
                    .opacity(configuration.isPressed ? 0.7 : 1)
            )
            .contentShape(Rectangle())
    }
}

struct PrimaryButton: View {
    let title: String
    var isBusy: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            if isBusy {
                ProgressView().tint(Colors.primaryInk)
            } else {
                Text(title)
            }
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(isBusy)
    }
}

struct SecondaryButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(title, action: action)
            .buttonStyle(SecondaryButtonStyle())
    }
}

#Preview("Buttons") {
    VStack(spacing: 12) {
        PrimaryButton(title: "Report crowd") {}
        PrimaryButton(title: "Saving", isBusy: true) {}
        SecondaryButton(title: "I'm in line") {}
        Button("Report") {}.buttonStyle(ChipButtonStyle())
    }
    .padding()
    .crowdedScreen()
}

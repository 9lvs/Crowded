import SwiftUI

/// Solid black (light) or white (dark) button. One per screen at most.
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    var haptic: PressHaptic

    init(haptic: PressHaptic = .light) {
        self.haptic = haptic
    }

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.crowdedButton)
            .frame(maxWidth: .infinity, minHeight: Spacing.touch)
            .padding(.horizontal, Spacing.s4)
            .foregroundStyle(Colors.primaryInk)
            .background(
                RoundedRectangle(cornerRadius: Radius.md)
                    .fill(Colors.primary)
                    .opacity(isEnabled ? 1 : 0.35)
            )
            .contentShape(Rectangle())
            .modifier(PressEffect(isPressed: configuration.isPressed, haptic: haptic))
    }
}

/// Outlined button for the second action.
struct SecondaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    var haptic: PressHaptic
    var scale: CGFloat

    init(haptic: PressHaptic = .light, scale: CGFloat = 0.97) {
        self.haptic = haptic
        self.scale = scale
    }

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
            .opacity(isEnabled ? 1 : 0.35)
            .contentShape(Rectangle())
            .modifier(PressEffect(isPressed: configuration.isPressed, scale: scale, haptic: haptic))
    }
}

/// Small grey button used inside list rows ("Report").
struct ChipButtonStyle: ButtonStyle {
    var haptic: PressHaptic

    init(haptic: PressHaptic = .selection) {
        self.haptic = haptic
    }

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.crowdedLabel)
            .padding(.horizontal, Spacing.s4)
            .frame(minWidth: Spacing.touch, minHeight: 44)
            .foregroundStyle(Colors.text)
            .background(
                RoundedRectangle(cornerRadius: Radius.md)
                    .fill(Colors.surface)
            )
            .contentShape(Rectangle())
            .modifier(PressEffect(isPressed: configuration.isPressed, haptic: haptic))
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

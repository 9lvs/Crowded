import SwiftUI

/// Which haptic a control plays when it is pressed down.
enum PressHaptic {
    case none
    case light
    case medium
    case selection

    var feedback: SensoryFeedback? {
        switch self {
        case .none: return nil
        case .light: return SensoryFeedback.impact(weight: .light)
        case .medium: return SensoryFeedback.impact(weight: .medium)
        case .selection: return SensoryFeedback.selection
        }
    }
}

/// The one press animation for every tappable control: scale and fade over Motion.press.
/// With Reduce Motion on there is no scale, only the opacity change.
struct PressEffect: ViewModifier {
    let isPressed: Bool
    var scale: CGFloat = 0.97
    var haptic: PressHaptic = .none
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .scaleEffect(isPressed && !reduceMotion ? scale : 1)
            .opacity(isPressed ? 0.9 : 1)
            .animation(Motion.pressAnimation, value: isPressed)
            .sensoryFeedback(trigger: isPressed) { _, pressed in
                pressed ? haptic.feedback : nil
            }
    }
}

/// Plain tactile style for rows, toggles and icon buttons. Primary, secondary and chip styles
/// apply the same `PressEffect`, so all controls feel alike.
struct PressableStyle: ButtonStyle {
    var scale: CGFloat = 0.97
    var haptic: PressHaptic = .none

    init(scale: CGFloat = 0.97, haptic: PressHaptic = .none) {
        self.scale = scale
        self.haptic = haptic
    }

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .modifier(PressEffect(isPressed: configuration.isPressed, scale: scale, haptic: haptic))
    }
}

import SwiftUI

struct OnboardingView: View {
    @State private var vm: OnboardingViewModel
    var subtitle: String = "Live waits and crowd levels at bars downtown, reported by people in line right now."
    var wordmarkSuffix: String? = nil

    init(api: CrowdedAPI, subtitle: String? = nil, wordmarkSuffix: String? = nil, onSignedIn: @escaping @MainActor (Me) -> Void) {
        _vm = State(initialValue: OnboardingViewModel(api: api, onSignedIn: onSignedIn))
        if let subtitle {
            self.subtitle = subtitle
        }
        self.wordmarkSuffix = wordmarkSuffix
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.s6) {
                Wordmark(suffix: wordmarkSuffix)
                    .padding(.top, Spacing.s8)
                switch vm.step {
                case .phone:
                    phoneStep
                case .code:
                    codeStep
                }
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.bottom, Spacing.s10)
        }
        .scrollDismissesKeyboard(.interactively)
        .crowdedScreen()
    }

    private var phoneStep: some View {
        @Bindable var vm = vm
        return VStack(alignment: .leading, spacing: Spacing.s5) {
            Text("Know the line before you go.")
                .font(.custom(CrowdedFont.bold, size: 40, relativeTo: .largeTitle))
                .fixedSize(horizontal: false, vertical: true)
            Text(subtitle)
                .font(.crowdedBody)
                .foregroundStyle(Colors.text2)
                .fixedSize(horizontal: false, vertical: true)

            Button {
                vm.ageAttested.toggle()
            } label: {
                HStack(alignment: .top, spacing: Spacing.s3) {
                    Image(systemName: vm.ageAttested ? "checkmark.square.fill" : "square")
                        .font(.system(size: 24))
                    VStack(alignment: .leading, spacing: 2) {
                        Text("I'm 21 or older")
                            .font(.crowdedBodyStrong)
                        Text("Crowded is for bars. We only save that you confirmed, never your birthday.")
                            .font(.crowdedSmall)
                            .foregroundStyle(Colors.text2)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                }
                .padding(Spacing.s4)
                .frame(minHeight: Spacing.touch)
                .background(RoundedRectangle(cornerRadius: Radius.md).stroke(Colors.border, lineWidth: 1))
                .contentShape(Rectangle())
            }
            .buttonStyle(PressableStyle(haptic: .selection))
            .accessibilityIdentifier("ageToggle")
            .accessibilityLabel("I'm 21 or older")
            .accessibilityAddTraits(vm.ageAttested ? [.isSelected] : [])

            VStack(alignment: .leading, spacing: Spacing.s2) {
                Text("Phone number")
                    .font(.crowdedLabel)
                TextField("(555) 123 4567", text: $vm.phone)
                    .keyboardType(.phonePad)
                    .textContentType(.telephoneNumber)
                    .font(.crowdedBody)
                    .padding(.horizontal, Spacing.s4)
                    .frame(minHeight: Spacing.touch)
                    .background(RoundedRectangle(cornerRadius: Radius.md).fill(Colors.surface))
                    .accessibilityIdentifier("phoneField")
                    .accessibilityLabel("Phone number")
            }

            if let error = vm.errorMessage {
                Text(error)
                    .font(.crowdedSmall)
                    .accessibilityIdentifier("onboardingError")
            }

            PrimaryButton(title: "Continue", isBusy: vm.isBusy) {
                Task { await vm.requestCode() }
            }
            .disabled(!vm.canRequestCode)
            .accessibilityIdentifier("continueButton")

            Text("We text you a 6 digit code. Message rates may apply.")
                .font(.crowdedCaption)
                .foregroundStyle(Colors.text2)

            if AppModel.signInWithAppleEnabled {
                // Sign in with Apple needs the Apple Developer account (docs/IOS.md). The button
                // is wired up in a later build once the capability exists.
                Text("Sign in with Apple coming soon")
                    .font(.crowdedCaption)
                    .foregroundStyle(Colors.text3)
            }
        }
    }

    private var codeStep: some View {
        @Bindable var vm = vm
        return VStack(alignment: .leading, spacing: Spacing.s5) {
            Button {
                vm.back()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 18, weight: .semibold))
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(PressableStyle())
            .accessibilityLabel("Back")

            Text("Enter your code")
                .font(.crowdedTitle)
            Text("Sent to \(vm.normalizedPhone ?? vm.phone)")
                .font(.crowdedBody)
                .foregroundStyle(Colors.text2)

            TextField("6 digit code", text: $vm.code)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .font(.crowdedNumber(CrowdedFont.xl))
                .monospacedDigit()
                .padding(.horizontal, Spacing.s4)
                .frame(minHeight: 56)
                .background(RoundedRectangle(cornerRadius: Radius.md).fill(Colors.surface))
                .accessibilityIdentifier("codeField")
                .accessibilityLabel("6 digit code")

            if let dev = vm.devCode {
                Button("Dev code: \(dev). Tap to fill") {
                    vm.useDevCode()
                }
                .buttonStyle(PressableStyle(haptic: .selection))
                .font(.crowdedSmall)
                .foregroundStyle(Colors.text2)
                .frame(minHeight: 44)
                .accessibilityIdentifier("useDevCode")
            }

            if let error = vm.errorMessage {
                Text(error)
                    .font(.crowdedSmall)
                    .accessibilityIdentifier("onboardingError")
            }

            PrimaryButton(title: "Verify", isBusy: vm.isBusy) {
                Task { await vm.verify() }
            }
            .disabled(!vm.canVerify)
            .accessibilityIdentifier("verifyButton")
        }
    }
}

#Preview("Onboarding") {
    OnboardingView(api: MockAPI()) { _ in }
}

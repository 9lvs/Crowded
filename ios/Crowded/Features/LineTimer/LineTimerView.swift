import SwiftUI

struct LineTimerView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var vm: LineTimerViewModel

    init(api: CrowdedAPI, session: LineSession) {
        _vm = State(initialValue: LineTimerViewModel(api: api, session: session))
    }

    var body: some View {
        VStack(spacing: Spacing.s6) {
            HStack {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "chevron.down")
                        .font(.system(size: 18, weight: .semibold))
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Minimize timer")
                Spacer()
            }
            if vm.finished == nil {
                running
            } else {
                result
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Spacing.gutter)
        .padding(.top, Spacing.s2)
        .crowdedScreen()
        .onAppear { vm.startTicking() }
        .onDisappear { vm.stopTicking() }
    }

    private var running: some View {
        VStack(spacing: Spacing.s6) {
            VStack(spacing: Spacing.s1) {
                Text("You're in line")
                    .font(.crowdedSmall)
                    .foregroundStyle(Colors.text2)
                Text(barName)
                    .font(.crowdedSection)
                    .multilineTextAlignment(.center)
            }
            TimerRing(elapsed: vm.elapsed, predictedMinutes: vm.session.predictedWaitMin)
            if let error = vm.errorMessage {
                Text(error).font(.crowdedSmall)
            }
            VStack(spacing: Spacing.s3) {
                PrimaryButton(title: "I'm inside", isBusy: vm.isSaving) {
                    Task {
                        await vm.end(.inside)
                        if vm.finished != nil {
                            app.sessionEnded()
                        }
                    }
                }
                .accessibilityIdentifier("imInsideButton")
                SecondaryButton(title: "Left the line") {
                    Task {
                        await vm.end(.gaveUp)
                        if vm.finished != nil {
                            app.sessionEnded()
                        }
                    }
                }
                .disabled(vm.isSaving)
                .accessibilityIdentifier("leftLineButton")
            }
            Text("Tap I'm inside the moment you get in. Your time sharpens the estimate for everyone.")
                .font(.crowdedCaption)
                .foregroundStyle(Colors.text2)
                .multilineTextAlignment(.center)
        }
    }

    private var result: some View {
        VStack(spacing: Spacing.s4) {
            Image(systemName: vm.resultKind == .leftLine ? "xmark" : "checkmark")
                .font(.system(size: 28, weight: .bold))
                .frame(width: 72, height: 72)
                .foregroundStyle(Colors.primaryInk)
                .background(Circle().fill(Colors.primary))
                .accessibilityHidden(true)
            Text(vm.resultTitle)
                .font(.crowdedTitle)
                .accessibilityIdentifier("resultTitle")
            if vm.resultKind != .tooQuick {
                Text(vm.resultKind == .inside ? "You waited" : "You were in line for")
                    .font(.crowdedBody)
                    .foregroundStyle(Colors.text2)
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text("\(vm.resultMinutes)")
                        .font(.crowdedNumber(CrowdedFont.giant))
                        .monospacedDigit()
                    Text("min")
                        .font(.crowdedBody)
                        .foregroundStyle(Colors.text2)
                }
            }
            if let points = vm.finished?.pointsAwarded, points > 0 {
                Text("+\(points) points")
                    .font(.crowdedBodyStrong)
            }
            Text(vm.resultNote)
                .font(.crowdedSmall)
                .foregroundStyle(Colors.text2)
                .multilineTextAlignment(.center)
            PrimaryButton(title: "Done") {
                dismiss()
            }
            .accessibilityIdentifier("resultDone")
        }
        .padding(.top, Spacing.s8)
    }

    private var barName: String {
        return app.activeBarName ?? "the bar"
    }
}

#Preview("Line timer") {
    let model = AppModel(api: MockAPI(signedIn: true), location: FixedLocation(), isMock: true)
    let session = LineSession(
        id: "fake", barId: "00000000-0000-4000-8000-000000000001", status: .active,
        startedAt: Date().addingTimeInterval(-420), endedAt: nil, predictedWaitMin: 25,
        actualWaitMin: nil, nearBar: true, pointsAwarded: 0
    )
    return LineTimerView(api: model.api, session: session)
        .environment(model)
}

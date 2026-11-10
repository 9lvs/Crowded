import SwiftUI

/// Two tap crowd report. Location is read once on Send, then reduced to "near the bar" by the
/// server and discarded.
struct ReportSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var vm: ReportViewModel

    init(api: CrowdedAPI, barId: String, barName: String) {
        _vm = State(initialValue: ReportViewModel(api: api, barId: barId, barName: barName))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                if vm.result != nil {
                    thanks
                } else {
                    form
                }
            }
            .crowdedScreen()
            .navigationTitle(vm.barName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
        .presentationDetents([.large])
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: Spacing.s6) {
            Text("How is it right now?")
                .font(.crowdedSection)
                .padding(.top, Spacing.s4)

            VStack(alignment: .leading, spacing: Spacing.s3) {
                Text("Inside")
                    .font(.crowdedLabel)
                    .foregroundStyle(Colors.text2)
                HStack(spacing: Spacing.s2) {
                    ForEach(CrowdLevel.allCases) { level in
                        OptionButton(
                            title: level.label,
                            subtitle: level.detail,
                            isSelected: vm.crowd == level
                        ) {
                            vm.crowd = (vm.crowd == level) ? nil : level
                        }
                        .accessibilityIdentifier("crowd-\(level.rawValue)")
                    }
                }
            }

            VStack(alignment: .leading, spacing: Spacing.s3) {
                Text("Line outside")
                    .font(.crowdedLabel)
                    .foregroundStyle(Colors.text2)
                LazyVGrid(
                    columns: [GridItem(.flexible(), spacing: Spacing.s2), GridItem(.flexible(), spacing: Spacing.s2), GridItem(.flexible(), spacing: Spacing.s2)],
                    spacing: Spacing.s2
                ) {
                    ForEach(LineSize.allCases) { size in
                        OptionButton(
                            title: size.label,
                            subtitle: size.range,
                            isSelected: vm.line == size
                        ) {
                            vm.line = (vm.line == size) ? nil : size
                        }
                        .accessibilityIdentifier("line-\(size.rawValue)")
                    }
                }
            }

            VStack(alignment: .leading, spacing: Spacing.s3) {
                Text("How long for a drink?")
                    .font(.crowdedLabel)
                    .foregroundStyle(Colors.text2)
                LazyVGrid(
                    columns: [GridItem(.flexible(), spacing: Spacing.s2), GridItem(.flexible(), spacing: Spacing.s2)],
                    spacing: Spacing.s2
                ) {
                    ForEach(DrinkWait.allCases) { wait in
                        OptionButton(
                            title: wait.label,
                            isSelected: vm.drinkWait == wait
                        ) {
                            vm.drinkWait = (vm.drinkWait == wait) ? nil : wait
                        }
                        .accessibilityLabel(wait.fullLabel)
                        .accessibilityIdentifier("drink-\(wait.rawValue)")
                    }
                }
            }

            if let error = vm.errorMessage {
                Text(error).font(.crowdedSmall)
            }

            PrimaryButton(title: "Send report", isBusy: vm.isSending) {
                Task { await vm.send(location: app.location) }
            }
            .disabled(!vm.canSend)
            .accessibilityIdentifier("sendReport")

            Text("We check once if you're near the bar. Your location is never stored.")
                .font(.crowdedCaption)
                .foregroundStyle(Colors.text2)
        }
        .padding(.horizontal, Spacing.gutter)
    }

    private var thanks: some View {
        VStack(spacing: Spacing.s4) {
            Image(systemName: "checkmark")
                .font(.system(size: 28, weight: .bold))
                .frame(width: 72, height: 72)
                .foregroundStyle(Colors.primaryInk)
                .background(Circle().fill(Colors.primary))
                .accessibilityHidden(true)
            Text("Report sent")
                .font(.crowdedTitle)
            Text(vm.thanksText)
                .font(.crowdedBody)
                .foregroundStyle(Colors.text2)
                .multilineTextAlignment(.center)
            PrimaryButton(title: "Done") { dismiss() }
                .accessibilityIdentifier("reportDone")
        }
        .padding(Spacing.gutter)
        .padding(.top, Spacing.s10)
        .accessibilityElement(children: .contain)
    }
}

/// Selectable option tile used in the report sheet and the staff line picker.
struct OptionButton: View {
    let title: String
    var subtitle: String? = nil
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 2) {
                Text(title)
                    .font(.crowdedButton)
                if let subtitle {
                    Text(subtitle)
                        .font(.crowdedCaption)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .opacity(0.8)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 56)
            .padding(.horizontal, Spacing.s1)
            .foregroundStyle(isSelected ? Colors.primaryInk : Colors.text)
            .background(
                RoundedRectangle(cornerRadius: Radius.md)
                    .fill(isSelected ? Colors.primary : Colors.surface)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }
}

#Preview("Report") {
    let model = AppModel(api: MockAPI(signedIn: true), location: FixedLocation(), isMock: true)
    return ReportSheet(api: model.api, barId: "00000000-0000-4000-8000-000000000001", barName: "FAKE The Tipsy Owl")
        .environment(model)
}

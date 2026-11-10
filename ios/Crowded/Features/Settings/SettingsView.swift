import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var app
    @State private var vm: SettingsViewModel
    @State private var confirmDelete = false

    init(api: CrowdedAPI, threshold: Int) {
        _vm = State(initialValue: SettingsViewModel(api: api, currentThreshold: threshold))
    }

    var body: some View {
        @Bindable var vm = vm
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.s6) {
                Text("Settings")
                    .font(.crowdedTitle)
                    .padding(.top, Spacing.s6)
                    .accessibilityAddTraits(.isHeader)

                section("Line skip pass") {
                    Text(vm.thresholdText)
                        .font(.crowdedBodyStrong)
                    Slider(value: $vm.threshold, in: 5...120, step: 5, onEditingChanged: { editing in
                        if !editing {
                            Task {
                                if let me = await vm.saveThreshold() {
                                    app.me = me
                                    app.showToast("Saved")
                                }
                            }
                        }
                    })
                    .accessibilityLabel("Pass suggestion limit")
                    .accessibilityValue("\(vm.thresholdMinutes) minutes")
                    .accessibilityIdentifier("thresholdSlider")
                    Text("Crowded suggests a line skip pass only when the wait is over your limit.")
                        .font(.crowdedCaption)
                        .foregroundStyle(Colors.text2)
                }

                section("Appearance") {
                    Picker("Theme", selection: Binding(
                        get: { app.theme },
                        set: { app.setTheme($0) }
                    )) {
                        ForEach(ThemePreference.allCases) { option in
                            Text(option.label).tag(option)
                        }
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("themePicker")
                }

                section("Privacy") {
                    Text("We never store your location. Only whether you were near the bar when you reported.")
                        .font(.crowdedSmall)
                        .foregroundStyle(Colors.text2)
                    if let hint = app.me?.phoneHint {
                        Text("Signed in with the phone \(hint)")
                            .font(.crowdedSmall)
                            .foregroundStyle(Colors.text2)
                    }
                }

                if let error = vm.errorMessage {
                    Text(error).font(.crowdedSmall)
                }

                VStack(spacing: Spacing.s3) {
                    SecondaryButton(title: "Sign out") {
                        Task { await app.signOut() }
                    }
                    .accessibilityIdentifier("signOutButton")
                    Button {
                        confirmDelete = true
                    } label: {
                        Text("Delete account")
                            .font(.crowdedButton)
                            .frame(maxWidth: .infinity, minHeight: Spacing.touch)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("deleteAccountButton")
                }

                #if DEBUG
                NavigationLink("Component gallery") {
                    ComponentGallery()
                }
                .font(.crowdedSmall)
                .foregroundStyle(Colors.text2)
                #endif

                if app.isMock {
                    Text("Demo mode. Every bar and number here is fake.")
                        .font(.crowdedCaption)
                        .foregroundStyle(Colors.text3)
                }
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.bottom, Spacing.s10)
        }
        .crowdedScreen()
        .toolbar(.hidden, for: .navigationBar)
        .confirmationDialog(
            "Delete your account?",
            isPresented: $confirmDelete,
            titleVisibility: .visible
        ) {
            Button("Delete everything", role: .destructive) {
                Task {
                    if await vm.deleteAccount() {
                        app.resetToSignedOut()
                    }
                }
            }
            .accessibilityIdentifier("confirmDeleteButton")
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This permanently deletes your account, reports, line timers and points. It cannot be undone.")
        }
    }

    @ViewBuilder
    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: Spacing.s3) {
            Text(title)
                .font(.crowdedSection)
            content()
        }
        .padding(.bottom, Spacing.s4)
        .hairlineBottom()
    }
}

#Preview("Settings") {
    let model = AppModel(api: MockAPI(signedIn: true), location: FixedLocation(), isMock: true)
    return NavigationStack {
        SettingsView(api: model.api, threshold: 20)
    }
    .environment(model)
}

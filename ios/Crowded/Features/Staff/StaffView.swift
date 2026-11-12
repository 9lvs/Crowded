import SwiftUI
import UIKit

/// Staff experience: redeem the bar's invite, then count the door. The web staff page at
/// /staff.html does the same job for door staff who do not install the app.
struct StaffView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.scenePhase) private var scenePhase
    @State private var vm: StaffViewModel
    @State private var showSync = false

    init(api: CrowdedAPI) {
        _vm = State(initialValue: StaffViewModel(api: api))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.s6) {
                Wordmark(suffix: "for staff")
                    .padding(.top, Spacing.s6)
                if let barId = app.me?.staffBarId {
                    counter(barId: barId)
                } else {
                    invite
                }
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.bottom, Spacing.s10)
        }
        .crowdedScreen()
        .toolbar(.hidden, for: .navigationBar)
        .task {
            if let barId = app.me?.staffBarId {
                await vm.load(barId: barId)
                vm.startPolling(barId: barId)
            }
        }
        .task(id: app.me?.staffBarId) {
            guard let barId = app.me?.staffBarId else { return }
            await vm.loadSamples(barId: barId)
            while !Task.isCancelled {
                if vm.evaluateReminders() {
                    UINotificationFeedbackGenerator().notificationOccurred(.warning)
                }
                try? await Task.sleep(nanoseconds: 1_000_000_000)
            }
        }
        .onAppear {
            vm.staffLevel = app.me?.isManager == true ? .manager : .door
            vm.doorOpened()
            // The door stays awake while this tab is visible.
            UIApplication.shared.isIdleTimerDisabled = true
        }
        .onDisappear {
            vm.stopPolling()
            UIApplication.shared.isIdleTimerDisabled = false
        }
        .sheet(isPresented: $showSync) {
            if let barId = app.me?.staffBarId {
                CountSyncSheet(currentCount: vm.displayedHeadcount) { total in
                    await vm.syncCount(barId: barId, insideNow: total)
                }
                .presentationDetents([.medium])
            }
        }
        .onChange(of: app.me?.staffLevel) { _, _ in
            vm.staffLevel = app.me?.isManager == true ? .manager : .door
        }
        .onChange(of: scenePhase) { _, phase in
            guard let barId = app.me?.staffBarId else { return }
            if phase == .active {
                vm.startPolling(barId: barId)
            } else {
                vm.stopPolling()
            }
        }
    }

    private var invite: some View {
        @Bindable var vm = vm
        return VStack(alignment: .leading, spacing: Spacing.s4) {
            Text("Enter your invite code")
                .font(.crowdedTitle)
            Text("Your manager gets a code from Crowded. It links your account to your bar.")
                .font(.crowdedBody)
                .foregroundStyle(Colors.text2)
            TextField("ABCDE-FGHJK", text: $vm.inviteCode)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .font(.crowdedNumber(CrowdedFont.xl))
                .padding(.horizontal, Spacing.s4)
                .frame(minHeight: 56)
                .background(RoundedRectangle(cornerRadius: Radius.md).fill(Colors.surface))
                .accessibilityLabel("Invite code")
            if let error = vm.errorMessage {
                Text(error).font(.crowdedSmall)
            }
            PrimaryButton(title: "Join bar", isBusy: vm.isRedeeming) {
                Task {
                    if let me = await vm.redeem() {
                        app.me = me
                        if let barId = me.staffBarId {
                            await vm.load(barId: barId)
                            vm.startPolling(barId: barId)
                        }
                    }
                }
            }
            .disabled(!vm.canRedeem)
        }
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text)
            .font(.crowdedSection)
            .accessibilityAddTraits(.isHeader)
    }

    /// Managers only: the specials editor, the exit counting switch and tonight's numbers.
    private func manage(barId: String, state: StaffState) -> some View {
        VStack(alignment: .leading, spacing: Spacing.s4) {
            sectionTitle("Manage")

            NavigationLink {
                StaffSpecialsView(api: app.api, barId: barId)
            } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Specials")
                            .font(.crowdedBodyStrong)
                        Text("Happy hours, cover, food and events")
                            .font(.crowdedSmall)
                            .foregroundStyle(Colors.text2)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .accessibilityHidden(true)
                }
                .frame(minHeight: Spacing.touch)
                .contentShape(Rectangle())
            }
            .buttonStyle(PressableStyle())
            .accessibilityIdentifier("staffSpecialsLink")

            Toggle(isOn: countsExitsBinding(barId: barId)) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Count exits too")
                        .font(.crowdedBodyStrong)
                    Text("Off means door staff only count people in.")
                        .font(.crowdedSmall)
                        .foregroundStyle(Colors.text2)
                }
            }
            .tint(Colors.primary)
            .frame(minHeight: Spacing.touch)
            .accessibilityIdentifier("countsExitsToggle")

            VStack(alignment: .leading, spacing: Spacing.s2) {
                Text("Tonight so far")
                    .font(.crowdedLabel)
                    .foregroundStyle(Colors.text2)
                statRow("Entries", "\(vm.displayedEntries)")
                if vm.countsExits {
                    statRow("Exits", "\(state.exitsTonight)")
                    statRow("Inside now", "\(vm.displayedHeadcount) of \(state.capacity)")
                }
                statRow("Line outside", lineText(state.lineSize))
                statRow("Busy inside", state.inside?.crowdLevel?.label ?? "Not reported")
                statRow("Drink wait", state.inside?.drinkWait?.fullLabel ?? "Not reported")
            }
            .accessibilityIdentifier("tonightSoFar")
        }
    }

    private func countsExitsBinding(barId: String) -> Binding<Bool> {
        return Binding<Bool>(
            get: { vm.countsExits },
            set: { value in
                Task { await vm.setCountsExits(barId: barId, value: value) }
            }
        )
    }

    private func lineText(_ size: LineSize?) -> String {
        guard let size else { return "Not reported" }
        return "\(size.label), \(size.range)"
    }

    private func statRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
                .font(.crowdedBody)
                .foregroundStyle(Colors.text2)
            Spacer()
            Text(value)
                .font(.crowdedBodyStrong)
        }
        .frame(minHeight: Spacing.touch)
        .hairlineBottom()
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func counter(barId: String) -> some View {
        if let state = vm.state {
            VStack(alignment: .leading, spacing: Spacing.s6) {
                Text(state.barName)
                    .font(.crowdedSection)

                sectionTitle("Door")
                DoorCounterSection(vm: vm, barId: barId, state: state) {
                    showSync = true
                }

                if let error = vm.errorMessage {
                    Text(error).font(.crowdedSmall)
                }

                VStack(alignment: .leading, spacing: Spacing.s3) {
                    sectionTitle("Line")
                    Text("Outside line")
                        .font(.crowdedLabel)
                        .foregroundStyle(Colors.text2)
                    LazyVGrid(
                        columns: [GridItem(.flexible(), spacing: Spacing.s2), GridItem(.flexible(), spacing: Spacing.s2), GridItem(.flexible(), spacing: Spacing.s2)],
                        spacing: Spacing.s2
                    ) {
                        ForEach(LineSize.allCases) { size in
                            OptionButton(title: size.label, subtitle: size.range, isSelected: state.lineSize == size) {
                                Task { await vm.setLine(barId: barId, size: size) }
                            }
                        }
                    }
                    if let updated = state.lineUpdatedAt {
                        Text("Updated \(updated.formatted(date: .omitted, time: .shortened))")
                            .font(.crowdedCaption)
                            .foregroundStyle(Colors.text2)
                    }
                }

                LineSamplePanel(vm: vm, barId: barId)

                VStack(alignment: .leading, spacing: Spacing.s3) {
                    sectionTitle("Inside")
                    InsidePanel(vm: vm, barId: barId, state: state)
                }

                if vm.canManage {
                    manage(barId: barId, state: state)
                }

                VStack(alignment: .leading, spacing: Spacing.s3) {
                    Text("What students see")
                        .font(.crowdedSection)
                    HStack {
                        CrowdMeter(level: state.live.crowdLevel)
                        Spacer()
                        WaitStat(live: state.live)
                    }
                    BasisLine(live: state.live)
                }
            }
        } else if let error = vm.errorMessage {
            Text(error).font(.crowdedBody)
        } else {
            ProgressView().frame(maxWidth: .infinity)
        }
    }
}

#Preview("Staff counter") {
    let model = AppModel(api: MockAPI(signedIn: true, role: .staff), location: FixedLocation(), isMock: true)
    model.me = Me(id: "fake", role: .staff, waitThresholdMin: 20, staffBarId: "00000000-0000-4000-8000-000000000001", phoneHint: nil, staffLevel: .manager)
    return NavigationStack { StaffView(api: model.api) }
        .environment(model)
}

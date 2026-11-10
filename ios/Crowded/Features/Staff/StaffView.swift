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
                await vm.refreshDoorCodeIfNeeded(barId: barId)
                if vm.evaluateReminders() {
                    UINotificationFeedbackGenerator().notificationOccurred(.warning)
                }
                try? await Task.sleep(nanoseconds: 1_000_000_000)
            }
        }
        .onAppear {
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

    @ViewBuilder
    private func counter(barId: String) -> some View {
        if let state = vm.state {
            VStack(alignment: .leading, spacing: Spacing.s6) {
                Text(state.barName)
                    .font(.crowdedSection)

                DoorCounterSection(vm: vm, barId: barId, state: state) {
                    showSync = true
                }

                if let error = vm.errorMessage {
                    Text(error).font(.crowdedSmall)
                }

                VStack(alignment: .leading, spacing: Spacing.s3) {
                    Text("Outside line")
                        .font(.crowdedSection)
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

                DoorCodePanel(vm: vm)

                NavigationLink {
                    StaffSpecialsView(api: app.api, barId: barId)
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Specials")
                                .font(.crowdedSection)
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
                .buttonStyle(.plain)
                .accessibilityIdentifier("staffSpecialsLink")

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
    model.me = Me(id: "fake", role: .staff, waitThresholdMin: 20, staffBarId: "00000000-0000-4000-8000-000000000001", phoneHint: nil)
    return NavigationStack { StaffView(api: model.api) }
        .environment(model)
}

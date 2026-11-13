import SwiftUI

struct TonightView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.scenePhase) private var scenePhase
    @State private var vm: TonightViewModel

    init(api: CrowdedAPI) {
        _vm = State(initialValue: TonightViewModel(api: api))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header
                if app.me?.isStaff == true {
                    staffBanner
                }
                if vm.isLoading && vm.bars.isEmpty {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, Spacing.s10)
                }
                if let error = vm.errorMessage, vm.bars.isEmpty {
                    Text(error)
                        .font(.crowdedSmall)
                        .foregroundStyle(Colors.text2)
                        .padding(.vertical, Spacing.s4)
                }
                ForEach(vm.bars) { bar in
                    NavigationLink(value: bar.id) {
                        BarRow(bar: bar)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(PressableStyle())
                    .accessibilityIdentifier("barRow-\(bar.slug)")
                }
                if app.isMock {
                    Text("Demo mode. Every bar and number here is fake.")
                        .font(.crowdedCaption)
                        .foregroundStyle(Colors.text3)
                        .padding(.vertical, Spacing.s4)
                }
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.bottom, app.activeSession == nil ? Spacing.s6 : 96)
        }
        .refreshable { await vm.load() }
        .crowdedScreen()
        .toolbar(.hidden, for: .navigationBar)
        .navigationDestination(for: String.self) { barId in
            BarDetailView(api: app.api, barId: barId)
        }
        .overlay(alignment: .bottom) {
            if let session = app.activeSession {
                ActiveSessionBar(session: session, barName: barName(for: session.barId))
                    .padding(.horizontal, Spacing.gutter)
                    .padding(.bottom, Spacing.s3)
            }
        }
        .task {
            await vm.load()
            await app.refreshMe()
            await app.refreshSession()
            vm.startPolling()
        }
        .onDisappear { vm.stopPolling() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                vm.startPolling()
            } else {
                vm.stopPolling()
            }
        }
    }

    private func barName(for id: String) -> String {
        return vm.bars.first(where: { $0.id == id })?.name ?? app.activeBarName ?? "the bar"
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: Spacing.s1) {
            Text("Tonight")
                .font(.crowdedTitle)
                .accessibilityAddTraits(.isHeader)
            Text(Date.now.formatted(.dateTime.weekday(.wide).month(.abbreviated).day()))
                .font(.crowdedSmall)
                .foregroundStyle(Colors.text2)
        }
        .padding(.top, Spacing.s6)
        .padding(.bottom, Spacing.s3)
        .frame(maxWidth: .infinity, alignment: .leading)
        .hairlineBottom()
    }

    private var staffBanner: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("You're signed in as staff")
                    .font(.crowdedLabel)
                Text("Open the Door tab to count people in and out.")
                    .font(.crowdedCaption)
            }
            Spacer()
            Image(systemName: "arrow.right")
        }
        .padding(Spacing.s4)
        .foregroundStyle(Colors.primaryInk)
        .background(RoundedRectangle(cornerRadius: Radius.md).fill(Colors.primary))
        .padding(.vertical, Spacing.s3)
        .accessibilityElement(children: .combine)
    }
}

#Preview("Tonight") {
    let model = AppModel(api: MockAPI(signedIn: true), location: FixedLocation(), isMock: true)
    return NavigationStack {
        TonightView(api: model.api)
    }
    .environment(model)
}

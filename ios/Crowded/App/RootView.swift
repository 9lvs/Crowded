import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        ZStack(alignment: .top) {
            switch app.phase {
            case .loading:
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .crowdedScreen()
            case .signedOut:
                OnboardingView(api: app.api) { me in
                    app.didSignIn(me)
                }
            case .signedIn:
                MainTabs()
            }
            if let toast = app.toast {
                Text(toast)
                    .font(.crowdedLabel)
                    .foregroundStyle(Colors.primaryInk)
                    .padding(.horizontal, Spacing.s4)
                    .padding(.vertical, Spacing.s3)
                    .background(Capsule().fill(Colors.primary))
                    .padding(.top, Spacing.s2)
                    .accessibilityAddTraits(.updatesFrequently)
                    .transition(.opacity)
            }
        }
        .task {
            if app.phase == .loading {
                await app.bootstrap()
            }
        }
    }
}

struct MainTabs: View {
    @Environment(AppModel.self) private var app
    @State private var selection: Tab = .tonight

    enum Tab: Hashable {
        case tonight
        case door
        case settings
    }

    var body: some View {
        @Bindable var app = app
        TabView(selection: $selection) {
            NavigationStack {
                TonightView(api: app.api)
            }
            .tabItem { Label("Tonight", systemImage: "list.bullet") }
            .tag(Tab.tonight)

            if app.me?.isStaff == true {
                NavigationStack {
                    StaffView(api: app.api)
                }
                .tabItem { Label("Door", systemImage: "person.2") }
                .tag(Tab.door)
            }

            NavigationStack {
                SettingsView(api: app.api, threshold: app.me?.waitThresholdMin ?? 20)
            }
            .tabItem { Label("Settings", systemImage: "gearshape") }
            .tag(Tab.settings)
        }
        .fullScreenCover(isPresented: $app.showTimer, onDismiss: { app.timerSession = nil }) {
            if let session = app.timerSession ?? app.activeSession {
                LineTimerView(api: app.api, session: session)
                    .environment(app)
            }
        }
    }
}

/// Bottom bar shown on Tonight while a line timer runs, so it is never forgotten.
struct ActiveSessionBar: View {
    @Environment(AppModel.self) private var app
    let session: LineSession
    let barName: String

    var body: some View {
        Button {
            app.openTimer()
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("In line at \(barName)")
                        .font(.crowdedLabel)
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        Text(Self.clock(context.date.timeIntervalSince(session.startedAt)))
                            .font(.crowdedNumber(CrowdedFont.lg))
                            .monospacedDigit()
                    }
                }
                Spacer()
                Text("I'm inside")
                    .font(.crowdedButton)
                    .padding(.horizontal, Spacing.s4)
                    .frame(minHeight: 44)
                    .background(RoundedRectangle(cornerRadius: Radius.md).fill(Colors.primaryInk))
                    .foregroundStyle(Colors.primary)
            }
            .padding(Spacing.s4)
            .foregroundStyle(Colors.primaryInk)
            .background(RoundedRectangle(cornerRadius: Radius.lg).fill(Colors.primary))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("activeSessionBar")
        .accessibilityLabel("In line at \(barName). Open timer")
    }

    static func clock(_ seconds: TimeInterval) -> String {
        let total = max(0, Int(seconds))
        return String(format: "%d:%02d", total / 60, total % 60)
    }
}

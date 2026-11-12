import SwiftUI

struct BarDetailView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.scenePhase) private var scenePhase
    @State private var vm: BarDetailViewModel
    @State private var showReport = false

    init(api: CrowdedAPI, barId: String) {
        _vm = State(initialValue: BarDetailViewModel(api: api, barId: barId))
    }

    var body: some View {
        ScrollView {
            if let detail = vm.detail {
                content(detail)
                    .padding(.horizontal, Spacing.gutter)
                    .padding(.bottom, Spacing.s6)
            } else if let error = vm.errorMessage {
                Text(error)
                    .font(.crowdedBody)
                    .padding(Spacing.gutter)
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(.top, Spacing.s10)
            }
        }
        .crowdedScreen()
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            if let detail = vm.detail {
                actions(detail)
            }
        }
        .sheet(isPresented: $showReport) {
            if let detail = vm.detail {
                ReportSheet(api: app.api, barId: detail.bar.id, barName: detail.bar.name)
                    .environment(app)
            }
        }
        .task {
            await vm.load()
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

    @ViewBuilder
    private func content(_ detail: BarDetail) -> some View {
        let bar = detail.bar
        VStack(alignment: .leading, spacing: Spacing.s5) {
            VStack(alignment: .leading, spacing: Spacing.s1) {
                Text(bar.name)
                    .font(.crowdedTitle)
                    .accessibilityAddTraits(.isHeader)
                Text(bar.address)
                    .font(.crowdedSmall)
                    .foregroundStyle(Colors.text2)
            }
            .padding(.top, Spacing.s2)

            // Crowd, line and drinks side by side, the core of the product.
            HStack(alignment: .top, spacing: 0) {
                VStack(alignment: .leading, spacing: Spacing.s2) {
                    Text("Crowd")
                        .font(.crowdedLabel)
                        .foregroundStyle(Colors.text2)
                    Text(bar.live.crowdLevel?.label ?? "Unknown")
                        .font(.crowdedNumber(CrowdedFont.xl))
                        .foregroundStyle(bar.live.crowdLevel == nil ? Colors.text3 : Colors.text)
                    CrowdMeter(level: bar.live.crowdLevel, showLabel: false)
                    if let headcount = bar.live.headcount {
                        Text("\(headcount) of \(bar.capacity) inside")
                            .font(.crowdedSmall)
                            .foregroundStyle(Colors.text2)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, Spacing.s4)

                Rectangle().fill(Colors.border).frame(width: 1)

                VStack(alignment: .leading, spacing: Spacing.s2) {
                    Text("Line")
                        .font(.crowdedLabel)
                        .foregroundStyle(Colors.text2)
                    if bar.live.hasRecentData, let wait = bar.live.waitMin {
                        HStack(alignment: .firstTextBaseline, spacing: 3) {
                            Text("\(wait)")
                                .font(.crowdedNumber(CrowdedFont.hero))
                                .monospacedDigit()
                            Text("min")
                                .font(.crowdedSmall)
                                .foregroundStyle(Colors.text2)
                        }
                        if let low = bar.live.waitLowMin, let high = bar.live.waitHighMin {
                            Text("\(low) to \(high) min")
                                .font(.crowdedSmall)
                                .foregroundStyle(Colors.text2)
                        }
                    } else {
                        Text("No recent data")
                            .font(.crowdedBodyStrong)
                            .foregroundStyle(Colors.text3)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, Spacing.s4)
                .padding(.leading, Spacing.s4)

                Rectangle().fill(Colors.border).frame(width: 1)

                VStack(alignment: .leading, spacing: Spacing.s2) {
                    Text("Drinks")
                        .font(.crowdedLabel)
                        .foregroundStyle(Colors.text2)
                    Text(bar.live.drinkText)
                        .font(.crowdedBodyStrong)
                        .foregroundStyle(bar.live.drinkWaitLabel == nil ? Colors.text3 : Colors.text)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("drinksStat")
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, Spacing.s4)
                .padding(.leading, Spacing.s4)
            }
            .overlay(alignment: .top) { Rectangle().fill(Colors.border).frame(height: 1) }
            .hairlineBottom()
            .accessibilityElement(children: .combine)

            BasisLine(live: bar.live)

            SpecialsSection(tonight: bar.specialsTonight, week: detail.specialsWeek)

            VStack(alignment: .leading, spacing: Spacing.s3) {
                Text("Wait by hour")
                    .font(.crowdedSection)
                WaitByHourChart(points: detail.waitByHour)
                row("Normal wait at this hour", value: detail.normalWaitMin.map { "\($0) min" } ?? "Not enough history")
            }

            VStack(alignment: .leading, spacing: Spacing.s3) {
                Text("Line skip pass")
                    .font(.crowdedSection)
                row("Pass price", value: bar.passPriceCents.map { Money.format(cents: $0) } ?? "No pass sold")
                VerdictLine(verdict: bar.verdict, long: true)
                Text("Your limit is \(bar.verdict.thresholdMin) min. Change it in Settings.")
                    .font(.crowdedCaption)
                    .foregroundStyle(Colors.text2)
            }
        }
    }

    private func row(_ label: String, value: String) -> some View {
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

    private func actions(_ detail: BarDetail) -> some View {
        VStack(spacing: Spacing.s2) {
            if let error = vm.errorMessage {
                Text(error)
                    .font(.crowdedSmall)
            }
            HStack(spacing: Spacing.s3) {
                PrimaryButton(title: "Report crowd") {
                    showReport = true
                }
                .accessibilityIdentifier("reportCrowdButton")
                Button {
                    Task {
                        if let session = await vm.startLine(location: app.location) {
                            app.sessionStarted(session, barName: detail.bar.name)
                        }
                    }
                } label: {
                    if vm.isStarting {
                        ProgressView()
                    } else {
                        Text("I'm in line")
                    }
                }
                .buttonStyle(SecondaryButtonStyle())
                .disabled(vm.isStarting || app.activeSession != nil)
                .accessibilityIdentifier("imInLineButton")
            }
        }
        .padding(.horizontal, Spacing.gutter)
        .padding(.vertical, Spacing.s3)
        .background(Colors.bg)
    }
}

#Preview("Bar detail") {
    let model = AppModel(api: MockAPI(signedIn: true), location: FixedLocation(), isMock: true)
    return NavigationStack {
        BarDetailView(api: model.api, barId: "00000000-0000-4000-8000-000000000001")
    }
    .environment(model)
}

import SwiftUI
import UIKit

/// "4:07" style clock for running timers and countdowns.
func formatMinSec(_ totalSeconds: Int) -> String {
    let safe = max(0, totalSeconds)
    return String(format: "%d:%02d", safe / 60, safe % 60)
}

/// High volume door mode: one huge IN zone, group buttons and Undo. OUT is a smaller secondary
/// button, shown only at bars that count exits. Works with a Bluetooth clicker or keyboard.
struct DoorCounterSection: View {
    let vm: StaffViewModel
    let barId: String
    let state: StaffState
    let onSetTotal: () -> Void

    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: Spacing.s4) {
            if let reminder = vm.reminder {
                ReminderBanner(reminder: reminder) { vm.dismissReminder() }
            }
            if vm.countsExits {
                headcount
            } else {
                entriesOnly
            }
            if vm.isSavingOffline {
                HStack(spacing: Spacing.s2) {
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .accessibilityHidden(true)
                    Text("Saving when back online")
                        .font(.crowdedLabel)
                    Text("\(vm.queue.count) waiting")
                        .font(.crowdedCaption)
                        .foregroundStyle(Colors.text2)
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("staffSavingOffline")
            }
            inZone
            groupRow
            if vm.countsExits {
                outButton
            } else {
                Text("This bar counts entries only.")
                    .font(.crowdedSmall)
                    .foregroundStyle(Colors.text2)
                    .frame(maxWidth: .infinity)
                    .accessibilityIdentifier("entriesOnlyNote")
            }
            HStack(spacing: Spacing.s3) {
                undoButton
                if vm.countsExits {
                    Button("Clicker total") { onSetTotal() }
                        .buttonStyle(ChipButtonStyle())
                        .accessibilityHint("Type the total from your clicker")
                        .accessibilityIdentifier("staffSetTotal")
                }
            }
        }
        .focusable()
        .focused($focused)
        .onAppear { focused = true }
        .onKeyPress(.rightArrow) { keyTap(.entry) }
        .onKeyPress(.pageDown) { keyTap(.entry) }
        .onKeyPress(.space) { keyTap(.entry) }
        .onKeyPress(.return) { keyTap(.entry) }
        .onKeyPress(.leftArrow) { keyTap(.exit) }
        .onKeyPress(.pageUp) { keyTap(.exit) }
    }

    private func keyTap(_ direction: DoorDirection) -> KeyPress.Result {
        // Out keys are ignored at bars that count entries only.
        if direction == .exit && !vm.countsExits {
            return .ignored
        }
        tap(direction, by: 1)
        return .handled
    }

    private func tap(_ direction: DoorDirection, by amount: Int) {
        UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
        Task { await vm.count(barId: barId, direction: direction, by: amount) }
    }

    private var headcount: some View {
        VStack(spacing: Spacing.s1) {
            Text("Inside now")
                .font(.crowdedSmall)
                .foregroundStyle(Colors.text2)
            Text("\(vm.displayedHeadcount)")
                .font(.crowdedNumber(96))
                .monospacedDigit()
                .contentTransition(.numericText())
                .animation(Motion.fadeAnimation, value: vm.displayedHeadcount)
                .minimumScaleFactor(0.5)
                .lineLimit(1)
                .accessibilityIdentifier("staffHeadcount")
            Text("of \(state.capacity) capacity, \(vm.capacityPercent)%")
                .font(.crowdedSmall)
                .foregroundStyle(Colors.text2)
            ProgressView(value: min(1, Double(vm.displayedHeadcount) / Double(max(1, state.capacity))))
                .tint(Colors.text)
                .accessibilityHidden(true)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Inside now \(vm.displayedHeadcount), \(vm.capacityPercent) percent of capacity")
    }

    private var entriesOnly: some View {
        VStack(spacing: Spacing.s1) {
            Text("Entries tonight")
                .font(.crowdedSmall)
                .foregroundStyle(Colors.text2)
            Text("\(vm.displayedEntries)")
                .font(.crowdedNumber(96))
                .monospacedDigit()
                .contentTransition(.numericText())
                .animation(Motion.fadeAnimation, value: vm.displayedEntries)
                .minimumScaleFactor(0.5)
                .lineLimit(1)
                .accessibilityIdentifier("staffEntries")
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Entries tonight: \(vm.displayedEntries)")
    }

    private var inZone: some View {
        zone(title: "IN", symbol: "plus", filled: true, label: "Count one person in") {
            tap(.entry, by: 1)
        }
        .frame(height: 300)
        .accessibilityIdentifier("doorInZone")
    }

    private var outButton: some View {
        Button {
            tap(.exit, by: 1)
        } label: {
            HStack(spacing: Spacing.s2) {
                Image(systemName: "minus")
                    .accessibilityHidden(true)
                Text("OUT")
            }
        }
        // tap() already plays the door haptic, so the style adds none.
        .buttonStyle(SecondaryButtonStyle(haptic: .none, scale: 0.98))
        .accessibilityLabel("Count one person out")
        .accessibilityIdentifier("doorOutButton")
    }

    private func zone(
        title: String, symbol: String, filled: Bool, label: String, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            VStack(spacing: Spacing.s2) {
                Image(systemName: symbol)
                    .font(.system(size: 40, weight: .bold))
                Text(title)
                    .font(.crowdedNumber(40))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .foregroundStyle(filled ? Colors.primaryInk : Colors.text)
            .background(
                RoundedRectangle(cornerRadius: Radius.lg)
                    .fill(filled ? Colors.primary : Colors.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Radius.lg)
                    .stroke(Colors.borderStrong, lineWidth: filled ? 0 : 2)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle(scale: 0.98))
        .accessibilityLabel(label)
    }

    private var groupRow: some View {
        HStack(spacing: Spacing.s3) {
            ForEach([2, 3, 4], id: \.self) { size in
                Button("+\(size)") { tap(.entry, by: size) }
                    .buttonStyle(ChipButtonStyle(haptic: .none))
                    .frame(maxWidth: .infinity)
                    .accessibilityLabel("Count a group of \(size) in")
                    .accessibilityIdentifier("doorGroup\(size)")
            }
        }
    }

    private var undoButton: some View {
        TimelineView(.periodic(from: Date(), by: 1)) { context in
            let allowed = vm.canUndo(at: context.date)
            Button("Undo") {
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                Task { await vm.undo(barId: barId) }
            }
            .buttonStyle(ChipButtonStyle(haptic: .none))
            .disabled(!allowed)
            .opacity(allowed ? 1 : 0.5)
            .accessibilityLabel("Undo last tap")
            .accessibilityHint(allowed ? "Sends the opposite count" : "Available for 30 seconds after a tap")
            .accessibilityIdentifier("doorUndo")
        }
    }
}

struct ReminderBanner: View {
    let reminder: DoorReminder
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: Spacing.s3) {
            Image(systemName: "bell")
                .accessibilityHidden(true)
            Text(reminder.text)
                .font(.crowdedBodyStrong)
            Spacer(minLength: 0)
            Button("Dismiss", action: onDismiss)
                .buttonStyle(ChipButtonStyle())
        }
        .padding(Spacing.s3)
        .frame(maxWidth: .infinity)
        .background(RoundedRectangle(cornerRadius: Radius.md).fill(Colors.surface))
        .overlay(RoundedRectangle(cornerRadius: Radius.md).stroke(Colors.borderStrong, lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("doorReminder")
    }
}

/// Time the line: start a sample at the back of the line, end it at the door.
struct LineSamplePanel: View {
    let vm: StaffViewModel
    let barId: String

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s3) {
            Text("Time the line")
                .font(.crowdedSection)
            Text("Tap when someone joins the back of the line")
                .font(.crowdedSmall)
                .foregroundStyle(Colors.text2)
            Button("Start timing") {
                Task { await vm.startSample(barId: barId) }
            }
            .buttonStyle(SecondaryButtonStyle())
            .disabled(!vm.canStartSample)
            .accessibilityHint(vm.canStartSample ? "" : "Two checks are already running")
            .accessibilityIdentifier("startSample")

            ForEach(vm.samples) { sample in
                sampleChip(sample)
            }

            TimelineView(.periodic(from: Date(), by: 30)) { context in
                if let text = vm.lastCheckText(at: context.date) {
                    Text(text)
                        .font(.crowdedSmall)
                        .foregroundStyle(Colors.text2)
                        .accessibilityIdentifier("lastLineCheck")
                }
            }
            if let error = vm.sampleError {
                Text(error).font(.crowdedSmall)
            }
        }
    }

    private func sampleChip(_ sample: LineSample) -> some View {
        TimelineView(.periodic(from: Date(), by: 1)) { context in
            let seconds = Int(context.date.timeIntervalSince(sample.startedAt))
            HStack(spacing: Spacing.s3) {
                Image(systemName: "timer")
                    .accessibilityHidden(true)
                Text(formatMinSec(seconds))
                    .font(.crowdedNumber(CrowdedFont.xl))
                    .monospacedDigit()
                    .accessibilityLabel("Timing, \(seconds / 60) minutes \(seconds % 60) seconds")
                Spacer(minLength: 0)
                Button("They're in") {
                    Task { await vm.endSample(barId: barId, sampleId: sample.id, outcome: .inside) }
                }
                .buttonStyle(ChipButtonStyle())
                .accessibilityIdentifier("sampleIn")
                Button("Cancel") {
                    Task { await vm.endSample(barId: barId, sampleId: sample.id, outcome: .cancel) }
                }
                .buttonStyle(ChipButtonStyle())
                .accessibilityIdentifier("sampleCancel")
            }
            .padding(Spacing.s3)
            .background(RoundedRectangle(cornerRadius: Radius.md).fill(Colors.surface))
        }
    }
}

/// Two one tap questions for door staff: how busy inside and how long a drink takes.
struct InsidePanel: View {
    let vm: StaffViewModel
    let barId: String
    let state: StaffState

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s4) {
            VStack(alignment: .leading, spacing: Spacing.s3) {
                Text("How busy inside?")
                    .font(.crowdedLabel)
                    .foregroundStyle(Colors.text2)
                HStack(spacing: Spacing.s2) {
                    ForEach(CrowdLevel.allCases) { level in
                        OptionButton(
                            title: level.label,
                            subtitle: level.detail,
                            isSelected: state.inside?.crowdLevel == level
                        ) {
                            Task { await vm.postInside(barId: barId, crowd: level) }
                        }
                        .accessibilityIdentifier("inside-crowd-\(level.rawValue)")
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
                            isSelected: state.inside?.drinkWait == wait
                        ) {
                            Task { await vm.postInside(barId: barId, drinkWait: wait) }
                        }
                        .accessibilityLabel(wait.fullLabel)
                        .accessibilityIdentifier("inside-drink-\(wait.rawValue)")
                    }
                }
            }
            TimelineView(.periodic(from: Date(), by: 30)) { context in
                if let text = vm.insideUpdatedText(at: context.date) {
                    Text(text)
                        .font(.crowdedCaption)
                        .foregroundStyle(Colors.text2)
                        .accessibilityIdentifier("insideUpdated")
                }
            }
        }
    }
}

/// Number pad sheet to set "inside now" from a clicker total.
struct CountSyncSheet: View {
    let currentCount: Int
    let onSave: (Int) async -> Bool
    @Environment(\.dismiss) private var dismiss
    @State private var text: String = ""
    @State private var isSaving = false
    @FocusState private var fieldFocused: Bool

    private var value: Int? {
        guard !text.isEmpty, let number = Int(text), number <= 5000 else { return nil }
        return number
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s4) {
            Text("Set inside now")
                .font(.crowdedTitle)
            Text("Type the total from your clicker. It replaces the count now at \(currentCount).")
                .font(.crowdedBody)
                .foregroundStyle(Colors.text2)
            TextField("0", text: $text)
                .keyboardType(.numberPad)
                .focused($fieldFocused)
                .font(.crowdedNumber(CrowdedFont.hero))
                .monospacedDigit()
                .padding(.horizontal, Spacing.s4)
                .frame(minHeight: 72)
                .background(RoundedRectangle(cornerRadius: Radius.md).fill(Colors.surface))
                .onChange(of: text) { _, newValue in
                    let digits = newValue.filter { $0.isNumber }
                    let trimmed = String(digits.prefix(4))
                    if trimmed != newValue { text = trimmed }
                }
                .accessibilityLabel("People inside now")
                .accessibilityIdentifier("syncField")
            PrimaryButton(title: "Save total", isBusy: isSaving) {
                guard let value else { return }
                isSaving = true
                Task {
                    let ok = await onSave(value)
                    isSaving = false
                    if ok { dismiss() }
                }
            }
            .disabled(value == nil)
            .accessibilityIdentifier("syncSave")
            SecondaryButton(title: "Cancel") { dismiss() }
        }
        .padding(Spacing.gutter)
        .crowdedScreen()
        .onAppear { fieldFocused = true }
    }
}

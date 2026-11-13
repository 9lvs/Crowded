import SwiftUI

/// Staff list of the bar's specials. Toggle one off to hide it from students, swipe to delete,
/// tap a row to edit, or add a new one.
struct StaffSpecialsView: View {
    @State private var vm: StaffSpecialsViewModel
    @State private var editorTarget: EditorTarget?
    @State private var pendingDelete: Special?

    enum EditorTarget: Identifiable {
        case add
        case edit(Special)

        var id: String {
            switch self {
            case .add: return "add"
            case let .edit(special): return special.id
            }
        }
    }

    init(api: CrowdedAPI, barId: String) {
        _vm = State(initialValue: StaffSpecialsViewModel(api: api, barId: barId))
    }

    var body: some View {
        List {
            if let error = vm.errorMessage {
                Text(error)
                    .font(.crowdedSmall)
                    .listRowBackground(Colors.bg)
                    .accessibilityIdentifier("specialsError")
            }
            if vm.isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Colors.bg)
            } else if vm.specials.isEmpty {
                Text("No specials posted.")
                    .font(.crowdedBody)
                    .foregroundStyle(Colors.text2)
                    .listRowBackground(Colors.bg)
            }
            ForEach(vm.specials) { special in
                row(special)
                    .listRowBackground(Colors.bg)
                    .listRowSeparatorTint(Colors.border)
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button(role: .destructive) {
                            pendingDelete = special
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .crowdedScreen()
        .navigationTitle("Specials")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    editorTarget = .add
                } label: {
                    Label("Add special", systemImage: "plus")
                }
                .frame(minWidth: 44, minHeight: 44)
                .accessibilityIdentifier("addSpecialButton")
            }
        }
        .sheet(item: $editorTarget) { target in
            SpecialEditorSheet(vm: vm, target: target)
        }
        .confirmationDialog(
            "Delete this special?",
            isPresented: Binding(
                get: { pendingDelete != nil },
                set: { if !$0 { pendingDelete = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let special = pendingDelete {
                    Task { _ = await vm.delete(special) }
                }
                pendingDelete = nil
            }
            Button("Keep it", role: .cancel) {
                pendingDelete = nil
            }
        } message: {
            if let special = pendingDelete {
                Text("\(special.title) will be removed for students.")
            }
        }
        .task { await vm.load() }
        .refreshable { await vm.load() }
    }

    private func scheduleText(_ special: Special) -> String {
        return special.allDay ? "All night" : special.window
    }

    private func row(_ special: Special) -> some View {
        HStack(alignment: .center, spacing: Spacing.s3) {
            Button {
                editorTarget = .edit(special)
            } label: {
                VStack(alignment: .leading, spacing: Spacing.s1) {
                    Text(special.kind.label)
                        .font(.crowdedLabel)
                        .foregroundStyle(Colors.text2)
                    Text(special.title)
                        .font(.crowdedRowTitle)
                        .multilineTextAlignment(.leading)
                    Text("\(SpecialTime.daysSummary(special.days)), \(scheduleText(special))")
                        .font(.crowdedSmall)
                        .foregroundStyle(Colors.text2)
                        .multilineTextAlignment(.leading)
                    if let price = special.priceText {
                        Text(price)
                            .font(.crowdedSmall)
                    }
                    if !special.items.isEmpty {
                        Text(special.items.count == 1 ? "1 item" : "\(special.items.count) items")
                            .font(.crowdedSmall)
                            .foregroundStyle(Colors.text2)
                    }
                    Text(special.isActive ? "Showing to students" : "Hidden")
                        .font(.crowdedCaption)
                        .foregroundStyle(Colors.text3)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .frame(minHeight: Spacing.touch)
                .contentShape(Rectangle())
            }
            .buttonStyle(PressableStyle())
            .accessibilityHint("Edit this special")

            Toggle(
                "Show to students",
                isOn: Binding(
                    get: { special.isActive },
                    set: { newValue in
                        Task { await vm.setActive(special, active: newValue) }
                    }
                )
            )
            .labelsHidden()
            .frame(minWidth: 52, minHeight: Spacing.touch)
            .accessibilityLabel("Show \(special.title) to students")
        }
        .padding(.vertical, Spacing.s1)
    }
}

/// Add or edit one special. Times are picked on a clock and sent as HH:MM.
struct SpecialEditorSheet: View {
    @Environment(\.dismiss) private var dismiss
    let vm: StaffSpecialsViewModel
    let target: StaffSpecialsView.EditorTarget
    @State private var draft: SpecialDraft
    @State private var startDate: Date
    @State private var endDate: Date
    @State private var localProblem: String?

    init(vm: StaffSpecialsViewModel, target: StaffSpecialsView.EditorTarget) {
        self.vm = vm
        self.target = target
        let initial: SpecialDraft
        switch target {
        case .add:
            initial = SpecialDraft()
        case let .edit(special):
            initial = SpecialDraft(editing: special)
        }
        _draft = State(initialValue: initial)
        _startDate = State(initialValue: SpecialTime.date(from: initial.start))
        _endDate = State(initialValue: SpecialTime.date(from: initial.end))
    }

    private var isEditing: Bool {
        if case .edit = target { return true }
        return false
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.s5) {
                    kindPicker
                    field("Title", text: $draft.title, id: "specialTitleField")
                    field("Details (optional)", text: $draft.details, id: "specialDetailsField")
                    dayToggles
                    allNightToggle
                    if !draft.allDay {
                        timePickers
                    }
                    itemsEditor
                    priceField
                    if let message = localProblem ?? vm.errorMessage {
                        Text(message)
                            .font(.crowdedSmall)
                            .accessibilityIdentifier("specialEditorError")
                    }
                    PrimaryButton(title: isEditing ? "Save" : "Add special", isBusy: vm.isSaving) {
                        save()
                    }
                    .accessibilityIdentifier("saveSpecialButton")
                }
                .padding(.horizontal, Spacing.gutter)
                .padding(.vertical, Spacing.s4)
            }
            .crowdedScreen()
            .navigationTitle(isEditing ? "Edit special" : "New special")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
        .presentationDetents([.large])
        .onAppear { vm.errorMessage = nil }
    }

    private var kindPicker: some View {
        VStack(alignment: .leading, spacing: Spacing.s2) {
            Text("Kind")
                .font(.crowdedLabel)
                .foregroundStyle(Colors.text2)
            Picker("Kind", selection: $draft.kind) {
                ForEach(SpecialKind.allCases) { kind in
                    Text(kind.label).tag(kind)
                }
            }
            .pickerStyle(.menu)
            .tint(Colors.text)
            .frame(minHeight: Spacing.touch)
            .accessibilityIdentifier("specialKindPicker")
        }
    }

    private func field(_ title: String, text: Binding<String>, id: String) -> some View {
        VStack(alignment: .leading, spacing: Spacing.s2) {
            Text(title)
                .font(.crowdedLabel)
                .foregroundStyle(Colors.text2)
            TextField(title, text: text)
                .font(.crowdedBody)
                .padding(.horizontal, Spacing.s4)
                .frame(minHeight: Spacing.touch)
                .background(RoundedRectangle(cornerRadius: Radius.md).fill(Colors.surface))
                .accessibilityLabel(title)
                .accessibilityIdentifier(id)
        }
    }

    private var dayToggles: some View {
        VStack(alignment: .leading, spacing: Spacing.s2) {
            Text("Days")
                .font(.crowdedLabel)
                .foregroundStyle(Colors.text2)
            LazyVGrid(
                columns: [
                    GridItem(.flexible(), spacing: Spacing.s2),
                    GridItem(.flexible(), spacing: Spacing.s2),
                    GridItem(.flexible(), spacing: Spacing.s2),
                    GridItem(.flexible(), spacing: Spacing.s2),
                ],
                spacing: Spacing.s2
            ) {
                ForEach(0..<7, id: \.self) { day in
                    OptionButton(
                        title: SpecialTime.shortDays[day],
                        isSelected: draft.days.contains(day)
                    ) {
                        if draft.days.contains(day) {
                            draft.days.remove(day)
                        } else {
                            draft.days.insert(day)
                        }
                    }
                    .accessibilityLabel(SpecialTime.longDays[day])
                    .accessibilityIdentifier("specialDay-\(day)")
                }
            }
        }
    }

    private var allNightToggle: some View {
        VStack(alignment: .leading, spacing: Spacing.s1) {
            Toggle("All night", isOn: $draft.allDay)
                .font(.crowdedBody)
                .tint(Colors.text)
                .frame(minHeight: Spacing.touch)
                .accessibilityIdentifier("specialAllNightToggle")
            Text("Runs the whole night. No start or end time needed.")
                .font(.crowdedCaption)
                .foregroundStyle(Colors.text2)
        }
    }

    private var itemsEditor: some View {
        VStack(alignment: .leading, spacing: Spacing.s3) {
            Text("Items (optional)")
                .font(.crowdedLabel)
                .foregroundStyle(Colors.text2)
            ForEach($draft.items) { $item in
                itemEditor($item)
            }
            Button {
                draft.items.append(DealItemDraft())
            } label: {
                Label("Add item", systemImage: "plus")
                    .font(.crowdedBodyStrong)
                    .frame(minHeight: Spacing.touch)
                    .contentShape(Rectangle())
            }
            .buttonStyle(PressableStyle())
            .disabled(draft.items.count >= SpecialDraft.maxItems)
            .accessibilityIdentifier("addDealItemButton")
            Text("\(draft.items.count) of \(SpecialDraft.maxItems) items")
                .font(.crowdedCaption)
                .foregroundStyle(Colors.text2)
        }
    }

    private func itemEditor(_ item: Binding<DealItemDraft>) -> some View {
        VStack(alignment: .leading, spacing: Spacing.s2) {
            HStack(spacing: Spacing.s2) {
                itemField("Item name", text: item.name)
                itemField("Price", text: item.priceLabel)
                    .frame(maxWidth: 110)
            }
            HStack(spacing: Spacing.s2) {
                Picker("Category", selection: item.category) {
                    ForEach(DealCategory.allCases) { category in
                        Text(category.label).tag(category)
                    }
                }
                .pickerStyle(.menu)
                .tint(Colors.text)
                .frame(minHeight: Spacing.touch)
                Spacer(minLength: 0)
                Button {
                    let target = item.wrappedValue.id
                    draft.items.removeAll { $0.id == target }
                } label: {
                    Image(systemName: "trash")
                        .frame(minWidth: Spacing.touch, minHeight: Spacing.touch)
                        .contentShape(Rectangle())
                }
                .buttonStyle(PressableStyle())
                .accessibilityLabel("Delete item")
            }
            itemField("Note, like Dine in only (optional)", text: item.note)
        }
        .padding(Spacing.s3)
        .overlay(
            RoundedRectangle(cornerRadius: Radius.md).stroke(Colors.border, lineWidth: 1)
        )
    }

    private func itemField(_ title: String, text: Binding<String>) -> some View {
        TextField(title, text: text)
            .font(.crowdedBody)
            .padding(.horizontal, Spacing.s3)
            .frame(minHeight: Spacing.touch)
            .background(RoundedRectangle(cornerRadius: Radius.md).fill(Colors.surface))
            .accessibilityLabel(title)
    }

    private var timePickers: some View {
        VStack(alignment: .leading, spacing: Spacing.s2) {
            DatePicker("Starts", selection: $startDate, displayedComponents: .hourAndMinute)
                .font(.crowdedBody)
                .frame(minHeight: Spacing.touch)
            DatePicker("Ends", selection: $endDate, displayedComponents: .hourAndMinute)
                .font(.crowdedBody)
                .frame(minHeight: Spacing.touch)
            Text("An end time before the start runs past midnight.")
                .font(.crowdedCaption)
                .foregroundStyle(Colors.text2)
        }
    }

    private var priceField: some View {
        VStack(alignment: .leading, spacing: Spacing.s2) {
            Text("Price in dollars (optional)")
                .font(.crowdedLabel)
                .foregroundStyle(Colors.text2)
            TextField("5 or 5.50", text: $draft.priceText)
                .keyboardType(.decimalPad)
                .font(.crowdedBody)
                .padding(.horizontal, Spacing.s4)
                .frame(minHeight: Spacing.touch)
                .background(RoundedRectangle(cornerRadius: Radius.md).fill(Colors.surface))
                .accessibilityLabel("Price in dollars")
                .accessibilityIdentifier("specialPriceField")
        }
    }

    private func save() {
        draft.start = SpecialTime.hhmm(from: startDate)
        draft.end = SpecialTime.hhmm(from: endDate)
        if let problem = draft.problem {
            localProblem = problem
            return
        }
        localProblem = nil
        Task {
            let ok: Bool
            switch target {
            case .add:
                ok = await vm.add(draft.input)
            case let .edit(special):
                ok = await vm.update(special, patch: draft.patch)
            }
            if ok {
                dismiss()
            }
        }
    }
}

#Preview("Staff specials") {
    let model = AppModel(api: MockAPI(signedIn: true, role: .staff), location: FixedLocation(), isMock: true)
    return NavigationStack {
        StaffSpecialsView(api: model.api, barId: "00000000-0000-4000-8000-000000000001")
    }
    .environment(model)
}

import SwiftUI

/// "Tonight" specials plus a collapsible "This week" schedule on the bar detail screen.
struct SpecialsSection: View {
    let tonight: [SpecialTonight]
    let week: [Special]
    @State private var weekExpanded = false

    init(tonight: [SpecialTonight], week: [Special]) {
        self.tonight = tonight
        self.week = week
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s3) {
            Text("Tonight")
                .font(.crowdedSection)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("tonightSpecialsHeader")
            if tonight.isEmpty {
                Text("No specials posted.")
                    .font(.crowdedBody)
                    .foregroundStyle(Colors.text2)
                    .accessibilityIdentifier("noSpecialsText")
            } else {
                ForEach(tonight) { item in
                    SpecialRow(special: item.special, isNow: item.isNow, showDays: false)
                }
            }
            weekToggle
            if weekExpanded {
                weekList
            }
        }
    }

    private var weekToggle: some View {
        Button {
            weekExpanded.toggle()
        } label: {
            HStack {
                Text("This week")
                    .font(.crowdedRowTitle)
                Spacer()
                Image(systemName: weekExpanded ? "chevron.up" : "chevron.down")
                    .accessibilityHidden(true)
            }
            .frame(minHeight: Spacing.touch)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("This week")
        .accessibilityValue(weekExpanded ? "Expanded" : "Collapsed")
        .accessibilityHint("Shows the weekly schedule")
        .accessibilityIdentifier("thisWeekToggle")
    }

    @ViewBuilder
    private var weekList: some View {
        let groups = SpecialsSection.groupByDay(week)
        if groups.isEmpty {
            Text("No specials posted.")
                .font(.crowdedBody)
                .foregroundStyle(Colors.text2)
        } else {
            ForEach(groups, id: \.day) { group in
                VStack(alignment: .leading, spacing: Spacing.s2) {
                    Text(SpecialTime.longDays[group.day])
                        .font(.crowdedLabel)
                        .foregroundStyle(Colors.text2)
                        .accessibilityAddTraits(.isHeader)
                    ForEach(group.items) { special in
                        SpecialRow(special: special, isNow: false, showDays: false)
                    }
                }
            }
        }
    }

    struct DayGroup {
        var day: Int
        var items: [Special]
    }

    /// Monday to Sunday. A special that runs on several days appears under each of them.
    static func groupByDay(_ all: [Special]) -> [DayGroup] {
        var groups: [DayGroup] = []
        for day in 0...6 {
            let items = all
                .filter { $0.days.contains(day) }
                .sorted { $0.startLocal < $1.startLocal }
            if !items.isEmpty {
                groups.append(DayGroup(day: day, items: items))
            }
        }
        return groups
    }
}

/// One special: kind word, title, window, price, an optional Now tag, then who posted it.
struct SpecialRow: View {
    let special: Special
    let isNow: Bool
    var showDays: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s1) {
            HStack(alignment: .firstTextBaseline, spacing: Spacing.s2) {
                Text(special.kind.label)
                    .font(.crowdedLabel)
                    .foregroundStyle(Colors.text2)
                if isNow {
                    Text("Now")
                        .font(.crowdedCaption)
                        .padding(.horizontal, Spacing.s2)
                        .padding(.vertical, 2)
                        .overlay(
                            RoundedRectangle(cornerRadius: Radius.sm)
                                .stroke(Colors.borderStrong, lineWidth: 1.5)
                        )
                }
                Spacer(minLength: 0)
                if let price = special.priceText {
                    Text(price)
                        .font(.crowdedBodyStrong)
                }
            }
            Text(special.title)
                .font(.crowdedRowTitle)
                .fixedSize(horizontal: false, vertical: true)
            Text(special.window)
                .font(.crowdedBody)
            if showDays {
                Text(SpecialTime.daysSummary(special.days))
                    .font(.crowdedSmall)
                    .foregroundStyle(Colors.text2)
            }
            if !special.details.isEmpty {
                Text(special.details)
                    .font(.crowdedSmall)
                    .foregroundStyle(Colors.text2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text("\(special.postedBy.label). Updated \(SpecialTime.relative(special.updatedAt)).")
                .font(.crowdedCaption)
                .foregroundStyle(Colors.text3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, Spacing.s3)
        .hairlineBottom()
        .accessibilityElement(children: .combine)
    }
}

#Preview("Specials section") {
    ScrollView {
        SpecialsSection(
            tonight: [PreviewData.happyHourNow, PreviewData.coverLater],
            week: [PreviewData.happyHourNow.special, PreviewData.coverLater.special]
        )
        .padding(.horizontal, Spacing.gutter)
    }
    .crowdedScreen()
}

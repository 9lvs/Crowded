import SwiftUI

/// "Deals tonight" price list plus a collapsible "This week" list on the bar detail screen.
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
            Text("Deals tonight")
                .font(.crowdedSection)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("tonightSpecialsHeader")
            let groups = DealMenu.tonight(tonight)
            if groups.isEmpty {
                Text("No deals posted.")
                    .font(.crowdedBody)
                    .foregroundStyle(Colors.text2)
                    .accessibilityIdentifier("noSpecialsText")
            } else {
                ForEach(groups) { group in
                    DealGroupView(group: group)
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
        .buttonStyle(PressableStyle(haptic: .selection))
        .accessibilityLabel("This week")
        .accessibilityValue(weekExpanded ? "Expanded" : "Collapsed")
        .accessibilityHint("Shows the weekly deals")
        .accessibilityIdentifier("thisWeekToggle")
    }

    @ViewBuilder
    private var weekList: some View {
        let days = DealMenu.week(week)
        if days.isEmpty {
            Text("No deals posted.")
                .font(.crowdedBody)
                .foregroundStyle(Colors.text2)
        } else {
            ForEach(days) { day in
                VStack(alignment: .leading, spacing: Spacing.s2) {
                    Text(SpecialTime.longDays[day.day])
                        .font(.crowdedLabel)
                        .foregroundStyle(Colors.text2)
                        .accessibilityAddTraits(.isHeader)
                    ForEach(day.groups) { group in
                        DealGroupView(group: group)
                    }
                }
            }
        }
    }
}

/// One group of the price list: a header, item rows, then who posted it and when.
struct DealGroupView: View {
    let group: DealGroup

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s2) {
            HStack(alignment: .firstTextBaseline, spacing: Spacing.s2) {
                Text(group.title)
                    .font(.crowdedRowTitle)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                if group.isNow {
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
                if let status = group.status {
                    Text(status)
                        .font(.crowdedSmall)
                        .foregroundStyle(Colors.text2)
                }
            }
            ForEach(group.rows) { row in
                DealRowView(row: row)
            }
            Text("\(group.postedBy.label). Updated \(SpecialTime.relative(group.updatedAt)).")
                .font(.crowdedCaption)
                .foregroundStyle(Colors.text3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, Spacing.s3)
        .hairlineBottom()
    }
}

/// Name on the left, a dotted leader, price on the right, an optional small grey note below.
struct DealRowView: View {
    let row: DealRow

    private var spoken: String {
        var parts = [row.name]
        if let price = row.price {
            parts.append(price)
        }
        if !row.note.isEmpty {
            parts.append(row.note)
        }
        return parts.joined(separator: ", ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: Spacing.s2) {
                Text(row.name)
                    .font(.crowdedBody)
                    .fixedSize(horizontal: false, vertical: true)
                    .layoutPriority(1)
                if let price = row.price {
                    DottedLeader()
                        .stroke(Colors.text3, style: StrokeStyle(lineWidth: 1, dash: [1, 3]))
                        .frame(minWidth: Spacing.s4, maxWidth: .infinity)
                        .frame(height: 1)
                        .accessibilityHidden(true)
                    Text(price)
                        .font(.crowdedBodyStrong)
                        .monospacedDigit()
                        .layoutPriority(1)
                } else {
                    Spacer(minLength: 0)
                }
            }
            if !row.note.isEmpty {
                Text(row.note)
                    .font(.crowdedCaption)
                    .foregroundStyle(Colors.text2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(minHeight: 32, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
    }
}

/// A horizontal line that the dash pattern turns into dots.
struct DottedLeader: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.midY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        return path
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

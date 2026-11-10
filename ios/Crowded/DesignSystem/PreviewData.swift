import Foundation

/// FAKE sample values for SwiftUI previews and the component gallery.
enum PreviewData {
    static let packedLive = Live(
        hasRecentData: true, waitMin: 32, waitLowMin: 24, waitHighMin: 42, crowdLevel: .packed,
        headcount: 205, capacityRatio: 0.93, confidence: .high,
        basis: Basis(
            text: "Based on 7 reports, 3 timers and staff counts in the last 30 min",
            windowMin: 30, reports: 7, timers: 3, doorEvents: 14, staffLineUpdates: 2
        ),
        flags: [], updatedAt: Date()
    )

    static let buyPass = Verdict(
        recommendation: .buyPass,
        text: "Get the pass. Line is about 32 min, over your 20 min limit. Pass is $15.",
        thresholdMin: 20, passPriceCents: 1500, minutesSaved: 32
    )

    static let happyHourNow = SpecialTonight(
        special: Special(
            id: "fake-s1", kind: .happyHour, title: "FAKE Happy hour", details: "Half off wells.",
            days: [0, 1, 2, 3, 4], startLocal: "17:00", endLocal: "20:00", priceCents: nil,
            isActive: true, postedBy: .bar, updatedAt: Date().addingTimeInterval(-3 * 3600),
            items: [
                DealItem(name: "Double wells", priceLabel: "$2", category: .mixers),
                DealItem(name: "Drafts", priceLabel: "$2", category: .beer),
                DealItem(name: "Well mixers", priceLabel: "$1", category: .mixers),
            ]
        ),
        isNow: true
    )

    static let coverLater = SpecialTonight(
        special: Special(
            id: "fake-s2", kind: .cover, title: "FAKE Cover", details: "", days: [3, 4, 5],
            startLocal: "21:00", endLocal: "02:00", priceCents: 500, isActive: true,
            postedBy: .crowded, updatedAt: Date().addingTimeInterval(-26 * 3600)
        ),
        isNow: false
    )

    static let coverOnly: [SpecialTonight] = [coverLater]

    static let twoSpecials: [SpecialTonight] = [
        SpecialTonight(
            special: Special(
                id: "fake-s3", kind: .food, title: "FAKE Wing night", details: "", days: [2],
                startLocal: "17:00", endLocal: "22:00", priceCents: 600, isActive: true,
                postedBy: .bar, updatedAt: Date().addingTimeInterval(-50 * 3600)
            ),
            isNow: false
        ),
        SpecialTonight(
            special: Special(
                id: "fake-s4", kind: .event, title: "FAKE Trivia night", details: "", days: [2],
                startLocal: "20:00", endLocal: "22:00", priceCents: nil, isActive: true,
                postedBy: .bar, updatedAt: Date().addingTimeInterval(-72 * 3600)
            ),
            isNow: false
        ),
    ]

    static let owl = Bar(
        id: "fake-1", slug: "fake-tipsy-owl", name: "FAKE The Tipsy Owl",
        address: "101 Fake College Ave", capacity: 220, passPriceCents: 1500, live: packedLive,
        verdict: buyPass, specialsTonight: [happyHourNow, coverLater], coverTonight: coverLater
    )

    static let heron = Bar(
        id: "fake-3", slug: "fake-night-heron", name: "FAKE Night Heron", address: "9 Sample Row",
        capacity: 300, passPriceCents: nil, live: Live.noData,
        verdict: Verdict(
            recommendation: .noData, text: "No recent data. No call yet.", thresholdMin: 20,
            passPriceCents: nil, minutesSaved: nil
        )
    )

    static let hours: [HourPoint] = [
        HourPoint(hour: 18, typicalWaitMin: 2, tonightWaitMin: 1),
        HourPoint(hour: 19, typicalWaitMin: 5, tonightWaitMin: 4),
        HourPoint(hour: 20, typicalWaitMin: 12, tonightWaitMin: 14),
        HourPoint(hour: 21, typicalWaitMin: 22, tonightWaitMin: 21),
        HourPoint(hour: 22, typicalWaitMin: 30, tonightWaitMin: 31),
        HourPoint(hour: 23, typicalWaitMin: 34, tonightWaitMin: 32),
        HourPoint(hour: 0, typicalWaitMin: 31, tonightWaitMin: nil),
        HourPoint(hour: 1, typicalWaitMin: 24, tonightWaitMin: nil),
        HourPoint(hour: 2, typicalWaitMin: 14, tonightWaitMin: nil),
        HourPoint(hour: 3, typicalWaitMin: 6, tonightWaitMin: nil),
    ]
}

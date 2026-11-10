import Foundation
import Observation

/// Staff list of the bar's specials: add, edit, switch on or off, delete.
@Observable
@MainActor
final class StaffSpecialsViewModel {
    let barId: String
    var specials: [Special] = []
    var isLoading: Bool = false
    var isSaving: Bool = false
    var errorMessage: String?

    private let api: CrowdedAPI

    init(api: CrowdedAPI, barId: String) {
        self.api = api
        self.barId = barId
    }

    func load() async {
        isLoading = specials.isEmpty
        defer { isLoading = false }
        do {
            specials = try await api.listSpecials(barID: barId)
            errorMessage = nil
        } catch {
            errorMessage = APIError.wrap(error).errorDescription
        }
    }

    /// Returns true when the server accepted it, so the sheet can close.
    func add(_ input: SpecialInput) async -> Bool {
        isSaving = true
        defer { isSaving = false }
        do {
            let created = try await api.createSpecial(barID: barId, input: input)
            specials.append(created)
            errorMessage = nil
            return true
        } catch {
            errorMessage = APIError.wrap(error).errorDescription
            return false
        }
    }

    func update(_ special: Special, patch: SpecialPatch) async -> Bool {
        isSaving = true
        defer { isSaving = false }
        do {
            let fresh = try await api.updateSpecial(
                barID: barId, specialID: special.id, update: patch)
            replace(fresh)
            errorMessage = nil
            return true
        } catch {
            errorMessage = APIError.wrap(error).errorDescription
            return false
        }
    }

    func setActive(_ special: Special, active: Bool) async {
        _ = await update(special, patch: SpecialPatch(isActive: active))
    }

    func delete(_ special: Special) async -> Bool {
        do {
            try await api.deleteSpecial(barID: barId, specialID: special.id)
            specials.removeAll { $0.id == special.id }
            errorMessage = nil
            return true
        } catch {
            errorMessage = APIError.wrap(error).errorDescription
            return false
        }
    }

    private func replace(_ fresh: Special) {
        if let index = specials.firstIndex(where: { $0.id == fresh.id }) {
            specials[index] = fresh
        }
    }
}

/// Form state for the add and edit sheet. Kept apart from the view so it can be tested.
struct SpecialDraft: Equatable {
    var kind: SpecialKind = .happyHour
    var title: String = ""
    var details: String = ""
    var days: Set<Int> = [0, 1, 2, 3, 4]
    var start: String = "17:00"
    var end: String = "20:00"
    var priceText: String = ""

    init() {}

    init(editing special: Special) {
        kind = special.kind
        title = special.title
        details = special.details
        days = Set(special.days)
        start = special.startLocal
        end = special.endLocal
        priceText = SpecialPrice.dollarsText(cents: special.priceCents)
    }

    /// Plain words for the first thing wrong, or nil when the draft can be sent.
    var problem: String? {
        if title.trimmingCharacters(in: .whitespaces).isEmpty {
            return "Add a title."
        }
        if days.isEmpty {
            return "Pick at least one day."
        }
        if start == end {
            return "Start and end times must be different."
        }
        if !SpecialPrice.isValid(dollars: priceText) {
            return "Enter the price in dollars, like 5 or 5.50."
        }
        return nil
    }

    var priceCents: Int? {
        return SpecialPrice.cents(fromDollars: priceText)
    }

    var input: SpecialInput {
        return SpecialInput(
            kind: kind,
            title: title.trimmingCharacters(in: .whitespaces),
            details: details.trimmingCharacters(in: .whitespaces),
            days: days.sorted(),
            startLocal: start,
            endLocal: end,
            priceCents: priceCents
        )
    }

    var patch: SpecialPatch {
        return SpecialPatch(
            kind: kind,
            title: title.trimmingCharacters(in: .whitespaces),
            details: details.trimmingCharacters(in: .whitespaces),
            days: days.sorted(),
            startLocal: start,
            endLocal: end,
            priceCents: priceCents
        )
    }
}

import Foundation
import Observation

@Observable
@MainActor
final class OnboardingViewModel {
    enum Step: Equatable {
        case phone
        case code
    }

    var step: Step = .phone
    var ageAttested: Bool = false
    var phone: String = ""
    var code: String = ""
    var devCode: String?
    var isBusy: Bool = false
    var errorMessage: String?

    private let api: CrowdedAPI
    private let onSignedIn: @MainActor (Me) -> Void

    init(api: CrowdedAPI, onSignedIn: @escaping @MainActor (Me) -> Void) {
        self.api = api
        self.onSignedIn = onSignedIn
    }

    /// US numbers can be typed without +1. Anything else must start with + (E.164).
    var normalizedPhone: String? {
        let trimmed = phone.trimmingCharacters(in: .whitespaces)
        let digits = trimmed.filter { $0.isASCII && $0.isNumber }
        if trimmed.hasPrefix("+") {
            return (8...15).contains(digits.count) ? "+" + digits : nil
        }
        if digits.count == 10 {
            return "+1" + digits
        }
        if digits.count == 11 && digits.hasPrefix("1") {
            return "+" + digits
        }
        return nil
    }

    var canRequestCode: Bool {
        return ageAttested && normalizedPhone != nil && !isBusy
    }

    var canVerify: Bool {
        return code.count == 6 && code.allSatisfy({ $0.isASCII && $0.isNumber }) && !isBusy
    }

    func requestCode() async {
        guard ageAttested else {
            errorMessage = "Confirm you're 21 or older to continue."
            return
        }
        guard let number = normalizedPhone else {
            errorMessage = "Enter a valid phone number."
            return
        }
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do {
            let result = try await api.requestCode(phone: number)
            devCode = result.devCode
            code = ""
            step = .code
        } catch {
            errorMessage = APIError.wrap(error).errorDescription
        }
    }

    func verify() async {
        guard let number = normalizedPhone, canVerify else { return }
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do {
            let me = try await api.verifyCode(phone: number, code: code, ageAttested: ageAttested)
            onSignedIn(me)
        } catch {
            errorMessage = APIError.wrap(error).errorDescription
        }
    }

    func useDevCode() {
        if let devCode {
            code = devCode
        }
    }

    func back() {
        step = .phone
        code = ""
        errorMessage = nil
    }
}

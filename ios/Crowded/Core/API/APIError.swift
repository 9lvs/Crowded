import Foundation

/// Errors the UI can show. Server `detail` codes are mapped to plain language.
enum APIError: Error, Equatable, LocalizedError {
    case http(status: Int, detail: String)
    case network
    case decoding
    case notSignedIn

    var status: Int? {
        if case let .http(status, _) = self {
            return status
        }
        return nil
    }

    var detail: String {
        switch self {
        case let .http(_, detail): return detail
        case .network: return "network"
        case .decoding: return "decoding"
        case .notSignedIn: return "not_authenticated"
        }
    }

    var errorDescription: String? {
        switch detail {
        case "age_gate": return "Confirm you're 21 or older to continue."
        case "invalid_code": return "That code didn't work. Check it and try again."
        case "locked": return "Too many tries. Wait 15 minutes and try again."
        case "rate_limited": return "Slow down a sec. Try again in a moment."
        case "session_already_active": return "You already have a line timer running."
        case "session_not_active": return "That line timer already ended."
        case "invalid_invite": return "That invite code didn't work. Ask your manager for a new one."
        case "already_staff": return "This account already works at a bar."
        case "headcount_below_zero": return "Nobody left to count out."
        case "manager_only": return "Only managers can change this."
        case "door_code_disabled": return "The door code is turned off."
        case "not_found": return "We couldn't find that."
        case "not_authenticated", "invalid_refresh": return "Please sign in again."
        case "network": return "You're offline or the server is unreachable."
        case "validation_error": return "Something in that request wasn't valid."
        case "too_many_active_samples": return "Two line checks are already running. Finish one first."
        case "sample_not_active": return "That line check already ended."
        case "too_many_specials": return "This bar has too many specials. Delete one first."
        case "start_equals_end": return "Start and end times must be different."
        default:
            if detail.hasSuffix("_required") {
                return "Fill in every required field."
            }
            if let status, status >= 500 {
                return "Something went wrong on our side. Try again."
            }
            return "Something went wrong. Try again."
        }
    }

    /// Pulls `detail` out of a FastAPI error body. Validation errors carry a list, not a string.
    static func detail(from data: Data) -> String {
        guard
            let object = try? JSONSerialization.jsonObject(with: data),
            let dict = object as? [String: Any]
        else {
            return ""
        }
        if let text = dict["detail"] as? String {
            return text
        }
        return "validation_error"
    }

    static func wrap(_ error: Error) -> APIError {
        if let api = error as? APIError {
            return api
        }
        if error is URLError {
            return .network
        }
        if error is DecodingError {
            return .decoding
        }
        return .network
    }
}

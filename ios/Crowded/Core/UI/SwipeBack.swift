import SwiftUI
import UIKit

// Why this file exists: Tonight, Door and Settings hide the system navigation bar with
// `.toolbar(.hidden, for: .navigationBar)` because they draw their own big headers. UIKit turns
// the edge swipe (interactivePopGestureRecognizer) off while the bar is hidden, and SwiftUI can
// leave it off for the screens pushed on top as well. This small, well known bridge keeps the
// swipe from the left edge working on every NavigationStack. It only begins a pop when there is
// a screen to go back to, so the root screen is never affected.
extension UINavigationController: UIGestureRecognizerDelegate {
    override open func viewDidLoad() {
        super.viewDidLoad()
        interactivePopGestureRecognizer?.delegate = self
    }

    public func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        return viewControllers.count > 1
    }
}

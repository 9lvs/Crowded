import SwiftUI
import UIKit

// Why this file exists: Tonight, Door and Settings hide the system navigation bar with
// `.toolbar(.hidden, for: .navigationBar)` because they draw their own big headers. UIKit turns
// the edge swipe (interactivePopGestureRecognizer) off while the bar is hidden, and SwiftUI can
// leave it off for the screens pushed on top as well. This small bridge keeps the swipe from the
// left edge working on every NavigationStack.
//
// Taking over the delegate also drops two things UIKit's own delegate did, so they are restored:
// 1. A pop only begins when there is a screen to go back to and no transition is running.
// 2. A scroll view's pan waits for the edge swipe to fail. Without this, a horizontal drag on a
//    scrolling screen (the bar page) goes to the scroll view and the pop never starts.
extension UINavigationController: UIGestureRecognizerDelegate {
    override open func viewDidLoad() {
        super.viewDidLoad()
        interactivePopGestureRecognizer?.delegate = self
    }

    public func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard gestureRecognizer === interactivePopGestureRecognizer else { return true }
        return viewControllers.count > 1 && transitionCoordinator == nil
    }

    public func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldBeRequiredToFailBy otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
        gestureRecognizer === interactivePopGestureRecognizer
            && otherGestureRecognizer.view is UIScrollView
    }
}

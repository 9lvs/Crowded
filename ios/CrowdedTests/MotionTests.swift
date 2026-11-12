import SwiftUI
import XCTest
@testable import Crowded

final class MotionTests: XCTestCase {
    func testMotionConstantsMatchSpec() {
        XCTAssertEqual(Motion.press, 0.12, accuracy: 0.0001)
        XCTAssertEqual(Motion.screen, 0.24, accuracy: 0.0001)
        XCTAssertEqual(Motion.sheet, 0.3, accuracy: 0.0001)
        XCTAssertEqual(Motion.fade, 0.16, accuracy: 0.0001)
    }

    func testPressableStyleExistsWithSpecDefaults() {
        let style = PressableStyle()
        XCTAssertEqual(style.scale, 0.97, accuracy: 0.0001)
        let door = PressableStyle(scale: 0.98)
        XCTAssertEqual(door.scale, 0.98, accuracy: 0.0001)
    }

    func testHapticMapping() {
        XCTAssertNil(PressHaptic.none.feedback)
        XCTAssertNotNil(PressHaptic.light.feedback)
        XCTAssertNotNil(PressHaptic.medium.feedback)
        XCTAssertNotNil(PressHaptic.selection.feedback)
    }
}

import XCTest

/// Core student flow against the in app MockAPI (launch argument -mockAPI). No server needed.
final class CoreFlowUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    func testSignInReportTimerSettings() {
        let app = XCUIApplication()
        app.launchArguments = ["-mockAPI"]
        app.launch()

        // Onboarding: 21+ attestation is required before Continue works.
        let ageToggle = app.buttons["ageToggle"]
        XCTAssertTrue(ageToggle.waitForExistence(timeout: 10))
        let phone = app.textFields["phoneField"]
        phone.tap()
        phone.typeText("5550101234")
        XCTAssertFalse(app.buttons["continueButton"].isEnabled)
        ageToggle.tap()
        app.buttons["continueButton"].tap()

        // Code step: the mock returns a dev code to autofill.
        let devCode = app.buttons["useDevCode"]
        XCTAssertTrue(devCode.waitForExistence(timeout: 5))
        devCode.tap()
        app.buttons["verifyButton"].tap()

        // Tonight.
        XCTAssertTrue(app.staticTexts["Tonight"].waitForExistence(timeout: 10))
        let owl = app.buttons["barRow-fake-tipsy-owl"]
        XCTAssertTrue(owl.waitForExistence(timeout: 5))
        owl.tap()

        // Bar detail: the Tonight specials section is there.
        XCTAssertTrue(app.staticTexts["tonightSpecialsHeader"].waitForExistence(timeout: 5))

        // Bar detail: report the crowd.
        let report = app.buttons["reportCrowdButton"]
        XCTAssertTrue(report.waitForExistence(timeout: 5))
        report.tap()
        let packed = app.buttons["crowd-packed"]
        XCTAssertTrue(packed.waitForExistence(timeout: 5))
        packed.tap()
        app.buttons["line-long"].tap()
        app.buttons["sendReport"].tap()
        let done = app.buttons["reportDone"]
        XCTAssertTrue(done.waitForExistence(timeout: 5))
        done.tap()

        // Line timer.
        let inLine = app.buttons["imInLineButton"]
        XCTAssertTrue(inLine.waitForExistence(timeout: 5))
        inLine.tap()
        let inside = app.buttons["imInsideButton"]
        XCTAssertTrue(inside.waitForExistence(timeout: 5))
        inside.tap()
        let resultTitle = app.staticTexts["resultTitle"]
        XCTAssertTrue(resultTitle.waitForExistence(timeout: 5))
        app.buttons["resultDone"].tap()

        // Settings.
        app.tabBars.buttons["Settings"].tap()
        XCTAssertTrue(app.buttons["deleteAccountButton"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["signOutButton"].exists)
    }

    /// Swiping from the left edge goes back from bar detail to Tonight, like any iOS app.
    func testEdgeSwipeBackFromBarDetail() {
        let app = XCUIApplication()
        app.launchArguments = ["-mockAPI"]
        app.launch()

        let ageToggle = app.buttons["ageToggle"]
        XCTAssertTrue(ageToggle.waitForExistence(timeout: 10))
        let phone = app.textFields["phoneField"]
        phone.tap()
        phone.typeText("5550101234")
        ageToggle.tap()
        app.buttons["continueButton"].tap()
        let devCode = app.buttons["useDevCode"]
        XCTAssertTrue(devCode.waitForExistence(timeout: 5))
        devCode.tap()
        app.buttons["verifyButton"].tap()

        let tonight = app.staticTexts["Tonight"]
        XCTAssertTrue(tonight.waitForExistence(timeout: 10))
        let owl = app.buttons["barRow-fake-tipsy-owl"]
        XCTAssertTrue(owl.waitForExistence(timeout: 5))
        owl.tap()
        XCTAssertTrue(app.buttons["reportCrowdButton"].waitForExistence(timeout: 5))

        // Start right at the left edge, in the middle of the screen, and drag most of the way.
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.0, dy: 0.5))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5))
        start.press(forDuration: 0.05, thenDragTo: end)

        // The detail screen is gone and Tonight is back.
        let gone = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"),
            object: app.buttons["reportCrowdButton"]
        )
        XCTAssertEqual(XCTWaiter().wait(for: [gone], timeout: 5), .completed)
        XCTAssertTrue(tonight.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["barRow-fake-tipsy-owl"].waitForExistence(timeout: 5))
    }
}

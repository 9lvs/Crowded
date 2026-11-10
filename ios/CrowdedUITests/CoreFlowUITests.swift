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
        // The optional door code sheet appears. Skip it.
        let skip = app.buttons["doorCodeSkip"]
        XCTAssertTrue(skip.waitForExistence(timeout: 5))
        skip.tap()
        let resultTitle = app.staticTexts["resultTitle"]
        XCTAssertTrue(resultTitle.waitForExistence(timeout: 5))
        app.buttons["resultDone"].tap()

        // Settings.
        app.tabBars.buttons["Settings"].tap()
        XCTAssertTrue(app.buttons["deleteAccountButton"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["signOutButton"].exists)
    }
}

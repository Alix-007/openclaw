import UIKit
import XCTest

@MainActor
final class AppleActiveSessionArchiveProofUITests: XCTestCase {
    private var app: XCUIApplication?

    override func setUpWithError() throws {
        try super.setUpWithError()
        self.continueAfterFailure = false
    }

    override func tearDownWithError() throws {
        self.app?.terminate()
        self.app = nil
        try super.tearDownWithError()
    }

    func testActiveNonMainSessionShowsArchiveAndMainDoesNot() throws {
        let environment = ProcessInfo.processInfo.environment
        try XCTSkipUnless(
            environment["OPENCLAW_IOS_LIVE_GATEWAY"] == "1",
            "Set OPENCLAW_IOS_LIVE_GATEWAY=1 for the isolated archive proof")
        let setupCode = try XCTUnwrap(environment["OPENCLAW_IOS_LIVE_SETUP_CODE"])
        UIPasteboard.general.string = setupCode

        let app = XCUIApplication()
        self.app = app
        self.addUIInterruptionMonitor(withDescription: "Local network access") { alert in
            guard alert.buttons["Allow"].exists else { return false }
            alert.buttons["Allow"].tap()
            return true
        }
        app.launchArguments += [
            "--openclaw-reset-onboarding",
            "--openclaw-initial-tab",
            "chat",
            "--openclaw-initial-destination",
            "chat",
        ]
        app.launch()

        XCTAssertTrue(app.buttons["Continue"].waitForExistence(timeout: 8))
        app.buttons["Continue"].tap()
        app.tap()
        XCTAssertTrue(app.buttons["Connect Manually"].waitForExistence(timeout: 8))
        app.buttons["Connect Manually"].tap()

        let setupCodeField = app.textFields["Enter setup code"]
        XCTAssertTrue(setupCodeField.waitForExistence(timeout: 5))
        setupCodeField.tap()
        setupCodeField.press(forDuration: 1)
        XCTAssertTrue(app.menuItems["Paste"].waitForExistence(timeout: 3))
        app.menuItems["Paste"].tap()
        app.buttons["Apply"].tap()

        XCTAssertTrue(app.staticTexts["You're connected"].waitForExistence(timeout: 45))
        app.buttons["Go to Chat"].tap()
        XCTAssertTrue(app.otherElements["chat-composer-surface"].waitForExistence(timeout: 8))

        let showSidebar = app.buttons["RootTabs.Sidebar.Show"]
        XCTAssertTrue(showSidebar.waitForExistence(timeout: 5))
        showSidebar.tap()

        let active = app.buttons.matching(NSPredicate(
            format: "label BEGINSWITH[c] %@",
            "Active archive proof")).firstMatch
        XCTAssertTrue(active.waitForExistence(timeout: 8))
        XCTAssertTrue(active.isHittable)
        active.press(forDuration: 1)

        let archive = app.buttons["Archive"]
        XCTAssertTrue(
            archive.waitForExistence(timeout: 5),
            "A running non-main session with a durable ID must expose Archive")
        self.attachScreenshot(named: "active-non-main-session-archive-visible")
        self.attachHierarchy(named: "active-non-main-session-menu-hierarchy", app: app)

        app.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.12)).tap()
        XCTAssertTrue(archive.waitForNonExistence(timeout: 5))

        if showSidebar.waitForExistence(timeout: 2) {
            showSidebar.tap()
        }
        let home = app.buttons["RootTabs.Sidebar.Destination.chat"]
        XCTAssertTrue(
            home.waitForExistence(timeout: 5),
            "The configured main session must remain represented by the protected Home row")
        XCTAssertTrue(home.isHittable)
        home.press(forDuration: 1)
        XCTAssertFalse(
            app.buttons["Archive"].exists,
            "The protected Home row must not expose Archive")
        self.attachScreenshot(named: "active-main-session-home-archive-absent")
        self.attachHierarchy(named: "active-main-session-home-hierarchy", app: app)
    }

    private func attachScreenshot(named name: String) {
        guard let app else { return }
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        self.add(attachment)
    }

    private func attachHierarchy(named name: String, app: XCUIApplication) {
        let attachment = XCTAttachment(string: app.debugDescription)
        attachment.name = name
        attachment.lifetime = .keepAlways
        self.add(attachment)
    }
}

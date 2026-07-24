import XCTest
import CoreGraphics
@testable import MediFlowAppleShared

/// The patients workspace has to survive iPad continuous resize, which walks the
/// container through every intermediate width rather than jumping between device
/// sizes. These tests sweep the width axis instead of asserting a handful of
/// device constants, so a fix that only works on one iPad cannot pass.
final class PatientsWorkspaceLayoutTests: XCTestCase {
    private let sweep: [CGFloat] = Array(stride(from: CGFloat(320), through: CGFloat(1400), by: CGFloat(1)))

    func testListWidthStaysWithinItsContentFloors() {
        for width in sweep {
            let list = PatientsWorkspaceLayout.listWidth(forContainerWidth: width)
            XCTAssertGreaterThanOrEqual(list, PatientsWorkspaceLayout.minimumListWidth, "container \(width)")
            XCTAssertLessThanOrEqual(list, PatientsWorkspaceLayout.maximumListWidth, "container \(width)")
        }
    }

    func testSideBySideAlwaysLeavesAUsableChartColumn() {
        for width in sweep where PatientsWorkspaceLayout.usesSideBySide(containerWidth: width, isAccessibilitySize: false) {
            let detail = PatientsWorkspaceLayout.detailWidth(forContainerWidth: width)
            XCTAssertGreaterThanOrEqual(
                detail,
                PatientsWorkspaceLayout.minimumDetailWidth,
                "side-by-side at \(width) starves the chart column (\(detail))"
            )
        }
    }

    func testColumnsNeverOverflowTheContainer() {
        for width in sweep where PatientsWorkspaceLayout.usesSideBySide(containerWidth: width, isAccessibilitySize: false) {
            let total = PatientsWorkspaceLayout.listWidth(forContainerWidth: width)
                + PatientsWorkspaceLayout.dividerWidth
                + PatientsWorkspaceLayout.detailWidth(forContainerWidth: width)
            XCTAssertEqual(total, width, accuracy: 0.001, "columns must consume exactly the container at \(width)")
        }
    }

    /// The regression this rule exists for: the previous layout pinned the list to
    /// 360pt, so a 13" iPad in a half-split (678pt) left the chart 317pt before
    /// padding, which clipped clinical rows. The rule must refuse those splits.
    func testNarrowMultitaskingWidthsCollapseInsteadOfStarvingTheChart() {
        // Real iPad multitasking widths that a regular size class can still report.
        let narrow: [CGFloat] = [320, 375, 507, 639, 678, 694]
        for width in narrow {
            XCTAssertFalse(
                PatientsWorkspaceLayout.usesSideBySide(containerWidth: width, isAccessibilitySize: false),
                "\(width)pt cannot host two columns without clipping the chart"
            )
        }
    }

    /// Real full-screen iPad container widths, portrait and landscape.
    func testFullScreenIPadWidthsUseBothColumns() {
        let wide: [CGFloat] = [744, 810, 834, 1024, 1080, 1133, 1194, 1366, 1376]
        for width in wide {
            XCTAssertTrue(
                PatientsWorkspaceLayout.usesSideBySide(containerWidth: width, isAccessibilitySize: false),
                "\(width)pt has room for list plus chart"
            )
            XCTAssertGreaterThanOrEqual(
                PatientsWorkspaceLayout.detailWidth(forContainerWidth: width),
                PatientsWorkspaceLayout.minimumDetailWidth,
                "chart column too narrow at \(width)pt"
            )
        }
    }

    /// The split must switch on exactly one boundary, and the boundary must be the
    /// one the column floors imply, divider included.
    func testSplitThresholdIsTheOneTheColumnFloorsImply() {
        let expected = PatientsWorkspaceLayout.minimumListWidth
            + PatientsWorkspaceLayout.dividerWidth
            + PatientsWorkspaceLayout.minimumDetailWidth
        let firstSplitting = sweep.first {
            PatientsWorkspaceLayout.usesSideBySide(containerWidth: $0, isAccessibilitySize: false)
        }
        XCTAssertEqual(firstSplitting, expected, "the split must begin exactly at the implied floor sum")
    }

    /// Growing the container must never take the list away once it is shown, and
    /// must never shrink it: continuous resize would otherwise jitter mid-drag.
    func testListWidthIsMonotonicAndSplitDecisionIsStable() {
        var previousList = CGFloat.zero
        var sawSplit = false
        for width in sweep {
            let list = PatientsWorkspaceLayout.listWidth(forContainerWidth: width)
            XCTAssertGreaterThanOrEqual(list, previousList, "list width must not shrink as the container grows (\(width))")
            previousList = list

            let split = PatientsWorkspaceLayout.usesSideBySide(containerWidth: width, isAccessibilitySize: false)
            if split { sawSplit = true }
            if sawSplit {
                XCTAssertTrue(split, "the split must not disappear as the container grows (\(width))")
            }
        }
        XCTAssertTrue(sawSplit, "the sweep must cover widths that do split")
    }

    func testAccessibilityTextSizesAlwaysUseOneColumn() {
        for width in sweep {
            XCTAssertFalse(
                PatientsWorkspaceLayout.usesSideBySide(containerWidth: width, isAccessibilitySize: true),
                "accessibility sizes must keep a single column (\(width))"
            )
        }
    }

    func testDegenerateContainerWidthsDoNotSplit() {
        for width: CGFloat in [0, -1, .nan, .infinity] {
            XCTAssertFalse(PatientsWorkspaceLayout.usesSideBySide(containerWidth: width, isAccessibilitySize: false))
        }
    }
}

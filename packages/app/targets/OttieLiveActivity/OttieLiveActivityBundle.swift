import SwiftUI
import WidgetKit

// Entry point for the Widget Extension target. Lists every widget the
// extension provides; today that's only the Live Activity. If we add a
// home-screen widget or lock-screen complication later, this bundle is
// where they get registered.

@main
struct OttieLiveActivityBundle: WidgetBundle {
    var body: some Widget {
        if #available(iOS 16.1, *) {
            OttieLiveActivityWidget()
        }
    }
}

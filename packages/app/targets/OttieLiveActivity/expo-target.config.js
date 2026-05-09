/** @type {import('@bacons/apple-targets').Config} */
module.exports = {
  type: "widget",
  // The Widget Extension also runs the Live Activity. iOS 16.1 is the minimum
  // SDK that ships ActivityKit; Dynamic Island specifically requires 16.2 on
  // iPhone 14 Pro / 15 Pro / 16 Pro hardware. Older devices still see the
  // Lock Screen Live Activity at 16.1+.
  deploymentTarget: "16.1",
  // SwiftUI + ActivityKit + WidgetKit are the only frameworks we need.
  frameworks: ["SwiftUI", "WidgetKit", "ActivityKit"],
};

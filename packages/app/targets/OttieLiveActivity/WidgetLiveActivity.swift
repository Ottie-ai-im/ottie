import ActivityKit
import SwiftUI
import WidgetKit

// SwiftUI presentation for the agent-running Live Activity.
//
// Three surfaces ship from a single `ActivityConfiguration`:
//   1. Lock Screen / Notification Center — the rectangular card iOS shows
//      when the device is locked or in the banner shade.
//   2. Dynamic Island compact — the lozenge to the left + right of the
//      camera cutout when nothing else is competing for the island.
//   3. Dynamic Island expanded — long-pressed island view with regions
//      (leading / trailing / center / bottom) that we lay out as a card.
//   4. Dynamic Island minimal — the tiny circle when multiple activities
//      stack and ours isn't the foreground one.
//
// All four share the same data: agentLabel + providerLabel (static),
// startedAt + status + toolCall (dynamic). System timer formatting handles
// the ticking duration so the widget doesn't get throttled by ActivityKit's
// frequency limits.

@available(iOS 16.1, *)
struct OttieLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AgentRunActivityAttributes.self) { context in
            // Lock Screen card.
            LockScreenView(context: context)
                .padding(16)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 6) {
                        statusIndicator(status: context.state.status)
                        Text(context.attributes.agentLabel)
                            .font(.headline)
                            .lineLimit(1)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if let started = parseStartedAt(context.state.startedAt) {
                        Text(started, style: .timer)
                            .font(.headline)
                            .monospacedDigit()
                            .frame(maxWidth: .infinity, alignment: .trailing)
                    }
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.attributes.providerLabel)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if let toolCall = context.state.toolCall, !toolCall.isEmpty {
                        Text(toolCall)
                            .font(.caption)
                            .lineLimit(1)
                            .truncationMode(.tail)
                            .foregroundStyle(.primary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            } compactLeading: {
                statusIndicator(status: context.state.status)
            } compactTrailing: {
                if let started = parseStartedAt(context.state.startedAt) {
                    Text(started, style: .timer)
                        .monospacedDigit()
                        .frame(maxWidth: 56)
                }
            } minimal: {
                statusIndicator(status: context.state.status)
            }
            // Tap target — opens the app. The deep link is handled by
            // expo-router via the existing `ottie://` scheme; concrete
            // routing comes when we wire push tap handling to agent
            // detail in a later iteration.
            .widgetURL(URL(string: "ottie://"))
            .keylineTint(.green)
        }
    }

    @ViewBuilder
    private func statusIndicator(status: String) -> some View {
        switch status {
        case "completed":
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.green)
        case "error":
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
        default:
            // Running — a subtle pulse + spinner. ProgressView in a tiny
            // frame yields the system spinner glyph.
            ProgressView()
                .progressViewStyle(.circular)
                .controlSize(.mini)
                .tint(.green)
        }
    }
}

@available(iOS 16.1, *)
private struct LockScreenView: View {
    let context: ActivityViewContext<AgentRunActivityAttributes>

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                statusIndicator(status: context.state.status)
                Text(context.attributes.agentLabel)
                    .font(.headline)
                    .lineLimit(1)
                Spacer()
                if let started = parseStartedAt(context.state.startedAt) {
                    Text(started, style: .timer)
                        .font(.subheadline)
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
            }
            Text(context.attributes.providerLabel)
                .font(.caption)
                .foregroundStyle(.secondary)
            if let toolCall = context.state.toolCall, !toolCall.isEmpty {
                Text(toolCall)
                    .font(.callout)
                    .lineLimit(2)
                    .truncationMode(.tail)
            }
        }
    }

    @ViewBuilder
    private func statusIndicator(status: String) -> some View {
        switch status {
        case "completed":
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.green)
                .imageScale(.medium)
        case "error":
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
                .imageScale(.medium)
        default:
            ProgressView()
                .progressViewStyle(.circular)
                .controlSize(.small)
                .tint(.green)
        }
    }
}

// ISO-8601 → Date so SwiftUI's `Text(_:style:.timer)` can take over the
// ticking. Returning `nil` on parse failure makes the timer view drop
// silently rather than crash the widget.
@available(iOS 16.1, *)
private func parseStartedAt(_ raw: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let parsed = formatter.date(from: raw) { return parsed }
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: raw)
}

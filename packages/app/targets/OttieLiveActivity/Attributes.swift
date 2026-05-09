import ActivityKit
import Foundation

// Static + dynamic attributes for the agent-running Live Activity. The static
// half is set when the Activity is requested and never changes; the dynamic
// `ContentState` is what we mutate on each WebSocket-driven update.
//
// JS side mirrors this shape in src/native/ottie-live-activity.ts. Keep the
// two definitions in lock-step — ActivityKit silently ignores updates whose
// keys don't match the registered struct.

@available(iOS 16.1, *)
public struct AgentRunActivityAttributes: ActivityAttributes {
    public typealias AgentRunStatus = ContentState

    // Updatable state (changes on every "update" call).
    public struct ContentState: Codable, Hashable {
        // ISO-8601 wall-clock timestamp. Used by the Lock Screen view to
        // render a system-managed timer ("started 1m 23s ago") so we don't
        // have to push tick-level updates from JS.
        public var startedAt: String

        // "running" | "completed" | "error". The widget renders different
        // visuals per status; declared as a string so additional states can
        // ship from JS without bumping a Swift enum.
        public var status: String

        // What the agent is doing right now: most-recent tool-call name like
        // "Editing src/agent.ts" or "Running tests". Optional — when nil the
        // widget shows the agent label only.
        public var toolCall: String?

        public init(startedAt: String, status: String, toolCall: String?) {
            self.startedAt = startedAt
            self.status = status
            self.toolCall = toolCall
        }
    }

    // Static (set at start, never changes during the activity).
    public var agentLabel: String
    public var providerLabel: String

    public init(agentLabel: String, providerLabel: String) {
        self.agentLabel = agentLabel
        self.providerLabel = providerLabel
    }
}

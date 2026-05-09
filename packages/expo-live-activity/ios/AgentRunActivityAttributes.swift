import ActivityKit
import Foundation

// Wire shape for the agent-running Live Activity.
//
// !!! IMPORTANT !!!
// This struct MUST stay byte-equivalent to
// `packages/app/targets/OttieLiveActivity/Attributes.swift` — the host app
// (this module) and the Widget Extension (the targets/ folder) sit in
// separate Swift modules, so they each carry their own copy of the type.
// ActivityKit serializes via Codable, which round-trips by property name
// regardless of declaring-module identity, so identical layouts are
// sufficient. Editing one without the other breaks updates silently.

@available(iOS 16.1, *)
public struct AgentRunActivityAttributes: ActivityAttributes {
    public typealias AgentRunStatus = ContentState

    public struct ContentState: Codable, Hashable {
        public var startedAt: String
        public var status: String
        public var toolCall: String?

        public init(startedAt: String, status: String, toolCall: String?) {
            self.startedAt = startedAt
            self.status = status
            self.toolCall = toolCall
        }
    }

    public var agentLabel: String
    public var providerLabel: String

    public init(agentLabel: String, providerLabel: String) {
        self.agentLabel = agentLabel
        self.providerLabel = providerLabel
    }
}

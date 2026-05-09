import ActivityKit
import ExpoModulesCore
import Foundation

// JS-facing bridge over ActivityKit. Three async functions:
//
//   startAgentRunActivity(start) -> activityId
//   updateAgentRunActivity(activityId, state)
//   endAgentRunActivity(activityId, finalState?, dismissAfterMs)
//
// All three are no-ops on iOS < 16.2 (return a coded error) and on
// platforms other than iOS (the module is iOS-only per
// expo-module.config.json so it's never reached on Android/web).
//
// We intentionally don't expose APNs push-to-update tokens. ottie's
// daemon already streams agent state over WebSocket, so the JS side
// drives updates in-process — keeps the daemon out of Apple's APNs auth
// flow and avoids the Live-Activity push token plumbing.

public class OttieLiveActivityModule: Module {
    // Map JS-facing activityId (we use the underlying Activity.id) to a
    // type-erased handle so update/end calls don't need to retain the
    // generic `Activity<T>` across the bridge boundary. This dictionary
    // lives only in memory; if the host app is killed the activities
    // continue running under iOS' management and reattach via
    // Activity<T>.activities on the next start. v1 doesn't bother
    // re-attaching — start a new one if the user expects fresh state.
    private var activeActivities: [String: Any] = [:]

    public func definition() -> ModuleDefinition {
        Name("OttieLiveActivity")

        AsyncFunction("isLiveActivitySupported") { () -> Bool in
            if #available(iOS 16.2, *) {
                return ActivityAuthorizationInfo().areActivitiesEnabled
            }
            return false
        }

        AsyncFunction("startAgentRunActivity") {
            (params: AgentRunStartParams, promise: Promise) in
            if #available(iOS 16.2, *) {
                guard ActivityAuthorizationInfo().areActivitiesEnabled else {
                    promise.reject(
                        "live_activity_disabled",
                        "User has disabled Live Activities for this app in Settings."
                    )
                    return
                }
                let attributes = AgentRunActivityAttributes(
                    agentLabel: params.agentLabel,
                    providerLabel: params.providerLabel
                )
                let initialState = AgentRunActivityAttributes.ContentState(
                    startedAt: params.startedAt,
                    status: params.status,
                    toolCall: params.toolCall
                )
                do {
                    let content = ActivityContent(state: initialState, staleDate: nil)
                    let activity = try Activity.request(
                        attributes: attributes,
                        content: content,
                        pushType: nil
                    )
                    self.activeActivities[activity.id] = activity
                    promise.resolve(activity.id)
                } catch {
                    promise.reject(
                        "live_activity_request_failed",
                        "ActivityKit refused to start the activity: \(error.localizedDescription)"
                    )
                }
            } else {
                promise.reject(
                    "unavailable_ios_version",
                    "Live Activities require iOS 16.2 or newer."
                )
            }
        }

        AsyncFunction("updateAgentRunActivity") {
            (params: AgentRunUpdateParams, promise: Promise) in
            if #available(iOS 16.2, *) {
                guard
                    let activity = self.activeActivities[params.activityId]
                        as? Activity<AgentRunActivityAttributes>
                else {
                    promise.reject(
                        "activity_not_found",
                        "No live activity with id \(params.activityId). Call start first."
                    )
                    return
                }
                let nextState = AgentRunActivityAttributes.ContentState(
                    startedAt: params.startedAt,
                    status: params.status,
                    toolCall: params.toolCall
                )
                Task {
                    let content = ActivityContent(state: nextState, staleDate: nil)
                    await activity.update(content)
                    promise.resolve(nil)
                }
            } else {
                promise.reject("unavailable_ios_version", "Live Activities require iOS 16.2+.")
            }
        }

        AsyncFunction("endAgentRunActivity") {
            (params: AgentRunEndParams, promise: Promise) in
            if #available(iOS 16.2, *) {
                guard
                    let activity = self.activeActivities[params.activityId]
                        as? Activity<AgentRunActivityAttributes>
                else {
                    // Already gone — treat as success so JS doesn't error
                    // on a redundant end call (e.g. duplicate state events).
                    promise.resolve(nil)
                    return
                }
                let finalState =
                    params.finalState.map {
                        AgentRunActivityAttributes.ContentState(
                            startedAt: $0.startedAt,
                            status: $0.status,
                            toolCall: $0.toolCall
                        )
                    } ?? activity.content.state
                let dismissalPolicy: ActivityUIDismissalPolicy
                if let afterMs = params.dismissAfterMs, afterMs > 0 {
                    dismissalPolicy = .after(
                        Date().addingTimeInterval(TimeInterval(afterMs) / 1000.0)
                    )
                } else {
                    dismissalPolicy = .immediate
                }
                Task {
                    let content = ActivityContent(state: finalState, staleDate: nil)
                    await activity.end(content, dismissalPolicy: dismissalPolicy)
                    self.activeActivities.removeValue(forKey: params.activityId)
                    promise.resolve(nil)
                }
            } else {
                promise.reject("unavailable_ios_version", "Live Activities require iOS 16.2+.")
            }
        }

        AsyncFunction("endAllAgentRunActivities") { (promise: Promise) in
            if #available(iOS 16.2, *) {
                Task {
                    for activity in Activity<AgentRunActivityAttributes>.activities {
                        await activity.end(nil, dismissalPolicy: .immediate)
                    }
                    self.activeActivities.removeAll()
                    promise.resolve(nil)
                }
            } else {
                promise.resolve(nil)
            }
        }
    }
}

// Records — Expo Modules API auto-generates the JS↔Swift codec from these.

struct AgentRunStartParams: Record {
    @Field var agentLabel: String = ""
    @Field var providerLabel: String = ""
    @Field var startedAt: String = ""
    @Field var status: String = "running"
    @Field var toolCall: String?
}

struct AgentRunUpdateParams: Record {
    @Field var activityId: String = ""
    @Field var startedAt: String = ""
    @Field var status: String = "running"
    @Field var toolCall: String?
}

struct AgentRunEndFinalState: Record {
    @Field var startedAt: String = ""
    @Field var status: String = "completed"
    @Field var toolCall: String?
}

struct AgentRunEndParams: Record {
    @Field var activityId: String = ""
    @Field var finalState: AgentRunEndFinalState?
    // How long iOS keeps the activity visible after we end it. 0 / nil =
    // immediate dismiss; > 0 keeps it visible for that many ms (capped
    // by iOS to ~4 seconds in practice).
    @Field var dismissAfterMs: Int?
}

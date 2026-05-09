import { EmptyHomeCard } from "@/screens/empty-home/empty-home-card";

// Empty-home is the unified entry point. It renders the morphing CTA card
// (new user / old user / pair / advanced) and never auto-redirects — once
// the user picks a path and completes it, the inner state machine routes
// to the appropriate place itself. The previous "welcomeShown && online →
// /" gate is gone because it produced the Skip loop where Skip with no
// host bounced back to the same screen.

export default function WelcomeRoute() {
  return <EmptyHomeCard />;
}

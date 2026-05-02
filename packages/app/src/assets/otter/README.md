# Otter Brand Assets (THM-04)

This directory centralizes all user-visible "Otter" (Ottie) brand assets.

## Sanctioned Surfaces

Per Requirement **THM-04**, the Otter character is permitted only on these five surfaces:

1. **Splash Overlay**: The `OttieLogo` shown during initial load/bootstrap.
2. **Welcome Screen**: The illustration shown to new users (cold open).
3. **First-Time Empty States**:
   - **Workspace**: Shown when no projects are added AND `emptyOttiePlayedFirstWorkspace` is false.
   - **Chats**: Shown when the chat list is empty AND `emptyOttiePlayedFirstChats` is false.
4. **Delight Toasts**: One-time acknowledgments for first-agent, first-permission, and first-voice.

## Usage

Always import from `otterAssets` in this folder. Do **not** import `OttieLogo` directly from icons if it is being used as a brand element.

```typescript
import { otterAssets } from "@/assets/otter";

// ...
<otterAssets.logo size={120} />
```

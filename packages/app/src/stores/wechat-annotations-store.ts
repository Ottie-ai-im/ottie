import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Per-message manual annotations the user types in for content the
 * automated pipeline can't (yet) extract — primarily voice messages
 * that surface as `[语音]` from wx-cli. Once annotated, the bubble
 * displays the user's text in place of the placeholder, and the AI
 * suggestion prompt sees the real content.
 *
 * Keyed by `(chatId, messageKey)` where messageKey comes from the
 * `messageKey()` helper exported by `wechat-context-view`. Local-only
 * (AsyncStorage); never shipped to the daemon, never sent to any
 * provider beyond what the suggestion prompt already sends.
 *
 * Storage layout — flat for fast read / write:
 *   {
 *     "wxid_abc123": {
 *       "lid-4567": "我下午两点能到",
 *       "lid-4569": "改时间也行"
 *     },
 *     ...
 *   }
 */
type ChatAnnotations = Record<string, string>;

interface WechatAnnotationsState {
  byChat: Record<string, ChatAnnotations>;
  setAnnotation: (chatId: string, messageKey: string, text: string) => void;
  clearAnnotation: (chatId: string, messageKey: string) => void;
}

export const useWechatAnnotationsStore = create<WechatAnnotationsState>()(
  persist(
    (set) => ({
      byChat: {},
      setAnnotation: (chatId, messageKey, text) =>
        set((state) => {
          const trimmed = text.trim();
          if (trimmed.length === 0) {
            return removeEntry(state, chatId, messageKey);
          }
          const existing = state.byChat[chatId];
          return {
            byChat: {
              ...state.byChat,
              [chatId]: existing
                ? { ...existing, [messageKey]: trimmed }
                : { [messageKey]: trimmed },
            },
          };
        }),
      clearAnnotation: (chatId, messageKey) =>
        set((state) => removeEntry(state, chatId, messageKey)),
    }),
    {
      name: "@ottie:wechat-annotations",
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
    },
  ),
);

function removeEntry(
  state: { byChat: Record<string, ChatAnnotations> },
  chatId: string,
  messageKey: string,
): Pick<WechatAnnotationsState, "byChat"> {
  const chat = state.byChat[chatId];
  if (!chat || !(messageKey in chat)) return { byChat: state.byChat };
  const nextChat: ChatAnnotations = { ...chat };
  delete nextChat[messageKey];
  if (Object.keys(nextChat).length === 0) {
    const nextByChat = { ...state.byChat };
    delete nextByChat[chatId];
    return { byChat: nextByChat };
  }
  return { byChat: { ...state.byChat, [chatId]: nextChat } };
}

/**
 * Selector for the annotation map of a single chat. Returns an empty
 * object when nothing's annotated so callers can `Record<string,
 * string>` without nullability dance.
 */
export function selectChatAnnotations(
  state: WechatAnnotationsState,
  chatId: string,
): ChatAnnotations {
  return state.byChat[chatId] ?? EMPTY_ANNOTATIONS;
}

const EMPTY_ANNOTATIONS: ChatAnnotations = Object.freeze({});

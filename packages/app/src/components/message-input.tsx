import {
  View,
  Text,
  TextInput,
  Platform,
  Pressable,
  ActivityIndicator,
  ScrollView,
  StyleSheet as RNStyleSheet,
  NativeSyntheticEvent,
  TextInputContentSizeChangeEventData,
  TextInputKeyPressEventData,
  TextInputSelectionChangeEventData,
} from "react-native";
import { BlurView } from "expo-blur";
import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  useMemo,
  forwardRef,
} from "react";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import {
  ArrowUp,
  Mic,
  MicOff,
  CornerDownLeft,
  Plus,
  Square,
  Clock,
  ChevronRight,
} from "lucide-react-native";
import { format, addDays, setHours, setMinutes } from "date-fns";
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from "react-native-reanimated";
import { useDictation } from "@/hooks/use-dictation";
import { DictationOverlay } from "./dictation-controls";
import { RealtimeVoiceOverlay } from "./realtime-voice-overlay";
import type { DaemonClient } from "@server/client/daemon-client";
import { useSessionStore } from "@/stores/session-store";
import { useVoiceOptional } from "@/contexts/voice-context";
import { useToast } from "@/contexts/toast-context";
import { resolveVoiceUnavailableMessage } from "@/utils/server-info-capabilities";
import {
  collectImageFilesFromClipboardData,
  filesToImageAttachments,
} from "@/utils/image-attachments-from-files";
import type { AttachmentMetadata } from "@/attachments/types";
import type { ComposerAttachment } from "@/attachments/types";
import { focusWithRetries } from "@/utils/web-focus";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Shortcut } from "@/components/ui/shortcut";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronLeft } from "lucide-react-native";
import { useWebElementScrollbar } from "@/components/use-web-scrollbar";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { useTranslation } from "react-i18next";
import { formatShortcut } from "@/utils/format-shortcut";
import { getShortcutOs } from "@/utils/shortcut-platform";
import type { MessageInputKeyboardActionKind } from "@/keyboard/actions";
import { isImeComposingKeyboardEvent } from "@/utils/keyboard-ime";
import { markScrollInvestigationEvent, markScrollInvestigationRender } from "@/utils/scroll-jank";
import { isNative, isWeb } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useComposerHeightMirror } from "./composer-height-mirror";

export type ImageAttachment = AttachmentMetadata;

export interface MessagePayload {
  text: string;
  attachments: ComposerAttachment[];
  cwd: string;
  /** When true, bypasses queue and sends immediately even if agent is running */
  forceSend?: boolean;
}

export interface AttachmentMenuItem {
  id: string;
  label: string;
  onSelect?: () => void;
  disabled?: boolean;
  icon?: React.ReactElement | null;
  /**
   * Optional nested entries. When provided (mobile only), tapping the item
   * descends into a second-level list inside the same dropdown sheet.
   * Desktop renders this as a flat list and ignores `children` — composer is
   * expected to pass flat items on desktop, grouped items on mobile.
   */
  children?: AttachmentMenuItem[];
}

export interface MessageInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: (payload: MessagePayload) => void;
  /** When true, the submit button is enabled even without text or images (e.g. external attachment selected). */
  hasExternalContent?: boolean;
  /** When true, the submit button stays visible and can submit even with no content. */
  allowEmptySubmit?: boolean;
  /** Optional accessibility label for the primary submit button. */
  submitButtonAccessibilityLabel?: string;
  submitIcon?: "arrow" | "return";
  isSubmitDisabled?: boolean;
  isSubmitLoading?: boolean;
  attachments: ComposerAttachment[];
  cwd: string;
  attachmentMenuItems: AttachmentMenuItem[];
  onAttachButtonRef?: (node: View | null) => void;
  onAddImages?: (images: ImageAttachment[]) => void;
  client: DaemonClient | null;
  /** Dictation start gate from host runtime (socket connected + directory ready). */
  isReadyForDictation?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  autoFocusKey?: string;
  disabled?: boolean;
  /** True when this composer's pane is focused. Used to gate global hotkeys and stop dictation when hidden. */
  isPaneFocused?: boolean;
  /** Content to render on the left side of the button row (e.g., AgentStatusBar) */
  leftContent?: React.ReactNode;
  /** Content to render on the right side before the voice button (e.g., context window meter) */
  beforeVoiceContent?: React.ReactNode;
  /** Content to render on the right side after voice button (e.g., realtime button, cancel button) */
  rightContent?: React.ReactNode;
  voiceServerId?: string;
  voiceAgentId?: string;
  /** When true and there's sendable content, calls onQueue instead of onSubmit */
  isAgentRunning?: boolean;
  /** Controls what the default send action (Enter, send button, dictation) does
   *  when the agent is running. "interrupt" sends immediately, "queue" queues. */
  defaultSendBehavior?: "interrupt" | "queue";
  /** Callback for queue button when agent is running */
  onQueue?: (payload: MessagePayload) => void;
  /** Optional handler used when submit button is in loading state. */
  onSubmitLoadingPress?: () => void;
  /** Intercept key press events before default handling. Return true to prevent default. */
  onKeyPress?: (event: { key: string; preventDefault: () => void }) => boolean;
  /** Reports cursor selection updates from the underlying input. */
  onSelectionChange?: (selection: { start: number; end: number }) => void;
  onFocusChange?: (focused: boolean) => void;
  onHeightChange?: (height: number) => void;
  /** Extra styles merged onto the input wrapper (e.g. elevated background). */
  inputWrapperStyle?: import("react-native").ViewStyle;
  /** Called when user schedules a message. */
  onSchedule?: (payload: MessagePayload, runAt: string) => void;
}

export interface MessageInputRef {
  focus: () => void;
  blur: () => void;
  runKeyboardAction: (action: MessageInputKeyboardActionKind) => boolean;
  /**
   * Web-only: return the underlying DOM element for focus assertions/retries.
   * May return null if not mounted or on native.
   */
  getNativeElement?: () => HTMLElement | null;
}

const MIN_INPUT_HEIGHT_MOBILE = 30;
const MIN_INPUT_HEIGHT_DESKTOP = 46;
const MAX_INPUT_HEIGHT = 160;
const MIN_INPUT_HEIGHT = isWeb ? MIN_INPUT_HEIGHT_DESKTOP : MIN_INPUT_HEIGHT_MOBILE;

type WebTextInputKeyPressEvent = NativeSyntheticEvent<
  TextInputKeyPressEventData & {
    metaKey?: boolean;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    // Web-only: present on DOM KeyboardEvent during IME composition (CJK input).
    isComposing?: boolean;
    keyCode?: number;
  }
>;

interface TextAreaHandle {
  scrollHeight?: number;
  clientHeight?: number;
  offsetHeight?: number;
  scrollTop?: number;
  selectionStart?: number | null;
  selectionEnd?: number | null;
  style?: {
    height?: string;
    overflowY?: string;
  } & Record<string, unknown>;
}

function logWebStickyBottom(_event: string, _details: Record<string, unknown>): void {
  // Intentionally disabled: this path is too noisy during voice debugging.
}

function getDebugNow(): number | null {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return Number(performance.now().toFixed(3));
  }
  return null;
}

function getElementDescriptor(element: HTMLElement | null): string | null {
  if (!element) return null;
  const tag = element.tagName?.toLowerCase() ?? "unknown";
  const id = element.id ? `#${element.id}` : "";
  const testId = element.getAttribute?.("data-testid");
  const label = element.getAttribute?.("aria-label");
  let suffix: string;
  if (testId) suffix = `[data-testid="${testId}"]`;
  else if (label) suffix = `[aria-label="${label}"]`;
  else suffix = "";
  return `${tag}${id}${suffix}`;
}

function AttachButtonIcon({
  hovered,
  onAttachButtonRef,
  buttonIconSize,
  foreground,
  foregroundMuted,
}: {
  hovered: boolean;
  onAttachButtonRef: ((node: View | null) => void) | undefined;
  buttonIconSize: number;
  foreground: string;
  foregroundMuted: string;
}) {
  return (
    <View ref={onAttachButtonRef} collapsable={false} style={styles.attachButtonAnchor}>
      <Plus size={buttonIconSize} color={hovered ? foreground : foregroundMuted} />
    </View>
  );
}

function AttachmentMenuGroupItem({
  item,
  onSelectGroup,
}: {
  item: AttachmentMenuItem;
  onSelectGroup: (id: string) => void;
}) {
  const { theme } = useUnistyles();
  const handleSelect = useCallback(() => onSelectGroup(item.id), [onSelectGroup, item.id]);
  const trailingIcon = useMemo(
    () => <ChevronRight size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />,
    [theme.iconSize.sm, theme.colors.foregroundMuted],
  );
  return (
    <DropdownMenuItem
      testID={`message-input-attachment-menu-group-${item.id}`}
      disabled={item.disabled}
      onSelect={handleSelect}
      leading={item.icon ?? null}
      trailing={trailingIcon}
      closeOnSelect={false}
    >
      {item.label}
    </DropdownMenuItem>
  );
}

function AttachmentMenuList({ items }: { items: AttachmentMenuItem[] }) {
  const { theme } = useUnistyles();
  const hasNestedItems = useMemo(
    () => items.some((item) => Array.isArray(item.children) && item.children.length > 0),
    [items],
  );
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);

  // Reset to top level whenever the items list itself changes (menu reopen).
  useEffect(() => {
    setActiveGroupId(null);
  }, [items]);

  const handleBack = useCallback(() => setActiveGroupId(null), []);
  const backLeading = useMemo(
    () => <ChevronLeft size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />,
    [theme.iconSize.sm, theme.colors.foregroundMuted],
  );

  if (!hasNestedItems) {
    return (
      <>
        {items.map((item) => (
          <DropdownMenuItem
            key={item.id}
            testID={`message-input-attachment-menu-item-${item.id}`}
            disabled={item.disabled}
            onSelect={item.onSelect}
            leading={item.icon ?? null}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </>
    );
  }

  if (activeGroupId !== null) {
    const activeGroup = items.find((item) => item.id === activeGroupId);
    const children = activeGroup?.children ?? [];
    return (
      <>
        <DropdownMenuItem
          testID="message-input-attachment-menu-back"
          onSelect={handleBack}
          leading={backLeading}
          closeOnSelect={false}
        >
          {activeGroup?.label ?? ""}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {children.map((child) => (
          <DropdownMenuItem
            key={child.id}
            testID={`message-input-attachment-menu-item-${child.id}`}
            disabled={child.disabled}
            onSelect={child.onSelect}
            leading={child.icon ?? null}
          >
            {child.label}
          </DropdownMenuItem>
        ))}
      </>
    );
  }

  return (
    <>
      {items.map((item) => {
        const hasChildren = Array.isArray(item.children) && item.children.length > 0;
        if (hasChildren) {
          return (
            <AttachmentMenuGroupItem key={item.id} item={item} onSelectGroup={setActiveGroupId} />
          );
        }
        return (
          <DropdownMenuItem
            key={item.id}
            testID={`message-input-attachment-menu-item-${item.id}`}
            disabled={item.disabled}
            onSelect={item.onSelect}
            leading={item.icon ?? null}
          >
            {item.label}
          </DropdownMenuItem>
        );
      })}
    </>
  );
}

function AttachmentDropdown({
  isConnected,
  disabled,
  attachButtonStyle,
  renderAttachButtonIcon,
  attachmentMenuItems,
}: {
  isConnected: boolean;
  disabled: boolean;
  attachButtonStyle: React.ComponentProps<typeof DropdownMenuTrigger>["style"];
  renderAttachButtonIcon: (input: { hovered?: boolean }) => React.ReactElement;
  attachmentMenuItems: AttachmentMenuItem[];
}) {
  return (
    <DropdownMenu>
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            disabled={!isConnected || disabled}
            accessibilityLabel="Add attachment"
            accessibilityRole="button"
            testID="message-input-attach-button"
            style={attachButtonStyle}
          >
            {renderAttachButtonIcon}
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <Text style={styles.tooltipText}>Add attachment</Text>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        side="top"
        align="start"
        offset={8}
        minWidth={220}
        testID="message-input-attachment-menu"
      >
        <AttachmentMenuList items={attachmentMenuItems} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function VoiceButtonIcon({
  hovered,
  isDictating,
  isMutedRealtime,
  buttonIconSize,
  foreground,
  foregroundMuted,
}: {
  hovered: boolean;
  isDictating: boolean;
  isMutedRealtime: boolean;
  buttonIconSize: number;
  foreground: string;
  foregroundMuted: string;
}) {
  if (isDictating) {
    return <Square size={buttonIconSize} color="white" fill="white" />;
  }
  if (isMutedRealtime) {
    return <MicOff size={buttonIconSize} color={hovered ? foreground : foregroundMuted} />;
  }
  return <Mic size={buttonIconSize} color={hovered ? foreground : foregroundMuted} />;
}

type ShortcutChord = NonNullable<React.ComponentProps<typeof Shortcut>["chord"]>;

function VoiceTooltipBody({
  voiceTooltipText,
  shortcut,
}: {
  voiceTooltipText: string;
  shortcut: ShortcutChord | null | undefined;
}) {
  return (
    <View style={styles.tooltipRow}>
      <Text style={styles.tooltipText}>{voiceTooltipText}</Text>
      {shortcut ? <Shortcut chord={shortcut} style={styles.tooltipShortcut} /> : null}
    </View>
  );
}

function SendTooltipBody({
  label,
  sendKeys,
}: {
  label: string;
  sendKeys: ShortcutChord | null | undefined;
}) {
  return (
    <View style={styles.tooltipRow}>
      <Text style={styles.tooltipText}>{label}</Text>
      {sendKeys ? <Shortcut chord={sendKeys} style={styles.tooltipShortcut} /> : null}
    </View>
  );
}

function SendButtonContent({
  isSubmitLoading,
  submitIcon,
  buttonIconSize,
}: {
  isSubmitLoading: boolean;
  submitIcon: "arrow" | "return";
  buttonIconSize: number;
}) {
  if (isSubmitLoading) {
    return <ActivityIndicator size="small" color="white" />;
  }
  if (submitIcon === "return") {
    return <CornerDownLeft size={buttonIconSize} color="white" />;
  }
  return <ArrowUp size={buttonIconSize} color="white" />;
}

function resolveSubmitAccessibilityLabel(input: {
  submitButtonAccessibilityLabel: string | undefined;
  canPressLoadingButton: boolean;
  defaultActionQueues: boolean;
  isAgentRunning: boolean;
}): string {
  if (input.submitButtonAccessibilityLabel) return input.submitButtonAccessibilityLabel;
  if (input.canPressLoadingButton) return "Interrupt agent";
  if (input.defaultActionQueues) return "Queue message";
  if (input.isAgentRunning) return "Send and interrupt";
  return "Send message";
}

function resolveVoiceAccessibilityLabel(input: {
  isRealtimeVoiceForCurrentAgent: boolean;
  isMuted: boolean;
  isDictating: boolean;
}): string {
  if (input.isRealtimeVoiceForCurrentAgent) {
    return input.isMuted ? "Unmute Voice mode" : "Mute Voice mode";
  }
  if (input.isDictating) return "Stop dictation";
  return "Start dictation";
}

function resolveVoiceTooltipText(input: {
  isRealtimeVoiceForCurrentAgent: boolean;
  isMuted: boolean;
}): string {
  if (input.isRealtimeVoiceForCurrentAgent) {
    return input.isMuted ? "Unmute voice" : "Mute voice";
  }
  return "Dictation";
}

function resolveSendTooltipLabel(input: {
  submitButtonAccessibilityLabel: string | undefined;
  defaultActionQueues: boolean;
}): string {
  if (input.submitButtonAccessibilityLabel) return input.submitButtonAccessibilityLabel;
  return input.defaultActionQueues ? "Queue" : "Send";
}

interface DesktopKeyPressContext {
  investigationComponentId: string;
  onKeyPressCallback: ((event: { key: string; preventDefault: () => void }) => boolean) | undefined;
  isAgentRunning: boolean;
  onQueue: ((payload: MessagePayload) => void) | undefined;
  isSubmitDisabled: boolean;
  isSubmitLoading: boolean;
  disabled: boolean;
  handleAlternateSendAction: () => void;
  handleDefaultSendAction: () => void;
}

function handleDesktopKeyPressImpl(
  event: WebTextInputKeyPressEvent,
  ctx: DesktopKeyPressContext,
): void {
  markScrollInvestigationEvent(ctx.investigationComponentId, "keyPress");

  if (isImeComposingKeyboardEvent(event.nativeEvent)) return;

  if (ctx.onKeyPressCallback) {
    const handled = ctx.onKeyPressCallback({
      key: event.nativeEvent.key,
      preventDefault: () => event.preventDefault(),
    });
    if (handled) return;
  }

  const { shiftKey, metaKey, ctrlKey } = event.nativeEvent;

  if (event.nativeEvent.key !== "Enter") return;
  if (shiftKey) return;

  if ((metaKey || ctrlKey) && ctx.isAgentRunning && ctx.onQueue) {
    if (ctx.isSubmitDisabled || ctx.isSubmitLoading || ctx.disabled) return;
    event.preventDefault();
    ctx.handleAlternateSendAction();
    return;
  }

  if (ctx.isSubmitDisabled || ctx.isSubmitLoading || ctx.disabled) return;
  event.preventDefault();
  ctx.handleDefaultSendAction();
}

interface KeyboardActionHandlers {
  textInputRef: React.MutableRefObject<
    TextInput | (TextInput & { getNativeRef?: () => unknown }) | null
  >;
  isDictatingRef: React.MutableRefObject<boolean>;
  sendAfterTranscriptRef: React.MutableRefObject<boolean>;
  confirmDictation: () => void | Promise<void>;
  cancelDictation: () => void | Promise<void>;
  startDictationIfAvailable: () => Promise<void>;
  handleToggleRealtimeVoiceShortcut: () => void;
  isRealtimeVoiceForCurrentAgent: boolean;
  voice: { toggleMute: () => void } | null | undefined;
}

function runKeyboardActionImpl(
  action: MessageInputKeyboardActionKind,
  h: KeyboardActionHandlers,
): boolean {
  if (action === "focus") {
    h.textInputRef.current?.focus();
    return true;
  }
  if (action === "send" || action === "dictation-confirm") {
    if (h.isDictatingRef.current) {
      h.sendAfterTranscriptRef.current = true;
      void h.confirmDictation();
      return true;
    }
    return false;
  }
  if (action === "voice-toggle") {
    h.handleToggleRealtimeVoiceShortcut();
    return true;
  }
  if (action === "voice-mute-toggle") {
    if (h.isRealtimeVoiceForCurrentAgent) {
      h.voice?.toggleMute();
    }
    return true;
  }
  if (action === "dictation-cancel") {
    if (h.isDictatingRef.current) {
      void h.cancelDictation();
      return true;
    }
    return false;
  }
  if (action === "dictation-toggle") {
    if (h.isDictatingRef.current) {
      h.sendAfterTranscriptRef.current = true;
      void h.confirmDictation();
    } else {
      void h.startDictationIfAvailable();
    }
    return true;
  }
  return false;
}

function getTextInputNativeElement(
  current: TextInput | (TextInput & { getNativeRef?: () => unknown }) | null,
): HTMLElement | null {
  if (!current) return null;
  const handle = current as TextInput & { getNativeRef?: () => unknown };
  const native = typeof handle.getNativeRef === "function" ? handle.getNativeRef() : current;
  return native instanceof HTMLElement ? native : null;
}

interface PasteImagesEffectArgs {
  getWebTextArea: () => TextAreaHandle | null;
  isConnected: boolean;
  disabled: boolean;
  isDictating: boolean;
  isRealtimeVoiceForCurrentAgent: boolean;
  onAddImages: ((images: ImageAttachment[]) => void) | undefined;
}

function usePasteImagesEffect(args: PasteImagesEffectArgs): void {
  const {
    getWebTextArea,
    isConnected,
    disabled,
    isDictating,
    isRealtimeVoiceForCurrentAgent,
    onAddImages,
  } = args;

  useEffect(() => {
    if (!isWeb || !onAddImages) return;

    const textarea = getWebTextArea() as
      | (TextAreaHandle & {
          addEventListener?: (type: string, listener: (e: ClipboardEvent) => void) => void;
          removeEventListener?: (type: string, listener: (e: ClipboardEvent) => void) => void;
        })
      | null;
    if (
      !textarea ||
      typeof textarea.addEventListener !== "function" ||
      typeof textarea.removeEventListener !== "function"
    ) {
      return;
    }

    let disposed = false;
    const handlePaste = (event: ClipboardEvent) => {
      if (!isConnected || disabled || isDictating || isRealtimeVoiceForCurrentAgent) return;

      const imageFiles = collectImageFilesFromClipboardData(event.clipboardData);
      if (imageFiles.length === 0) return;

      event.preventDefault();

      void filesToImageAttachments(imageFiles)
        .then((pastedAttachments) => {
          if (disposed || pastedAttachments.length === 0) return;
          onAddImages(pastedAttachments);
          return;
        })
        .catch((error) => {
          console.error("[MessageInput] Failed to process pasted images:", error);
        });
    };

    textarea.addEventListener("paste", handlePaste);
    return () => {
      disposed = true;
      textarea.removeEventListener?.("paste", handlePaste);
    };
  }, [
    disabled,
    getWebTextArea,
    isConnected,
    isDictating,
    isRealtimeVoiceForCurrentAgent,
    onAddImages,
  ]);
}

interface ResizeObserverEffectArgs {
  getWebTextArea: () => TextAreaHandle | null;
  getWebElement: (target: "root" | "wrapper") => HTMLElement | null;
  valueRef: React.MutableRefObject<string>;
}

function useComposerResizeObserverEffect(args: ResizeObserverEffectArgs): void {
  const { getWebTextArea, getWebElement, valueRef } = args;

  useEffect(() => {
    if (!isWeb || typeof ResizeObserver === "undefined") return;

    const textarea = getWebTextArea();
    const root = getWebElement("root");
    const wrapper = getWebElement("wrapper");
    const observed = [
      { name: "composer_root", element: root },
      { name: "composer_wrapper", element: wrapper },
      { name: "composer_textarea", element: textarea as unknown as HTMLElement | null },
    ].filter(
      (entry): entry is { name: string; element: HTMLElement } =>
        entry.element instanceof HTMLElement,
    );

    if (observed.length === 0) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const target = entry.target as HTMLElement;
        const match = observed.find((item) => item.element === target);
        if (!match) continue;
        const textareaNode = getWebTextArea();
        logWebStickyBottom("composer_element_resized", {
          target: match.name,
          width: target.clientWidth,
          height: target.clientHeight,
          offsetHeight: target.offsetHeight,
          scrollHeight: target.scrollHeight,
          textareaClientHeight: textareaNode?.clientHeight ?? null,
          textareaOffsetHeight: textareaNode?.offsetHeight ?? null,
          textareaScrollHeight: textareaNode?.scrollHeight ?? null,
          textareaScrollTop:
            (textareaNode as unknown as HTMLTextAreaElement | null)?.scrollTop ?? null,
          valueLength: valueRef.current.length,
        });
      }
    });

    for (const entry of observed) {
      observer.observe(entry.element);
    }

    return () => {
      observer.disconnect();
    };
  }, [getWebElement, getWebTextArea, valueRef]);
}

interface ScrollLogEffectArgs {
  getWebTextArea: () => TextAreaHandle | null;
  valueRef: React.MutableRefObject<string>;
}

function useComposerScrollLogEffect(args: ScrollLogEffectArgs): void {
  const { getWebTextArea, valueRef } = args;

  useEffect(() => {
    if (!isWeb) return;
    const textarea = getWebTextArea() as (HTMLTextAreaElement & TextAreaHandle) | null;
    if (!textarea || typeof textarea.addEventListener !== "function") return;

    const handleScroll = () => {
      const textareaElement = textarea as unknown as HTMLElement;
      const chatScroller =
        typeof document !== "undefined"
          ? (document.querySelector('[data-testid="agent-chat-scroll"]') as HTMLElement | null)
          : null;
      logWebStickyBottom("composer_textarea_scrolled", {
        now: getDebugNow(),
        scrollTop: textarea.scrollTop,
        clientHeight: textarea.clientHeight ?? null,
        scrollHeight: textarea.scrollHeight ?? null,
        selectionStart: textarea.selectionStart ?? null,
        selectionEnd: textarea.selectionEnd ?? null,
        textareaDescriptor: getElementDescriptor(textareaElement),
        chatScrollerDescriptor: getElementDescriptor(chatScroller),
        chatScrollerContainsTextarea: Boolean(
          chatScroller && textareaElement && chatScroller.contains(textareaElement),
        ),
        textareaScrollableAncestors: getScrollableAncestorChain(textareaElement),
        valueLength: valueRef.current.length,
      });
    };

    textarea.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      textarea.removeEventListener("scroll", handleScroll);
    };
  }, [getWebTextArea, valueRef]);
}

function useAutoFocusOnWebEffect(
  textInputRef: React.MutableRefObject<
    TextInput | (TextInput & { getNativeRef?: () => unknown }) | null
  >,
  autoFocus: boolean,
  autoFocusKey: string | undefined,
): void {
  useEffect(() => {
    if (!isWeb || !autoFocus) return;
    return focusWithRetries({
      focus: () => textInputRef.current?.focus(),
      isFocused: () => {
        const element = getTextInputNativeElement(textInputRef.current);
        const active = typeof document !== "undefined" ? document.activeElement : null;
        return Boolean(element) && active === element;
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus, autoFocusKey]);
}

function MessageInputOverlay({
  showDictationOverlay,
  showRealtimeOverlay,
  voice,
  dictationVolume,
  dictationDuration,
  isDictating,
  isDictationProcessing,
  dictationStatus,
  dictationError,
  onCancelRecording,
  onAcceptRecording,
  onAcceptAndSendRecording,
  onRetryFailedRecording,
  onDiscardFailedRecording,
  onRealtimeVoiceStop,
}: {
  showDictationOverlay: boolean;
  showRealtimeOverlay: boolean;
  voice:
    | {
        isMuted: boolean;
        isVoiceSwitching: boolean;
        toggleMute: () => void;
      }
    | null
    | undefined;
  dictationVolume: number;
  dictationDuration: number;
  isDictating: boolean;
  isDictationProcessing: boolean;
  dictationStatus: React.ComponentProps<typeof DictationOverlay>["status"];
  dictationError: string | null;
  onCancelRecording: () => Promise<void>;
  onAcceptRecording: () => Promise<void>;
  onAcceptAndSendRecording: () => Promise<void>;
  onRetryFailedRecording: () => void;
  onDiscardFailedRecording: () => void;
  onRealtimeVoiceStop: () => void;
}) {
  if (showDictationOverlay) {
    return (
      <DictationOverlay
        volume={dictationVolume}
        duration={dictationDuration}
        isRecording={isDictating}
        isProcessing={isDictationProcessing}
        status={dictationStatus}
        errorText={dictationStatus === "failed" ? (dictationError ?? undefined) : undefined}
        onCancel={onCancelRecording}
        onAccept={onAcceptRecording}
        onAcceptAndSend={onAcceptAndSendRecording}
        onRetry={dictationStatus === "failed" ? onRetryFailedRecording : undefined}
        onDiscard={dictationStatus === "failed" ? onDiscardFailedRecording : undefined}
      />
    );
  }
  if (showRealtimeOverlay && voice) {
    return (
      <RealtimeVoiceOverlay
        isMuted={voice.isMuted}
        isSwitching={voice.isVoiceSwitching}
        onToggleMute={voice.toggleMute}
        onStop={onRealtimeVoiceStop}
      />
    );
  }
  return null;
}

function FocusHint({
  visible,
  focusInputKeys,
}: {
  visible: boolean;
  focusInputKeys: ShortcutChord | null | undefined;
}) {
  if (!visible || !focusInputKeys) return null;
  return (
    <Text style={styles.focusHintText} pointerEvents="none">
      {formatShortcut(focusInputKeys[0], getShortcutOs())} to focus
    </Text>
  );
}

function VoiceButtonTooltip({
  onVoicePress,
  isDictationStartEnabled,
  voiceButtonAccessibilityLabel,
  voiceButtonStyle,
  renderVoiceButtonIcon,
  voiceTooltipText,
  isRealtimeVoiceForCurrentAgent,
  voiceMuteToggleKeys,
  dictationToggleKeys,
}: {
  onVoicePress: () => void;
  isDictationStartEnabled: boolean;
  voiceButtonAccessibilityLabel: string;
  voiceButtonStyle: React.ComponentProps<typeof TooltipTrigger>["style"];
  renderVoiceButtonIcon: (input: { hovered?: boolean }) => React.ReactElement;
  voiceTooltipText: string;
  isRealtimeVoiceForCurrentAgent: boolean;
  voiceMuteToggleKeys: ShortcutChord | null | undefined;
  dictationToggleKeys: ShortcutChord | null | undefined;
}) {
  const shortcut = isRealtimeVoiceForCurrentAgent ? voiceMuteToggleKeys : dictationToggleKeys;
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        onPress={onVoicePress}
        disabled={!isDictationStartEnabled}
        accessibilityRole="button"
        accessibilityLabel={voiceButtonAccessibilityLabel}
        style={voiceButtonStyle}
      >
        {renderVoiceButtonIcon}
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <VoiceTooltipBody voiceTooltipText={voiceTooltipText} shortcut={shortcut} />
      </TooltipContent>
    </Tooltip>
  );
}

function SendButtonTooltip({
  shouldShow,
  canPressLoadingButton,
  onSubmitLoadingPress,
  onDefaultSendAction,
  isSendButtonDisabled,
  submitAccessibilityLabel,
  sendButtonCombinedStyle,
  isSubmitLoading,
  submitIcon,
  buttonIconSize,
  submitButtonAccessibilityLabel,
  defaultActionQueues,
  sendKeys,
}: {
  shouldShow: boolean;
  canPressLoadingButton: boolean;
  onSubmitLoadingPress: (() => void) | undefined;
  onDefaultSendAction: () => void;
  isSendButtonDisabled: boolean;
  submitAccessibilityLabel: string;
  sendButtonCombinedStyle: React.ComponentProps<typeof TooltipTrigger>["style"];
  isSubmitLoading: boolean;
  submitIcon: "arrow" | "return";
  buttonIconSize: number;
  submitButtonAccessibilityLabel: string | undefined;
  defaultActionQueues: boolean;
  sendKeys: ShortcutChord | null | undefined;
}) {
  if (!shouldShow) return null;
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        onPress={canPressLoadingButton ? onSubmitLoadingPress : onDefaultSendAction}
        disabled={isSendButtonDisabled}
        accessibilityLabel={submitAccessibilityLabel}
        accessibilityRole="button"
        style={sendButtonCombinedStyle}
      >
        <SendButtonContent
          isSubmitLoading={isSubmitLoading}
          submitIcon={submitIcon}
          buttonIconSize={buttonIconSize}
        />
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <SendTooltipBody
          label={resolveSendTooltipLabel({ submitButtonAccessibilityLabel, defaultActionQueues })}
          sendKeys={sendKeys}
        />
      </TooltipContent>
    </Tooltip>
  );
}

interface DictationTranscriptContext {
  value: string;
  defaultSendBehavior: "interrupt" | "queue";
  isAgentRunning: boolean;
  onQueue: ((payload: MessagePayload) => void) | undefined;
  onSubmit: (payload: MessagePayload) => void;
  onChangeText: (text: string) => void;
  attachments: ComposerAttachment[];
  cwd: string;
  autoSend: boolean;
}

function applyDictationTranscript(text: string, ctx: DictationTranscriptContext): void {
  if (!text) return;
  const shouldPad = ctx.value.length > 0 && !/\s$/.test(ctx.value);
  const nextValue = `${ctx.value}${shouldPad ? " " : ""}${text}`;

  if (!ctx.autoSend) {
    ctx.onChangeText(nextValue);
    return;
  }

  if (ctx.defaultSendBehavior === "queue" && ctx.isAgentRunning && ctx.onQueue) {
    ctx.onQueue({ text: nextValue, attachments: ctx.attachments, cwd: ctx.cwd });
    ctx.onChangeText("");
    return;
  }

  ctx.onSubmit({
    text: nextValue,
    attachments: ctx.attachments,
    cwd: ctx.cwd,
    forceSend: ctx.isAgentRunning || undefined,
  });
}

interface ToggleRealtimeVoiceContext {
  voice:
    | {
        isVoiceSwitching: boolean;
        isVoiceModeForAgent: (serverId: string, agentId: string) => boolean;
        startVoice: (serverId: string, agentId: string) => Promise<unknown>;
      }
    | null
    | undefined;
  voiceServerId: string | undefined;
  voiceAgentId: string | undefined;
  isConnected: boolean;
  disabled: boolean;
  handleStopRealtimeVoice: () => Promise<unknown> | void;
  toast: { error: (msg: string) => void };
}

function toggleRealtimeVoiceImpl(ctx: ToggleRealtimeVoiceContext): void {
  if (!ctx.voice || !ctx.voiceServerId || !ctx.voiceAgentId || !ctx.isConnected || ctx.disabled) {
    return;
  }
  if (ctx.voice.isVoiceSwitching) return;
  if (ctx.voice.isVoiceModeForAgent(ctx.voiceServerId, ctx.voiceAgentId)) {
    void ctx.handleStopRealtimeVoice();
    return;
  }
  void ctx.voice.startVoice(ctx.voiceServerId, ctx.voiceAgentId).catch((error) => {
    console.error("[MessageInput] Failed to start realtime voice", error);
    const message = extractErrorMessage(error);
    if (message && message.trim().length > 0) {
      ctx.toast.error(message);
    }
  });
}

interface StartDictationContext {
  dictationUnavailableMessage: string | null | undefined;
  canStartDictation: () => boolean;
  isDictatingRef: React.MutableRefObject<boolean>;
  toast: { error: (msg: string) => void };
  startDictation: () => Promise<void>;
}

async function startDictationIfAvailableImpl(ctx: StartDictationContext): Promise<void> {
  if (ctx.dictationUnavailableMessage) {
    ctx.isDictatingRef.current = false;
    ctx.toast.error(ctx.dictationUnavailableMessage);
    return;
  }
  if (!ctx.canStartDictation()) {
    ctx.isDictatingRef.current = false;
    return;
  }
  ctx.isDictatingRef.current = true;
  await ctx.startDictation();
}

interface StopRealtimeVoiceContext {
  voice: { stopVoice: () => Promise<unknown> } | null | undefined;
  isRealtimeVoiceForCurrentAgent: boolean;
  isAgentRunning: boolean;
  client: { cancelAgent: (agentId: string) => Promise<unknown> } | null;
  voiceAgentId: string | undefined;
}

async function stopRealtimeVoiceImpl(ctx: StopRealtimeVoiceContext): Promise<void> {
  if (!ctx.voice || !ctx.isRealtimeVoiceForCurrentAgent) return;

  const tasks: Promise<unknown>[] = [];
  if (ctx.isAgentRunning && ctx.client && ctx.voiceAgentId) {
    tasks.push(ctx.client.cancelAgent(ctx.voiceAgentId));
  }
  tasks.push(ctx.voice.stopVoice());

  const results = await Promise.allSettled(tasks);
  results.forEach((result) => {
    if (result.status === "rejected") {
      console.error("[MessageInput] Failed to stop realtime voice", result.reason);
    }
  });
}

interface VoicePressContext {
  isRealtimeVoiceForCurrentAgent: boolean;
  voice: { toggleMute: () => void } | null | undefined;
  isDictating: boolean;
  cancelDictation: () => Promise<void> | void;
  startDictationIfAvailable: () => Promise<void>;
}

async function handleVoicePressImpl(ctx: VoicePressContext): Promise<void> {
  if (ctx.isRealtimeVoiceForCurrentAgent && ctx.voice) {
    ctx.voice.toggleMute();
    return;
  }
  if (ctx.isDictating) {
    await ctx.cancelDictation();
    return;
  }
  await ctx.startDictationIfAvailable();
}

interface SendMessageContext {
  value: string;
  attachments: ComposerAttachment[];
  hasExternalContent: boolean;
  allowEmptySubmit: boolean;
  cwd: string;
  isAgentRunning: boolean;
  onSubmit: (payload: MessagePayload) => void;
  onMinimizeHeight: () => void;
}

function sendMessageImpl(ctx: SendMessageContext): void {
  const trimmed = ctx.value.trim();
  if (
    !trimmed &&
    ctx.attachments.length === 0 &&
    !ctx.hasExternalContent &&
    !ctx.allowEmptySubmit
  ) {
    return;
  }
  ctx.onSubmit({
    text: trimmed,
    attachments: ctx.attachments,
    cwd: ctx.cwd,
    forceSend: ctx.isAgentRunning || undefined,
  });
  ctx.onMinimizeHeight();
}

interface QueueMessageContext {
  value: string;
  attachments: ComposerAttachment[];
  cwd: string;
  onQueue: ((payload: MessagePayload) => void) | undefined;
  onChangeText: (text: string) => void;
  onMinimizeHeight: () => void;
}

function queueMessageImpl(ctx: QueueMessageContext): void {
  if (!ctx.onQueue) return;
  const trimmed = ctx.value.trim();
  if (!trimmed && ctx.attachments.length === 0) return;
  ctx.onQueue({ text: trimmed, attachments: ctx.attachments, cwd: ctx.cwd });
  ctx.onChangeText("");
  ctx.onMinimizeHeight();
}

function computeInvestigationComponentId(
  voiceServerId: string | undefined,
  voiceAgentId: string | undefined,
): string {
  return `MessageInput:${voiceServerId ?? "unknown-server"}:${voiceAgentId ?? "unknown-agent"}`;
}

function computeIsRealtimeVoiceForAgent(
  voice: { isVoiceModeForAgent: (serverId: string, agentId: string) => boolean } | null | undefined,
  voiceServerId: string | undefined,
  voiceAgentId: string | undefined,
): boolean {
  if (!voice || !voiceServerId || !voiceAgentId) return false;
  return voice.isVoiceModeForAgent(voiceServerId, voiceAgentId);
}

function computeShouldShowDictationOverlay(
  isDictating: boolean,
  isDictationProcessing: boolean,
  dictationStatus: string,
): boolean {
  return isDictating || isDictationProcessing || dictationStatus === "failed";
}

interface SendableContentInput {
  value: string;
  attachments: ComposerAttachment[];
  hasExternalContent: boolean;
  allowEmptySubmit: boolean;
  isSubmitLoading: boolean;
}

interface SendableContentOutput {
  hasAttachments: boolean;
  hasRealContent: boolean;
  hasSendableContent: boolean;
  shouldShowSendButton: boolean;
}

function computeSendableContent(input: SendableContentInput): SendableContentOutput {
  const hasAttachments = input.attachments.length > 0;
  const hasRealContent = input.value.trim().length > 0 || hasAttachments;
  const hasSendableContent = hasRealContent || input.hasExternalContent;
  const shouldShowSendButton =
    hasSendableContent || input.allowEmptySubmit || input.isSubmitLoading;
  return { hasAttachments, hasRealContent, hasSendableContent, shouldShowSendButton };
}

function computeCanStartDictation(input: {
  client: DaemonClient | null;
  isReadyForDictation: boolean | undefined;
  disabled: boolean;
  dictationUnavailableMessage: string | null | undefined;
}): boolean {
  const socketConnected = input.client?.isConnected ?? false;
  const readyForDictation = input.isReadyForDictation ?? socketConnected;
  return (
    socketConnected && readyForDictation && !input.disabled && !input.dictationUnavailableMessage
  );
}

function computeIsDictationStartEnabled(
  isReadyForDictation: boolean | undefined,
  isConnected: boolean,
  disabled: boolean,
): boolean {
  return (isReadyForDictation ?? isConnected) && !disabled;
}

function computeTextInputHeightStyle(inputHeight: number) {
  if (isWeb) {
    return {
      height: inputHeight,
      minHeight: MIN_INPUT_HEIGHT,
      maxHeight: MAX_INPUT_HEIGHT,
    };
  }
  return {
    minHeight: MIN_INPUT_HEIGHT,
    maxHeight: MAX_INPUT_HEIGHT,
  };
}

function isTextAreaLike(v: unknown): v is TextAreaHandle {
  return typeof v === "object" && v !== null && "scrollHeight" in v;
}

function getWebTextAreaImpl(
  current: TextInput | (TextInput & { getNativeRef?: () => unknown }) | null,
): TextAreaHandle | null {
  if (!current) return null;
  const candidate = current as { getNativeRef?: () => unknown };
  if (typeof candidate.getNativeRef === "function") {
    const native = candidate.getNativeRef();
    if (isTextAreaLike(native)) return native;
  }
  if (isTextAreaLike(current)) return current;
  return null;
}

function toHtmlElement(current: unknown): HTMLElement | null {
  if (!current) return null;
  if (current instanceof HTMLElement) return current;
  const maybe = current as { getBoundingClientRect?: () => DOMRect };
  if (maybe.getBoundingClientRect) {
    return current as HTMLElement;
  }
  return null;
}

interface SendButtonStateInput {
  disabled: boolean;
  isSubmitDisabled: boolean;
  isSubmitLoading: boolean;
  onSubmitLoadingPress: (() => void) | undefined;
  defaultSendBehavior: "interrupt" | "queue";
  isAgentRunning: boolean;
}

interface SendButtonStateOutput {
  canPressLoadingButton: boolean;
  isSendButtonDisabled: boolean;
  defaultActionQueues: boolean;
}

function computeSendButtonState(input: SendButtonStateInput): SendButtonStateOutput {
  const canPressLoadingButton =
    input.isSubmitLoading && typeof input.onSubmitLoadingPress === "function";
  const isSendButtonDisabled =
    input.disabled || (!canPressLoadingButton && (input.isSubmitDisabled || input.isSubmitLoading));
  const defaultActionQueues = input.defaultSendBehavior === "queue" && input.isAgentRunning;
  return { canPressLoadingButton, isSendButtonDisabled, defaultActionQueues };
}

interface DefaultSendActionContext {
  defaultSendBehavior: "interrupt" | "queue";
  isAgentRunning: boolean;
  onQueue: ((payload: MessagePayload) => void) | undefined;
  handleSendMessage: () => void;
  handleQueueMessage: () => void;
}

function runDefaultSendAction(ctx: DefaultSendActionContext): void {
  if (ctx.defaultSendBehavior === "queue" && ctx.isAgentRunning && ctx.onQueue) {
    ctx.handleQueueMessage();
    return;
  }
  ctx.handleSendMessage();
}

function runAlternateSendAction(ctx: DefaultSendActionContext): void {
  if (ctx.defaultSendBehavior === "queue") {
    ctx.handleSendMessage();
    return;
  }
  if (ctx.onQueue) {
    ctx.handleQueueMessage();
  }
}

interface ResolvedMessageInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: (payload: MessagePayload) => void;
  hasExternalContent: boolean;
  allowEmptySubmit: boolean;
  submitButtonAccessibilityLabel: string | undefined;
  submitIcon: "arrow" | "return";
  isSubmitDisabled: boolean;
  isSubmitLoading: boolean;
  attachments: ComposerAttachment[];
  cwd: string;
  attachmentMenuItems: AttachmentMenuItem[];
  onAttachButtonRef: ((node: View | null) => void) | undefined;
  onAddImages: ((images: ImageAttachment[]) => void) | undefined;
  client: DaemonClient | null;
  isReadyForDictation: boolean | undefined;
  placeholder: string;
  autoFocus: boolean;
  autoFocusKey: string | undefined;
  disabled: boolean;
  isPaneFocused: boolean;
  leftContent: React.ReactNode;
  beforeVoiceContent: React.ReactNode;
  rightContent: React.ReactNode;
  voiceServerId: string | undefined;
  voiceAgentId: string | undefined;
  isAgentRunning: boolean;
  defaultSendBehavior: "interrupt" | "queue";
  onQueue: ((payload: MessagePayload) => void) | undefined;
  onSubmitLoadingPress: (() => void) | undefined;
  onKeyPressCallback: ((event: { key: string; preventDefault: () => void }) => boolean) | undefined;
  onSelectionChangeCallback: ((selection: { start: number; end: number }) => void) | undefined;
  onFocusChange: ((focused: boolean) => void) | undefined;
  onHeightChange: ((height: number) => void) | undefined;
  inputWrapperStyle: import("react-native").ViewStyle | undefined;
  onSchedule: ((payload: MessagePayload, runAt: string) => void) | undefined;
}

function resolveMessageInputProps(props: MessageInputProps): ResolvedMessageInputProps {
  return {
    value: props.value,
    onChangeText: props.onChangeText,
    onSubmit: props.onSubmit,
    hasExternalContent: props.hasExternalContent ?? false,
    allowEmptySubmit: props.allowEmptySubmit ?? false,
    submitButtonAccessibilityLabel: props.submitButtonAccessibilityLabel,
    submitIcon: props.submitIcon ?? "arrow",
    isSubmitDisabled: props.isSubmitDisabled ?? false,
    isSubmitLoading: props.isSubmitLoading ?? false,
    attachments: props.attachments,
    cwd: props.cwd,
    attachmentMenuItems: props.attachmentMenuItems,
    onAttachButtonRef: props.onAttachButtonRef,
    onAddImages: props.onAddImages,
    client: props.client,
    isReadyForDictation: props.isReadyForDictation,
    placeholder: props.placeholder ?? "Message...",
    autoFocus: props.autoFocus ?? false,
    autoFocusKey: props.autoFocusKey,
    disabled: props.disabled ?? false,
    isPaneFocused: props.isPaneFocused ?? true,
    leftContent: props.leftContent,
    beforeVoiceContent: props.beforeVoiceContent,
    rightContent: props.rightContent,
    voiceServerId: props.voiceServerId,
    voiceAgentId: props.voiceAgentId,
    isAgentRunning: props.isAgentRunning ?? false,
    defaultSendBehavior: props.defaultSendBehavior ?? "interrupt",
    onQueue: props.onQueue,
    onSubmitLoadingPress: props.onSubmitLoadingPress,
    onKeyPressCallback: props.onKeyPress,
    onSelectionChangeCallback: props.onSelectionChange,
    onFocusChange: props.onFocusChange,
    onHeightChange: props.onHeightChange,
    inputWrapperStyle: props.inputWrapperStyle,
    onSchedule: props.onSchedule,
  };
}

function extractErrorMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return null;
}

function getScrollableAncestorChain(element: HTMLElement | null): string[] {
  if (!element || typeof window === "undefined") {
    return [];
  }
  const results: string[] = [];
  let current = element.parentElement;
  while (current) {
    const style = window.getComputedStyle(current);
    const overflowY = style.overflowY;
    const canScroll =
      (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
      current.scrollHeight > current.clientHeight;
    if (canScroll) {
      results.push(getElementDescriptor(current) ?? current.tagName.toLowerCase());
    }
    current = current.parentElement;
  }
  return results;
}

function nextQuarterHour(currentMinute: number): number {
  // Start at the next quarter-hour so the default schedule time is in the future.
  if (currentMinute < 15) return 15;
  if (currentMinute < 30) return 30;
  if (currentMinute < 45) return 45;
  return 0;
}

function formatScheduleConfirmLabel(args: {
  isInPast: boolean;
  isZh: boolean;
  dateLabel: string;
  timeLabel: string;
}): string {
  if (args.isInPast) {
    return args.isZh ? "时间已过" : "Time is in the past";
  }
  if (args.isZh) {
    return `在 ${args.dateLabel} ${args.timeLabel} 发送`;
  }
  return `Send on ${args.dateLabel} at ${args.timeLabel}`;
}

function PickerItem({
  label,
  value: itemValue,
  isSelected,
  onSelect,
}: {
  label: string;
  value: number;
  isSelected: boolean;
  onSelect: (value: number) => void;
}) {
  const handlePress = useCallback(() => onSelect(itemValue), [onSelect, itemValue]);
  const itemStyle = useMemo(
    () => [styles.pickerItem, isSelected && styles.pickerItemSelected],
    [isSelected],
  );
  const textStyle = useMemo(
    () => [styles.pickerItemText, isSelected && styles.pickerItemTextSelected],
    [isSelected],
  );
  return (
    <Pressable onPress={handlePress} style={itemStyle}>
      <Text style={textStyle}>{label}</Text>
    </Pressable>
  );
}

const scheduleDropdownContentStyle = { flex: 1, padding: 16, minHeight: 320 } as const;
const scheduleConfirmArrowStyle = { marginRight: 8 } as const;
const scheduleFooterStyle = { marginTop: "auto" } as const;

function ScheduleSendButton({
  onSchedule,
  value,
  attachments,
  cwd,
  disabled,
}: {
  onSchedule: ((payload: MessagePayload, runAt: string) => void) | undefined;
  value: string;
  attachments: ComposerAttachment[];
  cwd: string;
  disabled: boolean;
}) {
  const { theme } = useUnistyles();
  const { t, i18n } = useTranslation();

  const now = new Date();
  const [selDayOffset, setSelDayOffset] = useState(0);
  const [selHour, setSelHour] = useState(now.getHours());
  const [selMinute, setSelMinute] = useState(() => nextQuarterHour(now.getMinutes()));

  const isZh = i18n.language.startsWith("zh");
  const dateFormat = isZh ? "M月d日" : "MMM d";

  const days = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 14 }, (_, i) => {
      const d = addDays(today, i);
      let label: string;
      if (i === 0) label = isZh ? "今天" : "Today";
      else if (i === 1) label = isZh ? "明天" : "Tomorrow";
      else label = format(d, dateFormat);
      return { label, date: d };
    });
  }, [dateFormat, isZh]);

  const hours = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);
  const minutes = useMemo(() => [0, 15, 30, 45], []);

  const targetDate = setHours(setMinutes(days[selDayOffset]!.date, selMinute), selHour);
  const isInPast = targetDate.getTime() <= Date.now();
  const canSchedule = value.trim().length > 0 && !disabled && !isInPast;

  const handleConfirm = useCallback(() => {
    if (!canSchedule || !onSchedule) return;
    onSchedule({ text: value, attachments, cwd }, targetDate.toISOString());
  }, [canSchedule, onSchedule, value, attachments, cwd, targetDate]);

  const triggerStyle = useCallback(
    ({ hovered }: { hovered: boolean; pressed: boolean; open: boolean }) => [
      styles.scheduleButton,
      hovered && styles.iconButtonHovered,
      disabled && styles.buttonDisabled,
    ],
    [disabled],
  );

  const confirmButtonStyle = useCallback(
    ({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [
      styles.confirmButtonLargeAction,
      hovered && { opacity: 0.9 },
      pressed && { opacity: 0.8 },
      !canSchedule && styles.buttonDisabled,
    ],
    [canSchedule],
  );

  const selectedDateLabel = days[selDayOffset]!.label;
  const selectedTimeLabel = `${selHour.toString().padStart(2, "0")}:${selMinute.toString().padStart(2, "0")}`;

  if (!onSchedule) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger disabled={disabled} style={triggerStyle}>
        <Clock size={20} color={theme.colors.foregroundMuted} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" width={320}>
        <View style={scheduleDropdownContentStyle}>
          <Text style={styles.scheduleTitle}>
            {t("composer.scheduleTitle", { defaultValue: "Schedule send" })}
          </Text>

          <View style={styles.pickerContainer}>
            <View style={styles.pickerColumnWrapper}>
              <ScrollView style={styles.pickerColumn} showsVerticalScrollIndicator={false}>
                {days.map((day, i) => (
                  <PickerItem
                    key={day.label}
                    label={day.label}
                    value={i}
                    isSelected={selDayOffset === i}
                    onSelect={setSelDayOffset}
                  />
                ))}
              </ScrollView>
            </View>
            <View style={styles.pickerColumnWrapper}>
              <ScrollView style={styles.pickerColumn} showsVerticalScrollIndicator={false}>
                {hours.map((h) => (
                  <PickerItem
                    key={h}
                    label={h.toString().padStart(2, "0")}
                    value={h}
                    isSelected={selHour === h}
                    onSelect={setSelHour}
                  />
                ))}
              </ScrollView>
            </View>
            <View style={styles.pickerColumnWrapper}>
              <ScrollView style={styles.pickerColumn} showsVerticalScrollIndicator={false}>
                {minutes.map((m) => (
                  <PickerItem
                    key={m}
                    label={m.toString().padStart(2, "0")}
                    value={m}
                    isSelected={selMinute === m}
                    onSelect={setSelMinute}
                  />
                ))}
              </ScrollView>
            </View>
          </View>

          <View style={scheduleFooterStyle}>
            <Pressable onPress={handleConfirm} disabled={!canSchedule} style={confirmButtonStyle}>
              <ArrowUp size={16} color="#FFF" style={scheduleConfirmArrowStyle} />
              <Text style={styles.confirmButtonLargeActionText}>
                {formatScheduleConfirmLabel({
                  isInPast,
                  isZh,
                  dateLabel: selectedDateLabel,
                  timeLabel: selectedTimeLabel,
                })}
              </Text>
            </Pressable>
          </View>
        </View>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ComposerOverlayState {
  isDictatingRef: React.MutableRefObject<boolean>;
  isRealtimeVoiceForCurrentAgent: boolean;
  showDictationOverlay: boolean;
  showRealtimeOverlay: boolean;
  showOverlay: boolean;
  overlayAnimatedStyle: ReturnType<typeof useAnimatedStyle>;
  inputAnimatedStyle: ReturnType<typeof useAnimatedStyle>;
}

function useComposerOverlayState(args: {
  voice: { isVoiceModeForAgent: (serverId: string, agentId: string) => boolean } | null | undefined;
  voiceServerId: string | undefined;
  voiceAgentId: string | undefined;
  isDictating: boolean;
  isDictationProcessing: boolean;
  dictationStatus: string;
  sendAfterTranscriptRef: React.MutableRefObject<boolean>;
}): ComposerOverlayState {
  const {
    voice,
    voiceServerId,
    voiceAgentId,
    isDictating,
    isDictationProcessing,
    dictationStatus,
    sendAfterTranscriptRef,
  } = args;

  const isDictatingRef = useRef(isDictating);
  useEffect(() => {
    isDictatingRef.current = isDictating;
  }, [isDictating]);

  const isRealtimeVoiceForCurrentAgent = computeIsRealtimeVoiceForAgent(
    voice,
    voiceServerId,
    voiceAgentId,
  );
  const showDictationOverlay = computeShouldShowDictationOverlay(
    isDictating,
    isDictationProcessing,
    dictationStatus,
  );
  const showRealtimeOverlay = isRealtimeVoiceForCurrentAgent;
  const showOverlay = showDictationOverlay || showRealtimeOverlay;

  useEffect(() => {
    if (isDictating || isDictationProcessing) {
      return;
    }
    sendAfterTranscriptRef.current = false;
  }, [dictationStatus, isDictating, isDictationProcessing, sendAfterTranscriptRef]);

  const overlayTransition = useSharedValue(0);
  useEffect(() => {
    overlayTransition.value = withTiming(showOverlay ? 1 : 0, { duration: 200 });
  }, [overlayTransition, showOverlay]);

  const overlayAnimatedStyle = useAnimatedStyle(() => ({
    opacity: overlayTransition.value,
    pointerEvents: overlayTransition.value > 0.5 ? "auto" : "none",
  }));

  const inputAnimatedStyle = useAnimatedStyle(() => ({
    opacity: 1 - overlayTransition.value,
  }));

  return {
    isDictatingRef,
    isRealtimeVoiceForCurrentAgent,
    showDictationOverlay,
    showRealtimeOverlay,
    showOverlay,
    overlayAnimatedStyle,
    inputAnimatedStyle,
  };
}

export const MessageInput = forwardRef<MessageInputRef, MessageInputProps>(
  function MessageInput(props, ref) {
    const {
      value,
      onChangeText,
      onSubmit,
      hasExternalContent,
      allowEmptySubmit,
      submitButtonAccessibilityLabel,
      submitIcon,
      isSubmitDisabled,
      isSubmitLoading,
      attachments,
      cwd,
      attachmentMenuItems,
      onAttachButtonRef,
      onAddImages,
      client,
      isReadyForDictation,
      placeholder,
      autoFocus,
      autoFocusKey,
      disabled,
      isPaneFocused,
      leftContent,
      beforeVoiceContent,
      rightContent,
      voiceServerId,
      voiceAgentId,
      isAgentRunning,
      defaultSendBehavior,
      onQueue,
      onSubmitLoadingPress,
      onKeyPressCallback,
      onSelectionChangeCallback,
      onFocusChange,
      onHeightChange,
      inputWrapperStyle,
      onSchedule,
    } = resolveMessageInputProps(props);
    const { theme } = useUnistyles();
    const buttonIconSize = isWeb ? theme.iconSize.md : theme.iconSize.lg;
    const investigationComponentId = computeInvestigationComponentId(voiceServerId, voiceAgentId);
    markScrollInvestigationRender(investigationComponentId);
    const toast = useToast();
    const voice = useVoiceOptional();
    const sendKeys = useShortcutKeys("message-input-send");
    const voiceMuteToggleKeys = useShortcutKeys("voice-mute-toggle");
    const dictationToggleKeys = useShortcutKeys("dictation-toggle");
    const focusInputKeys = useShortcutKeys("focus-message-input");
    const [inputHeight, setInputHeight] = useState(MIN_INPUT_HEIGHT);
    const [isInputFocused, setIsInputFocused] = useState(false);
    const rootRef = useRef<View | null>(null);
    const inputWrapperRef = useRef<View | null>(null);
    const textInputRef = useRef<TextInput | (TextInput & { getNativeRef?: () => unknown }) | null>(
      null,
    );
    const isInputFocusedRef = useRef(false);

    useImperativeHandle(ref, () => ({
      focus: () => {
        textInputRef.current?.focus();
      },
      blur: () => {
        textInputRef.current?.blur?.();
      },
      runKeyboardAction: (action) =>
        runKeyboardActionImpl(action, {
          textInputRef,
          isDictatingRef,
          sendAfterTranscriptRef,
          confirmDictation,
          cancelDictation,
          startDictationIfAvailable,
          handleToggleRealtimeVoiceShortcut,
          isRealtimeVoiceForCurrentAgent,
          voice,
        }),
      getNativeElement: () => (isWeb ? getTextInputNativeElement(textInputRef.current) : null),
    }));
    const inputHeightRef = useRef(MIN_INPUT_HEIGHT);
    const sendAfterTranscriptRef = useRef(false);
    const valueRef = useRef(value);
    const serverInfo = useSessionStore(
      useCallback(
        (state) => {
          if (!voiceServerId) {
            return null;
          }
          return state.sessions[voiceServerId]?.serverInfo ?? null;
        },
        [voiceServerId],
      ),
    );

    useEffect(() => {
      valueRef.current = value;
    }, [value]);

    useEffect(() => {
      return () => {
        onFocusChange?.(false);
      };
    }, [onFocusChange]);

    useAutoFocusOnWebEffect(textInputRef, autoFocus, autoFocusKey);

    const handleDictationTranscript = useCallback(
      (text: string, _meta: { requestId: string }) => {
        const autoSend = sendAfterTranscriptRef.current;
        sendAfterTranscriptRef.current = false;
        applyDictationTranscript(text, {
          value: valueRef.current,
          defaultSendBehavior,
          isAgentRunning,
          onQueue,
          onSubmit,
          onChangeText,
          attachments,
          cwd,
          autoSend,
        });
      },
      [onChangeText, onSubmit, onQueue, attachments, cwd, isAgentRunning, defaultSendBehavior],
    );

    const handleDictationError = useCallback(
      (error: Error) => {
        console.error("[MessageInput] Dictation error:", error);
        toast.error(error.message);
      },
      [toast],
    );

    const dictationUnavailableMessage = resolveVoiceUnavailableMessage({
      serverInfo,
      mode: "dictation",
    });

    const canStartDictation = useCallback(
      () =>
        computeCanStartDictation({
          client,
          isReadyForDictation,
          disabled,
          dictationUnavailableMessage,
        }),
      [client, disabled, dictationUnavailableMessage, isReadyForDictation],
    );

    const canConfirmDictation = useCallback(() => client?.isConnected ?? false, [client]);
    const isConnected = Boolean(client?.isConnected);
    const isDictationStartEnabled = computeIsDictationStartEnabled(
      isReadyForDictation,
      isConnected,
      disabled,
    );

    const {
      isRecording: isDictating,
      isProcessing: isDictationProcessing,
      partialTranscript: _dictationPartialTranscript,
      volume: dictationVolume,
      duration: dictationDuration,
      error: dictationError,
      status: dictationStatus,
      startDictation,
      cancelDictation,
      confirmDictation,
      retryFailedDictation,
      discardFailedDictation,
    } = useDictation({
      client,
      onTranscript: handleDictationTranscript,
      onError: handleDictationError,
      canStart: canStartDictation,
      canConfirm: canConfirmDictation,
      autoStopWhenHidden: { isVisible: isPaneFocused },
      enableDuration: true,
    });

    const {
      isDictatingRef,
      isRealtimeVoiceForCurrentAgent,
      showDictationOverlay,
      showRealtimeOverlay,
      showOverlay: _showOverlay,
      overlayAnimatedStyle,
      inputAnimatedStyle,
    } = useComposerOverlayState({
      voice,
      voiceServerId,
      voiceAgentId,
      isDictating,
      isDictationProcessing,
      dictationStatus,
      sendAfterTranscriptRef,
    });

    const startDictationIfAvailable = useCallback(
      () =>
        startDictationIfAvailableImpl({
          dictationUnavailableMessage,
          canStartDictation,
          isDictatingRef,
          toast,
          startDictation,
        }),
      [canStartDictation, dictationUnavailableMessage, isDictatingRef, startDictation, toast],
    );

    const handleVoicePress = useCallback(
      () =>
        handleVoicePressImpl({
          isRealtimeVoiceForCurrentAgent,
          voice,
          isDictating,
          cancelDictation,
          startDictationIfAvailable,
        }),
      [
        cancelDictation,
        isDictating,
        isRealtimeVoiceForCurrentAgent,
        startDictationIfAvailable,
        voice,
      ],
    );

    const handleCancelRecording = useCallback(async () => {
      await cancelDictation();
    }, [cancelDictation]);

    // Press-and-hold mic gesture (mobile/compact only): press to start
    // dictation, release to commit the transcript into the input field.
    const handleVoicePressIn = useCallback(() => {
      if (!isDictating && isDictationStartEnabled) {
        void startDictationIfAvailable();
      }
    }, [isDictating, isDictationStartEnabled, startDictationIfAvailable]);
    const handleVoicePressOut = useCallback(() => {
      if (isDictatingRef.current) {
        void confirmDictation();
      }
    }, [confirmDictation, isDictatingRef]);

    const isCompact = useIsCompactFormFactor();
    const hasComposerText = value.trim().length > 0;

    const handleAcceptRecording = useCallback(async () => {
      sendAfterTranscriptRef.current = false;
      await confirmDictation();
    }, [confirmDictation]);

    const handleAcceptAndSendRecording = useCallback(async () => {
      sendAfterTranscriptRef.current = true;
      await confirmDictation();
    }, [confirmDictation]);

    const handleRetryFailedRecording = useCallback(() => {
      void retryFailedDictation();
    }, [retryFailedDictation]);

    const handleDiscardFailedRecording = useCallback(() => {
      discardFailedDictation();
    }, [discardFailedDictation]);

    const handleStopRealtimeVoice = useCallback(
      () =>
        stopRealtimeVoiceImpl({
          voice,
          isRealtimeVoiceForCurrentAgent,
          isAgentRunning,
          client,
          voiceAgentId,
        }),
      [client, isAgentRunning, isRealtimeVoiceForCurrentAgent, voice, voiceAgentId],
    );

    const handleToggleRealtimeVoiceShortcut = useCallback(() => {
      toggleRealtimeVoiceImpl({
        voice,
        voiceServerId,
        voiceAgentId,
        isConnected,
        disabled,
        handleStopRealtimeVoice,
        toast,
      });
    }, [disabled, handleStopRealtimeVoice, isConnected, toast, voice, voiceAgentId, voiceServerId]);

    const minimizeInputHeight = useCallback(() => {
      inputHeightRef.current = MIN_INPUT_HEIGHT;
      setInputHeight(MIN_INPUT_HEIGHT);
      onHeightChange?.(MIN_INPUT_HEIGHT);
    }, [onHeightChange]);

    const handleSendMessage = useCallback(
      () =>
        sendMessageImpl({
          value,
          attachments,
          hasExternalContent,
          allowEmptySubmit,
          cwd,
          isAgentRunning,
          onSubmit,
          onMinimizeHeight: minimizeInputHeight,
        }),
      [
        allowEmptySubmit,
        value,
        attachments,
        cwd,
        onSubmit,
        isAgentRunning,
        hasExternalContent,
        minimizeInputHeight,
      ],
    );

    const handleQueueMessage = useCallback(
      () =>
        queueMessageImpl({
          value,
          attachments,
          cwd,
          onQueue,
          onChangeText,
          onMinimizeHeight: minimizeInputHeight,
        }),
      [value, attachments, cwd, onQueue, onChangeText, minimizeInputHeight],
    );

    const handleDefaultSendAction = useCallback(() => {
      runDefaultSendAction({
        defaultSendBehavior,
        isAgentRunning,
        onQueue,
        handleSendMessage,
        handleQueueMessage,
      });
    }, [defaultSendBehavior, isAgentRunning, onQueue, handleQueueMessage, handleSendMessage]);

    const handleAlternateSendAction = useCallback(() => {
      runAlternateSendAction({
        defaultSendBehavior,
        isAgentRunning,
        onQueue,
        handleSendMessage,
        handleQueueMessage,
      });
    }, [defaultSendBehavior, isAgentRunning, handleSendMessage, handleQueueMessage, onQueue]);

    const getWebTextArea = useCallback(
      (): TextAreaHandle | null => getWebTextAreaImpl(textInputRef.current),
      [],
    );

    const webTextareaRef = useRef<HTMLElement | null>(null);

    useLayoutEffect(() => {
      if (isWeb) {
        webTextareaRef.current = getWebTextArea() as HTMLElement | null;
      }
    }, [getWebTextArea]);

    const inputScrollbar = useWebElementScrollbar(webTextareaRef, {
      enabled: isWeb && inputHeight >= MAX_INPUT_HEIGHT,
    });

    const getWebElement = useCallback((target: "root" | "wrapper"): HTMLElement | null => {
      const current = target === "root" ? rootRef.current : inputWrapperRef.current;
      return toHtmlElement(current);
    }, []);

    usePasteImagesEffect({
      getWebTextArea,
      isConnected,
      disabled,
      isDictating,
      isRealtimeVoiceForCurrentAgent,
      onAddImages,
    });

    useComposerResizeObserverEffect({ getWebTextArea, getWebElement, valueRef });

    useComposerScrollLogEffect({ getWebTextArea, valueRef });

    const setBoundedInputHeight = useCallback(
      (nextHeight: number) => {
        const bounded = Math.max(MIN_INPUT_HEIGHT, Math.min(MAX_INPUT_HEIGHT, nextHeight));
        if (Math.abs(inputHeightRef.current - bounded) < 1) return;
        inputHeightRef.current = bounded;
        setInputHeight(bounded);
        onHeightChange?.(bounded);
      },
      [onHeightChange],
    );

    useComposerHeightMirror({
      value,
      textareaRef: webTextareaRef,
      minHeight: MIN_INPUT_HEIGHT,
      maxHeight: MAX_INPUT_HEIGHT,
      onHeight: setBoundedInputHeight,
    });

    const handleContentSizeChange = useCallback(
      (event: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
        if (isWeb) return;
        setBoundedInputHeight(event.nativeEvent.contentSize.height);
      },
      [setBoundedInputHeight],
    );

    const handleSelectionChange = useCallback(
      (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
        const start = event.nativeEvent.selection?.start ?? 0;
        const end = event.nativeEvent.selection?.end ?? start;
        if (isWeb) {
          const textarea = getWebTextArea();
          logWebStickyBottom("composer_selection_changed", {
            now: getDebugNow(),
            start,
            end,
            textareaScrollTop: textarea?.scrollTop ?? null,
            textareaClientHeight: textarea?.clientHeight ?? null,
            textareaScrollHeight: textarea?.scrollHeight ?? null,
          });
        }
        onSelectionChangeCallback?.({ start, end });
      },
      [getWebTextArea, onSelectionChangeCallback],
    );

    const handleDesktopKeyPress = useCallback(
      (event: WebTextInputKeyPressEvent) => {
        if (!isWeb) return;
        handleDesktopKeyPressImpl(event, {
          investigationComponentId,
          onKeyPressCallback,
          isAgentRunning,
          onQueue,
          isSubmitDisabled,
          isSubmitLoading,
          disabled,
          handleAlternateSendAction,
          handleDefaultSendAction,
        });
      },
      [
        investigationComponentId,
        onKeyPressCallback,
        isAgentRunning,
        onQueue,
        isSubmitDisabled,
        isSubmitLoading,
        disabled,
        handleAlternateSendAction,
        handleDefaultSendAction,
      ],
    );

    const { shouldShowSendButton } = computeSendableContent({
      value,
      attachments,
      hasExternalContent,
      allowEmptySubmit,
      isSubmitLoading,
    });
    const { canPressLoadingButton, isSendButtonDisabled, defaultActionQueues } =
      computeSendButtonState({
        disabled,
        isSubmitDisabled,
        isSubmitLoading,
        onSubmitLoadingPress,
        defaultSendBehavior,
        isAgentRunning,
      });
    const submitAccessibilityLabel = resolveSubmitAccessibilityLabel({
      submitButtonAccessibilityLabel,
      canPressLoadingButton,
      defaultActionQueues,
      isAgentRunning,
    });

    const isVoiceMuted = Boolean(voice?.isMuted);

    const voiceButtonAccessibilityLabel = resolveVoiceAccessibilityLabel({
      isRealtimeVoiceForCurrentAgent,
      isMuted: isVoiceMuted,
      isDictating,
    });

    const voiceTooltipText = resolveVoiceTooltipText({
      isRealtimeVoiceForCurrentAgent,
      isMuted: isVoiceMuted,
    });

    const handleInputChange = useCallback(
      (nextValue: string) => {
        markScrollInvestigationEvent(investigationComponentId, "inputChange");
        onChangeText(nextValue);
        if (isWeb) {
          logWebStickyBottom("composer_text_changed", {
            valueLength: nextValue.length,
            lineCount: nextValue.split("\n").length,
          });
        }
      },
      [investigationComponentId, onChangeText],
    );

    const handleInputFocus = useCallback(() => {
      isInputFocusedRef.current = true;
      setIsInputFocused(true);
      onFocusChange?.(true);
    }, [onFocusChange]);

    const handleInputBlur = useCallback(() => {
      isInputFocusedRef.current = false;
      setIsInputFocused(false);
      onFocusChange?.(false);
    }, [onFocusChange]);

    const attachButtonStyle = useCallback(
      ({ hovered }: { hovered?: boolean }) =>
        computeAttachButtonStyle({ hovered, isConnected, disabled }),
      [isConnected, disabled],
    );

    const voiceButtonStyle = useCallback(
      ({ hovered }: { hovered?: boolean }) =>
        computeVoiceButtonStyle({ hovered, isDictating, isDictationStartEnabled }),
      [isDictating, isDictationStartEnabled],
    );

    const handleRealtimeVoiceStop = useCallback(() => {
      void handleStopRealtimeVoice();
    }, [handleStopRealtimeVoice]);

    const inputWrapperCombinedStyle = useMemo(
      () => [styles.inputWrapper, inputWrapperStyle, inputAnimatedStyle],
      [inputWrapperStyle, inputAnimatedStyle],
    );
    const inputWrapperCompactCombinedStyle = useMemo(
      () => [
        styles.inputWrapper,
        styles.inputWrapperCompact,
        inputWrapperStyle,
        inputAnimatedStyle,
      ],
      [inputWrapperStyle, inputAnimatedStyle],
    );
    const textInputScrollWrapperCompactStyle = useMemo(
      () => [styles.textInputScrollWrapper, styles.textInputScrollWrapperCompact],
      [],
    );
    const sendButtonRowStyle = useMemo(
      () => ({ flexDirection: "row" as const, alignItems: "center" as const }),
      [],
    );
    const textInputStyle = useMemo(
      () => [styles.textInput, computeTextInputHeightStyle(inputHeight)],
      [inputHeight],
    );
    const sendButtonCombinedStyle = useMemo(
      () => [styles.sendButton, isSendButtonDisabled && styles.buttonDisabled],
      [isSendButtonDisabled],
    );
    const overlayContainerStyle = useMemo(
      () => [styles.overlayContainer, overlayAnimatedStyle],
      [overlayAnimatedStyle],
    );

    const renderAttachButtonIcon = useCallback(
      ({ hovered }: { hovered?: boolean }) => (
        <AttachButtonIcon
          hovered={Boolean(hovered)}
          onAttachButtonRef={onAttachButtonRef}
          buttonIconSize={buttonIconSize}
          foreground={theme.colors.foreground}
          foregroundMuted={theme.colors.foregroundMuted}
        />
      ),
      [onAttachButtonRef, buttonIconSize, theme.colors.foreground, theme.colors.foregroundMuted],
    );

    const renderVoiceButtonIcon = useCallback(
      ({ hovered }: { hovered?: boolean }) => (
        <VoiceButtonIcon
          hovered={Boolean(hovered)}
          isDictating={isDictating}
          isMutedRealtime={Boolean(isRealtimeVoiceForCurrentAgent && voice?.isMuted)}
          buttonIconSize={buttonIconSize}
          foreground={theme.colors.foreground}
          foregroundMuted={theme.colors.foregroundMuted}
        />
      ),
      [
        isDictating,
        isRealtimeVoiceForCurrentAgent,
        voice?.isMuted,
        buttonIconSize,
        theme.colors.foreground,
        theme.colors.foregroundMuted,
      ],
    );

    const isEditableInput = !isDictating && !isRealtimeVoiceForCurrentAgent && !disabled;
    const isAutoFocused = isWeb && autoFocus;
    const isScrollEnabled = isWeb ? inputHeight >= MAX_INPUT_HEIGHT : true;
    const isDisabledInput = disabled || isSubmitLoading;

    return (
      <View ref={rootRef} style={styles.container} testID="message-input-root">
        <Animated.View
          ref={inputWrapperRef}
          style={isCompact ? inputWrapperCompactCombinedStyle : inputWrapperCombinedStyle}
        >
          <NativeBlurFill colorScheme={theme.colorScheme} />
          {isCompact ? (
            // Mobile WeChat-style: status row above + [mic] [input] [+ / send].
            // The status row hosts AgentStatusBar (model / mode / thinking /
            // features pickers) — without it those switchers have no entry.
            <View style={styles.compactColumn}>
              {leftContent ? <View style={styles.compactStatusRow}>{leftContent}</View> : null}
              <View style={styles.compactRow}>
                <Pressable
                  onPressIn={handleVoicePressIn}
                  onPressOut={handleVoicePressOut}
                  disabled={!isDictationStartEnabled}
                  accessibilityRole="button"
                  accessibilityLabel={voiceButtonAccessibilityLabel}
                  style={styles.compactCircleButton}
                >
                  {renderVoiceButtonIcon({})}
                </Pressable>
                <View style={textInputScrollWrapperCompactStyle}>
                  <TextInput
                    ref={textInputRef}
                    value={value}
                    onChangeText={handleInputChange}
                    placeholder={placeholder}
                    placeholderTextColor={theme.colors.surface4}
                    accessibilityLabel="Message agent..."
                    onFocus={handleInputFocus}
                    onBlur={handleInputBlur}
                    style={textInputStyle}
                    multiline
                    scrollEnabled={isScrollEnabled}
                    onContentSizeChange={handleContentSizeChange}
                    editable={isEditableInput}
                    onSelectionChange={handleSelectionChange}
                    autoFocus={isAutoFocused}
                  />
                  {inputScrollbar}
                </View>
                {hasComposerText && shouldShowSendButton ? (
                  <View style={sendButtonRowStyle}>
                    <ScheduleSendButton
                      onSchedule={onSchedule}
                      value={value}
                      attachments={attachments}
                      cwd={cwd}
                      disabled={isDisabledInput}
                    />
                    <SendButtonTooltip
                      shouldShow={shouldShowSendButton}
                      canPressLoadingButton={canPressLoadingButton}
                      onSubmitLoadingPress={onSubmitLoadingPress}
                      onDefaultSendAction={handleDefaultSendAction}
                      isSendButtonDisabled={isSendButtonDisabled}
                      submitAccessibilityLabel={submitAccessibilityLabel}
                      sendButtonCombinedStyle={sendButtonCombinedStyle}
                      isSubmitLoading={isSubmitLoading}
                      submitIcon={submitIcon}
                      buttonIconSize={buttonIconSize}
                      submitButtonAccessibilityLabel={submitButtonAccessibilityLabel}
                      defaultActionQueues={defaultActionQueues}
                      sendKeys={sendKeys}
                    />
                  </View>
                ) : (
                  <AttachmentDropdown
                    isConnected={isConnected}
                    disabled={disabled}
                    attachButtonStyle={attachButtonStyle}
                    renderAttachButtonIcon={renderAttachButtonIcon}
                    attachmentMenuItems={attachmentMenuItems}
                  />
                )}
              </View>
            </View>
          ) : (
            <>
              {/* Text input */}
              <View style={styles.textInputScrollWrapper}>
                <TextInput
                  ref={textInputRef}
                  value={value}
                  onChangeText={handleInputChange}
                  placeholder={placeholder}
                  placeholderTextColor={theme.colors.surface4}
                  accessibilityLabel="Message agent..."
                  onFocus={handleInputFocus}
                  onBlur={handleInputBlur}
                  style={textInputStyle}
                  multiline
                  scrollEnabled={isScrollEnabled}
                  onContentSizeChange={handleContentSizeChange}
                  editable={isEditableInput}
                  onKeyPress={handleDesktopKeyPress}
                  onSelectionChange={handleSelectionChange}
                  autoFocus={isAutoFocused}
                />
                {inputScrollbar}
                <FocusHint
                  visible={isWeb && isPaneFocused && !isInputFocused && !value}
                  focusInputKeys={focusInputKeys}
                />
              </View>

              {/* Button row */}
              <View style={styles.buttonRow}>
                {/* Left: attachment button + leftContent slot */}
                <View style={styles.leftButtonGroup}>
                  <AttachmentDropdown
                    isConnected={isConnected}
                    disabled={disabled}
                    attachButtonStyle={attachButtonStyle}
                    renderAttachButtonIcon={renderAttachButtonIcon}
                    attachmentMenuItems={attachmentMenuItems}
                  />
                  {leftContent}
                </View>

                {/* Right: voice button, contextual button (realtime/send/cancel) */}
                <View style={styles.rightButtonGroup}>
                  {beforeVoiceContent}
                  <VoiceButtonTooltip
                    onVoicePress={handleVoicePress}
                    isDictationStartEnabled={isDictationStartEnabled}
                    voiceButtonAccessibilityLabel={voiceButtonAccessibilityLabel}
                    voiceButtonStyle={voiceButtonStyle}
                    renderVoiceButtonIcon={renderVoiceButtonIcon}
                    voiceTooltipText={voiceTooltipText}
                    isRealtimeVoiceForCurrentAgent={isRealtimeVoiceForCurrentAgent}
                    voiceMuteToggleKeys={voiceMuteToggleKeys}
                    dictationToggleKeys={dictationToggleKeys}
                  />
                  {rightContent}
                  <ScheduleSendButton
                    onSchedule={onSchedule}
                    value={value}
                    attachments={attachments}
                    cwd={cwd}
                    disabled={isDisabledInput}
                  />
                  <SendButtonTooltip
                    shouldShow={shouldShowSendButton}
                    canPressLoadingButton={canPressLoadingButton}
                    onSubmitLoadingPress={onSubmitLoadingPress}
                    onDefaultSendAction={handleDefaultSendAction}
                    isSendButtonDisabled={isSendButtonDisabled}
                    submitAccessibilityLabel={submitAccessibilityLabel}
                    sendButtonCombinedStyle={sendButtonCombinedStyle}
                    isSubmitLoading={isSubmitLoading}
                    submitIcon={submitIcon}
                    buttonIconSize={buttonIconSize}
                    submitButtonAccessibilityLabel={submitButtonAccessibilityLabel}
                    defaultActionQueues={defaultActionQueues}
                    sendKeys={sendKeys}
                  />
                </View>
              </View>
            </>
          )}
        </Animated.View>

        <Animated.View style={overlayContainerStyle}>
          <MessageInputOverlay
            showDictationOverlay={showDictationOverlay}
            showRealtimeOverlay={showRealtimeOverlay}
            voice={voice}
            dictationVolume={dictationVolume}
            dictationDuration={dictationDuration}
            isDictating={isDictating}
            isDictationProcessing={isDictationProcessing}
            dictationStatus={dictationStatus}
            dictationError={dictationError}
            onCancelRecording={handleCancelRecording}
            onAcceptRecording={handleAcceptRecording}
            onAcceptAndSendRecording={handleAcceptAndSendRecording}
            onRetryFailedRecording={handleRetryFailedRecording}
            onDiscardFailedRecording={handleDiscardFailedRecording}
            onRealtimeVoiceStop={handleRealtimeVoiceStop}
          />
        </Animated.View>
      </View>
    );
  },
);

function NativeBlurFill({ colorScheme }: { colorScheme: string }) {
  if (!isNative) return null;
  return (
    <BlurView
      tint={colorScheme === "dark" ? "systemChromeMaterialDark" : "systemChromeMaterialLight"}
      intensity={70}
      experimentalBlurMethod={Platform.OS === "android" ? "dimezisBlurView" : undefined}
      style={RNStyleSheet.absoluteFill}
      pointerEvents="none"
    />
  );
}

function computeAttachButtonStyle(params: {
  hovered?: boolean;
  isConnected: boolean;
  disabled: boolean;
}) {
  return [
    styles.attachButton,
    Boolean(params.hovered) && styles.iconButtonHovered,
    (!params.isConnected || params.disabled) && styles.buttonDisabled,
  ];
}

function computeVoiceButtonStyle(params: {
  hovered?: boolean;
  isDictating: boolean;
  isDictationStartEnabled: boolean;
}) {
  return [
    styles.voiceButton,
    Boolean(params.hovered) && !params.isDictating && styles.iconButtonHovered,
    !params.isDictationStartEnabled && styles.buttonDisabled,
    params.isDictating && styles.voiceButtonRecording,
  ];
}

const styles = StyleSheet.create((theme: Theme) => ({
  container: {
    position: "relative",
  },
  inputWrapper: {
    flexDirection: "column",
    gap: theme.spacing[3],
    backgroundColor: theme.colors.surfaceGlassStrong,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderGlass,
    // macOS/iOS 26 floating glass composer: large continuous-curve radius,
    // glass surface so the chat behind shows through, soft glass shadow
    // lifts it off the page.
    borderRadius: theme.borderRadius.glassSheet,
    borderCurve: "continuous",
    overflow: "hidden",
    ...theme.shadow.glass,
    paddingVertical: {
      xs: theme.spacing[2],
      md: theme.spacing[4],
    },
    paddingHorizontal: {
      xs: theme.spacing[4],
      md: theme.spacing[4],
    },
    ...(isWeb
      ? ({
          transitionProperty: "border-color, background-color",
          transitionDuration: "180ms",
          transitionTimingFunction: "ease-in-out",
          backdropFilter: "blur(28px) saturate(180%)",
        } as unknown as object)
      : {}),
  },
  // Mobile WeChat-style horizontal layout: mic on the left, input flexing
  // in the middle, attach/send on the right. Override paddings so the row
  // hugs the children instead of stacking like the desktop layout.
  inputWrapperCompact: {
    flexDirection: "column",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
  },
  compactColumn: {
    flexDirection: "column",
    gap: theme.spacing[2],
    width: "100%",
  },
  compactStatusRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[1],
  },
  compactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    width: "100%",
  },
  compactCircleButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  textInputScrollWrapperCompact: {
    flex: 1,
    minWidth: 0,
  },
  textInputScrollWrapper: {
    position: "relative",
  },
  focusHintText: {
    position: "absolute",
    top: 0,
    right: 0,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    opacity: 0.5,
  },
  textInput: {
    width: "100%",
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    letterSpacing: -0.1,
    lineHeight: theme.fontSize.base * 1.45,
    ...(isWeb
      ? ({
          outlineStyle: "none",
          outlineWidth: 0,
          outlineColor: "transparent",
        } as object)
      : {}),
  },
  buttonRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginHorizontal: -6,
  },
  leftButtonGroup: {
    minWidth: 0,
    flexShrink: 1,
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.spacing[0],
  },
  rightButtonGroup: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  attachButton: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  attachButtonAnchor: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  voiceButton: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  voiceButtonRecording: {
    backgroundColor: theme.colors.destructive,
  },
  sendButton: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: theme.spacing[1],
    ...theme.shadow.sm,
  },
  scheduleButton: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: theme.spacing[1],
  },
  menuItemWithIcon: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  menuItemText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  scheduleTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.foreground,
    marginBottom: 12,
    textAlign: "center",
  },
  pickerContainer: {
    flexDirection: "row",
    height: 180,
    gap: 8,
    marginBottom: 16,
  },
  pickerColumnWrapper: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    overflow: "hidden",
  },
  pickerColumn: {
    flex: 1,
  },
  pickerItem: {
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  pickerItemSelected: {
    backgroundColor: theme.colors.surface2,
  },
  pickerItemText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  pickerItemTextSelected: {
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.bold,
  },
  confirmButtonLargeAction: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.accent,
    paddingVertical: 14,
    borderRadius: theme.borderRadius.lg,
    ...theme.shadow.md,
  },
  confirmButtonLargeActionText: {
    color: "#FFFFFF",
    fontWeight: theme.fontWeight.bold,
    fontSize: theme.fontSize.base,
  },
  iconButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  tooltipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  tooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.popoverForeground,
  },
  tooltipShortcut: {
    backgroundColor: theme.colors.surface3,
    borderColor: theme.colors.borderAccent,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  overlayContainer: {
    position: "absolute",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    right: 0,
    bottom: 0,
  },
})) as unknown as Record<string, object>;

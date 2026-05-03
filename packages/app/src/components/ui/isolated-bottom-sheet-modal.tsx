import {
  BottomSheetModal as GorhomBottomSheetModal,
  BottomSheetModalProvider,
  type BottomSheetModalProps,
  type BottomSheetBackgroundProps,
} from "@gorhom/bottom-sheet";
import { Portal } from "@gorhom/portal";
import React, { createContext, useContext, useImperativeHandle } from "react";
import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import type { ElementRef } from "react";
import { Modal, Pressable, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";
import { GlassSurface } from "./glass-surface";

type GorhomBottomSheetModalMethods = ElementRef<typeof GorhomBottomSheetModal>;

type IsolatedBottomSheetModalProps = Omit<
  BottomSheetModalProps,
  "enableDismissOnClose" | "stackBehavior"
>;

export type IsolatedBottomSheetModalRef = GorhomBottomSheetModalMethods;

const IsolatedBottomSheetScopeContext = createContext(false);

const styles = StyleSheet.create((theme) => ({
  webOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
  },
  webBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  webSheet: {
    width: "90%",
    maxWidth: 500,
    maxHeight: "80%",
    overflow: "hidden",
  },
}));

function DefaultIsolatedSheetBackground({ style }: BottomSheetBackgroundProps) {
  return <GlassSurface radius="sheet" strong style={style} />;
}

export const IsolatedBottomSheetModal = forwardRef<
  IsolatedBottomSheetModalRef,
  IsolatedBottomSheetModalProps
>(function IsolatedBottomSheetModal(props, ref) {
  const isNestedSheet = useContext(IsolatedBottomSheetScopeContext);
  const { children, ...bottomSheetProps } = props;

  const [webVisible, setWebVisible] = useState(false);

  useImperativeHandle(
    ref,
    () =>
      ({
        present: () => {
          if (isWeb) setWebVisible(true);
        },
        dismiss: () => {
          if (isWeb) setWebVisible(false);
        },
        close: () => {
          if (isWeb) setWebVisible(false);
        },
        snapToIndex: () => {},
        snapToPosition: () => {},
        expand: () => {},
        collapse: () => {},
        forceClose: () => {
          if (isWeb) setWebVisible(false);
        },
      }) as unknown as IsolatedBottomSheetModalRef,
    [],
  );

  const scopedChildren =
    typeof children === "function" ? (
      (input: { data?: unknown }) => (
        <IsolatedBottomSheetScopeContext.Provider value={true}>
          {children(input) as React.ReactNode}
        </IsolatedBottomSheetScopeContext.Provider>
      )
    ) : (
      <IsolatedBottomSheetScopeContext.Provider value={true}>
        {children}
      </IsolatedBottomSheetScopeContext.Provider>
    );

  if (isWeb) {
    if (!webVisible) return null;
    return (
      <Modal
        transparent
        visible={webVisible}
        animationType="fade"
        onRequestClose={() => setWebVisible(false)}
      >
        <GlassSurface
          radius="sheet"
          strong
          style={{
            margin: "auto",
            width: "90%",
            maxWidth: 500,
            maxHeight: "80%",
            overflow: "hidden",
          }}
        >
          {scopedChildren}
        </GlassSurface>
      </Modal>
    );
  }

  const modal = (
    <GorhomBottomSheetModal
      backgroundComponent={DefaultIsolatedSheetBackground}
      {...bottomSheetProps}
      ref={ref}
      enableDismissOnClose={false}
      stackBehavior={isNestedSheet ? "push" : "replace"}
    >
      {scopedChildren}
    </GorhomBottomSheetModal>
  );

  if (isNestedSheet) {
    return modal;
  }

  return (
    <Portal hostName="root">
      <BottomSheetModalProvider>{modal}</BottomSheetModalProvider>
    </Portal>
  );
});

export function useIsolatedBottomSheetVisibility({
  visible,
  isEnabled,
  onClose,
}: {
  visible: boolean;
  isEnabled?: boolean;
  onClose: () => void;
}) {
  const sheetRef = useRef<IsolatedBottomSheetModalRef>(null);
  const hasPresentedRef = useRef(false);

  useEffect(() => {
    if (isEnabled === false) return;

    if (visible) {
      if (hasPresentedRef.current) {
        sheetRef.current?.snapToIndex(0);
        return;
      }

      hasPresentedRef.current = true;
      sheetRef.current?.present();
      return;
    }

    if (hasPresentedRef.current) {
      sheetRef.current?.close();
    }
  }, [isEnabled, visible]);

  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1 && visible) {
        onClose();
      }
    },
    [onClose, visible],
  );

  return {
    sheetRef,
    handleSheetChange,
  };
}

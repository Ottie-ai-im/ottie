import {
  BottomSheetModal as GorhomBottomSheetModal,
  BottomSheetModalProvider,
  type BottomSheetModalProps,
  type BottomSheetBackgroundProps,
} from "@gorhom/bottom-sheet";
import { Portal } from "@gorhom/portal";
import React, { createContext, useContext } from "react";
import { forwardRef, useCallback, useEffect, useRef } from "react";
import type { ElementRef } from "react";
import { GlassSurface } from "./glass-surface";

type GorhomBottomSheetModalMethods = ElementRef<typeof GorhomBottomSheetModal>;

type IsolatedBottomSheetModalProps = Omit<
  BottomSheetModalProps,
  "enableDismissOnClose" | "stackBehavior"
>;

export type IsolatedBottomSheetModalRef = GorhomBottomSheetModalMethods;

const IsolatedBottomSheetScopeContext = createContext(false);

function DefaultIsolatedSheetBackground({ style }: BottomSheetBackgroundProps) {
  return <GlassSurface radius="sheet" strong style={style} />;
}

export const IsolatedBottomSheetModal = forwardRef<
  IsolatedBottomSheetModalRef,
  IsolatedBottomSheetModalProps
>(function IsolatedBottomSheetModal(props, ref) {
  const isNestedSheet = useContext(IsolatedBottomSheetScopeContext);
  const { children, ...bottomSheetProps } = props;
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

// SPDX-License-Identifier: MIT
// OpenRound's browser-native shell. No device artwork or simulated keyboard.
import * as Dialog from "@radix-ui/react-dialog";
import { forwardRef, useMemo, useRef, type CSSProperties, type InputHTMLAttributes, type ReactNode } from "react";

function dismissKeyboard() {
  if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) document.activeElement.blur();
}

export function useKeyboard() {
  return useMemo(() => ({ hide: dismissKeyboard }), []);
}

export const KeyboardInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function KeyboardInput(props, ref) { return <input {...props} ref={ref} />; },
);

export function BottomSheet({ open, onOpenChange, title, description, children, snap = 0.9 }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  snap?: number;
}) {
  const opener = useRef<HTMLElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="or-dialog-backdrop" />
      <Dialog.Content className="or-dialog" data-testid="bottom-sheet"
        style={{ "--sheet-height": `${Math.min(0.96, Math.max(0.35, snap)) * 100}dvh` } as CSSProperties}
        onOpenAutoFocus={event => {
          event.preventDefault();
          opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          closeButton.current?.focus();
        }}
        onCloseAutoFocus={event => {
          event.preventDefault();
          if (!document.querySelector('[role="dialog"]') && opener.current?.isConnected) opener.current.focus();
        }}>
        <header className="or-dialog-header">
          <div><Dialog.Title>{title}</Dialog.Title>
          {description ? <Dialog.Description>{description}</Dialog.Description> : <Dialog.Description className="visually-hidden">{title} options</Dialog.Description>}</div>
          <Dialog.Close ref={closeButton} className="or-dialog-close" aria-label="Close">×</Dialog.Close>
        </header>
        <div className="or-dialog-body">{children}</div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

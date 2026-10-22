import type { ReactNode } from "react";
import {
  ModalOverlay,
  Modal,
  Dialog as AriaDialog,
  Heading,
} from "react-aria-components";
import styles from "./Dialog.module.css";

export interface DialogProps {
  isOpen: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  role?: "dialog" | "alertdialog";
  isDismissable?: boolean;
  isKeyboardDismissDisabled?: boolean;
  children: ReactNode;
}

export function Dialog({
  title,
  children,
  role = "dialog",
  isDismissable = true,
  ...props
}: DialogProps): JSX.Element {
  return (
    <ModalOverlay
      {...props}
      isDismissable={isDismissable}
      className={styles.overlay}
    >
      <Modal className={styles.modal}>
        <AriaDialog role={role} className={styles.dialog}>
          <Heading slot="title" className={styles.title}>
            {title}
          </Heading>
          {children}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}

import {
  Button as AriaButton,
  type ButtonProps as AriaButtonProps,
} from "react-aria-components";
import styles from "./Button.module.css";

export type ButtonProps = AriaButtonProps & {
  variant?: "primary" | "secondary" | "danger" | "quiet";
};

export function Button({
  variant = "secondary",
  className,
  type = "button",
  ...props
}: ButtonProps): JSX.Element {
  return (
    <AriaButton
      {...props}
      type={type}
      className={(state) =>
        `${styles.button} ${styles[variant]} ${typeof className === "function" ? className(state) : (className ?? "")}`
      }
    />
  );
}

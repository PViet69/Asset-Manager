import type { ReactNode } from "react";
import {
  Checkbox as AriaCheckbox,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Select as AriaSelect,
  SelectValue,
  Input,
  Text as AriaText,
  TextField as AriaTextField,
  Button as AriaButton,
  type SelectProps,
  type TextFieldProps,
} from "react-aria-components";
import styles from "./Fields.module.css";

export function TextField({
  label,
  description,
  errorMessage,
  className,
  ...props
}: TextFieldProps & {
  label: string;
  description?: string;
  errorMessage?: string;
}): JSX.Element {
  return (
    <AriaTextField
      {...props}
      className={(state) =>
        `${styles.field} ${typeof className === "function" ? className(state) : (className ?? "")}`
      }
    >
      <Label className={styles.label}>{label}</Label>
      <Input className={styles.input} />
      {description && (
        <AriaText slot="description" className={styles.hint}>
          {description}
        </AriaText>
      )}
      {errorMessage && (
        <AriaText slot="errorMessage" className={styles.error}>
          {errorMessage}
        </AriaText>
      )}
    </AriaTextField>
  );
}

export function SelectField({
  label,
  value,
  options,
  onChange,
  isDisabled,
}: {
  label: string;
  value: string;
  options: readonly { id: string; label: string; icon?: ReactNode }[];
  onChange(value: string): void;
  isDisabled?: boolean;
}): JSX.Element {
  return (
    <AriaSelect
      aria-label={label}
      selectedKey={value}
      onSelectionChange={(key) => onChange(String(key))}
      isDisabled={isDisabled}
      className={styles.select}
    >
      <AriaButton className={styles.selectTrigger}>
        <SelectValue className={styles.optionContent} />
      </AriaButton>
      <Popover className={styles.popover}>
        <ListBox aria-label={label} className={styles.list}>
          {options.map((option) => (
            <ListBoxItem
              id={option.id}
              key={option.id}
              textValue={option.label}
              className={styles.option}
            >
              {option.icon}
              {option.label}
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
    </AriaSelect>
  );
}

export function CheckboxField({
  children,
  ...props
}: { children: ReactNode } & React.ComponentProps<
  typeof AriaCheckbox
>): JSX.Element {
  return (
    <AriaCheckbox {...props} className={styles.checkbox}>
      <span className={styles.check} aria-hidden="true" />
      {children}
    </AriaCheckbox>
  );
}

export type { SelectProps };

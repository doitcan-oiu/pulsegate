import { Children, isValidElement } from "react";
import type {
  ButtonHTMLAttributes,
  ChangeEvent,
  ComponentProps,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";
import {
  Button as HeroButton,
  Input as HeroInput,
  TextArea as HeroTextArea,
  Select as HeroSelect,
  ListBox,
  Checkbox as HeroCheckbox,
  Switch as HeroSwitch,
  Modal as HeroModal,
  Label,
  toast as heroToast,
} from "@heroui/react";

// These adapters only translate existing form events; rendering and interaction come from HeroUI.
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ComponentProps<typeof HeroButton>["variant"];
  size?: ComponentProps<typeof HeroButton>["size"];
  isIconOnly?: boolean;
  onPress?: ComponentProps<typeof HeroButton>["onPress"];
};
export function Button({
  disabled,
  className,
  variant,
  size = "md",
  isIconOnly,
  ...props
}: ButtonProps) {
  const inferred =
    /primary|(?:^|[- ])save(?:$|[- ])|(?:^|[- ])send(?:$|[- ])/.test(
      className || "",
    )
      ? "primary"
      : /danger|delete|revoke/.test(className || "")
        ? "danger-soft"
        : /icon-button|text-button|nav-item/.test(className || "")
          ? "ghost"
          : "secondary";
  return (
    <HeroButton
      {...(props as ComponentProps<typeof HeroButton>)}
      className={className}
      size={size}
      variant={variant ?? inferred}
      isDisabled={disabled}
      isIconOnly={isIconOnly ?? /icon-button/.test(className || "")}
    />
  );
}
export function Input(props: ComponentProps<typeof HeroInput>) {
  return <HeroInput {...props} fullWidth />;
}
export function TextArea(props: ComponentProps<typeof HeroTextArea>) {
  return <HeroTextArea {...props} fullWidth />;
}

type OptionProps = {
  value?: string | number;
  children?: ReactNode;
  disabled?: boolean;
};
function textContent(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? textContent(child.props.children)
        : String(child),
    )
    .join("");
}
function optionsFrom(
  children: ReactNode,
): { id: string; value: string; label: string; disabled: boolean }[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<OptionProps>(child)) return [];
    if (child.type !== "option") return optionsFrom(child.props.children);
    const label = textContent(child.props.children),
      value = String(child.props.value ?? label);
    return [
      {
        id: value || "__pulsegate_empty_option__",
        value,
        label,
        disabled: Boolean(child.props.disabled),
      },
    ];
  });
}
export function Select({
  value,
  defaultValue,
  onChange,
  disabled,
  required,
  children,
  className,
  name,
  id,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const options = optionsFrom(children);
  const empty = options.find((option) => !option.value);
  const key = value == null || String(value) === "" ? null : String(value);
  return (
    <HeroSelect
      aria-label={
        props["aria-label"] ??
        (props["aria-labelledby"] ? undefined : (name ?? "选择项目"))
      }
      aria-labelledby={props["aria-labelledby"]}
      aria-describedby={props["aria-describedby"]}
      aria-invalid={props["aria-invalid"]}
      id={id}
      name={name}
      className={className}
      value={value !== undefined ? key : undefined}
      defaultValue={
        defaultValue == null || String(defaultValue) === ""
          ? undefined
          : String(defaultValue)
      }
      isDisabled={disabled}
      isRequired={required}
      placeholder={empty?.label ?? "请选择"}
      disabledKeys={options
        .filter((option) => option.disabled)
        .map((option) => option.id)}
      onChange={(selected) => {
        const item = options.find((option) => option.id === selected);
        const next = item?.value ?? "";
        onChange?.({
          target: { value: next, name: name ?? "" },
          currentTarget: { value: next, name: name ?? "" },
        } as ChangeEvent<HTMLSelectElement>);
      }}
    >
      <HeroSelect.Trigger>
        <HeroSelect.Value />
        <HeroSelect.Indicator />
      </HeroSelect.Trigger>
      <HeroSelect.Popover>
        <ListBox items={options}>
          {(item) => (
            <ListBox.Item id={item.id} textValue={item.label}>
              <Label>{item.label}</Label>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          )}
        </ListBox>
      </HeroSelect.Popover>
    </HeroSelect>
  );
}
type ChoiceProps = Omit<InputHTMLAttributes<HTMLInputElement>, "children"> & {
  children?: ReactNode;
};
export function Checkbox({
  checked,
  defaultChecked,
  onChange,
  disabled,
  required,
  children,
  className,
  name,
  value,
  id,
  ...props
}: ChoiceProps) {
  return (
    <HeroCheckbox
      slot={null}
      id={id}
      name={name}
      value={value == null ? undefined : String(value)}
      isSelected={checked}
      defaultSelected={defaultChecked}
      isDisabled={disabled}
      isRequired={required}
      className={className}
      aria-label={
        props["aria-label"] ??
        (children || props["aria-labelledby"] ? undefined : "选择")
      }
      aria-labelledby={props["aria-labelledby"]}
      aria-describedby={props["aria-describedby"]}
      aria-invalid={props["aria-invalid"]}
      onChange={(selected) =>
        onChange?.({
          target: { checked: selected, value, name },
          currentTarget: { checked: selected, value, name },
        } as ChangeEvent<HTMLInputElement>)
      }
    >
      <HeroCheckbox.Content>
        <HeroCheckbox.Control>
          <HeroCheckbox.Indicator />
        </HeroCheckbox.Control>
        {children && <Label>{children}</Label>}
      </HeroCheckbox.Content>
    </HeroCheckbox>
  );
}
export function Switch({
  checked,
  defaultChecked,
  onChange,
  disabled,
  required,
  children,
  className,
  name,
  id,
  ...props
}: ChoiceProps) {
  return (
    <HeroSwitch
      slot={null}
      id={id}
      name={name}
      isSelected={checked}
      defaultSelected={defaultChecked}
      isDisabled={disabled}
      isRequired={required}
      className={className}
      aria-label={
        props["aria-label"] ??
        (children || props["aria-labelledby"] ? undefined : "启用")
      }
      aria-labelledby={props["aria-labelledby"]}
      aria-describedby={props["aria-describedby"]}
      aria-invalid={props["aria-invalid"]}
      onChange={(selected) =>
        onChange?.({
          target: { checked: selected, name },
          currentTarget: { checked: selected, name },
        } as ChangeEvent<HTMLInputElement>)
      }
    >
      <HeroSwitch.Content>
        <HeroSwitch.Control>
          <HeroSwitch.Thumb />
        </HeroSwitch.Control>
        {children && <Label>{children}</Label>}
      </HeroSwitch.Content>
    </HeroSwitch>
  );
}
export function Dialog({
  title,
  subtitle,
  children,
  close,
  wide = false,
  size,
  footer,
  className,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
  size?: "compact" | "default" | "wide";
  footer?: ReactNode;
  className?: string;
}) {
  const dialogSize = size ?? (wide ? "wide" : "default");
  return (
    <HeroModal.Backdrop
      isOpen
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <HeroModal.Container
        size={dialogSize === "wide" ? "lg" : dialogSize === "compact" ? "sm" : "md"}
        className="pg-dialog-container"
        placement="center"
        scroll="inside"
      >
        <HeroModal.Dialog
          aria-label={title}
          className={
            ["pg-dialog", `dialog-${dialogSize}`, className].filter(Boolean).join(" ")
          }
        >
          <HeroModal.CloseTrigger aria-label="关闭弹窗" />
          <HeroModal.Header>
            <HeroModal.Heading>{title}</HeroModal.Heading>
            {subtitle && <p className="dialog-description">{subtitle}</p>}
          </HeroModal.Header>
          <HeroModal.Body>{children}</HeroModal.Body>
          {footer && <HeroModal.Footer>{footer}</HeroModal.Footer>}
        </HeroModal.Dialog>
      </HeroModal.Container>
    </HeroModal.Backdrop>
  );
}
export const toast = Object.assign(
  (...args: Parameters<typeof heroToast>) => heroToast(...args),
  heroToast,
  { error: heroToast.danger },
);

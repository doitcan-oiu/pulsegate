import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Plus, Minus, Settings2 } from "lucide-react";
import { Label, NumberField } from "@heroui/react";
import { Switch } from "./ui";
import "./channel-panel-ui.css";

export function PanelSection({
  title,
  description,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="cp-section" aria-label={title}>
      <header className="cp-section-header">
        <div className="cp-section-heading">
          {Icon && (
            <span className="cp-section-icon">
              <Icon size={18} />
            </span>
          )}
          <div>
            <h3 className="cp-section-title">{title}</h3>
            {description && <p className="cp-section-description">{description}</p>}
          </div>
        </div>
        {action && <div className="cp-section-action">{action}</div>}
      </header>
      <div className="cp-section-content">{children}</div>
    </section>
  );
}

export function PanelEmpty({
  icon: Icon = Settings2,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="cp-empty">
      <span className="cp-empty-icon">
        <Icon size={24} />
      </span>
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function PanelNumber({
  label,
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  description,
  unit,
  disabled,
  formatOptions,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  description?: string;
  unit?: string;
  disabled?: boolean;
  formatOptions?: Intl.NumberFormatOptions;
}) {
  return (
    <div className="cp-number">
      <NumberField
        commitBehavior="validate"
        validationBehavior="aria"
        // Step sizes aid adjustment; stored prices and quotas need not be multiples of the step.
        isInvalid={
          !Number.isFinite(value) ||
          value < min ||
          (max !== undefined && value > max)
        }
        value={value}
        onChange={onChange}
        minValue={min}
        maxValue={max}
        step={step}
        isDisabled={disabled}
        fullWidth
        formatOptions={formatOptions ?? { maximumFractionDigits: 20 }}
      >
        <div className="cp-number-heading">
          <Label>{label}</Label>
          {unit && <span>{unit}</span>}
        </div>
        <NumberField.Group>
          <NumberField.DecrementButton aria-label={`减少${label}`}>
            <Minus size={15} />
          </NumberField.DecrementButton>
          <NumberField.Input />
          <NumberField.IncrementButton aria-label={`增加${label}`}>
            <Plus size={15} />
          </NumberField.IncrementButton>
        </NumberField.Group>
      </NumberField>
      {description && <p className="cp-note">{description}</p>}
    </div>
  );
}

export function PanelToggle({
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="cp-toggle">
      <div>
        <strong>{title}</strong>
        {description && <p>{description}</p>}
      </div>
      <Switch
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
        aria-label={title}
      />
    </div>
  );
}

import { Dropdown, Field, PanelSectionRow, SliderField, ToggleField } from "@decky/ui";

import {
  StreamSettingDescriptor,
  StreamSettingValue,
  StreamSettings,
  TRISTATE_VALUES,
} from "../core/stream-settings/descriptor";
import {
  SettingGroup,
  requirementLabel,
  requirementMet,
} from "../core/stream-settings/stream-settings";
import { SectionHeading } from "./SectionHeading";
import { sliderShown, sliderToggle } from "../core/stream-settings/slider-toggle";
import { OptionContext, optionsFor } from "../core/stream-settings/option-providers";

const INHERIT = "inherit";
const INHERIT_LABEL = "Moonlight decides";

export type StreamSettingChange = (key: string, value: StreamSettingValue | undefined) => void;

/**
 * Renders whatever the registry declares, grouped as the registry groups it. Nothing
 * here names a setting or a group, so a new descriptor arrives with no edit.
 */
export function StreamingControls({
  descriptors,
  groups,
  values,
  capabilities,
  sliderPositions,
  onChange,
  onSliderPosition,
}: {
  descriptors: readonly StreamSettingDescriptor[];
  groups: readonly SettingGroup[];
  values: StreamSettings;
  capabilities: OptionContext;
  sliderPositions: Readonly<Record<string, number>>;
  onChange: StreamSettingChange;
  onSliderPosition: (key: string, position: number) => void;
}) {
  return (
    <>
      {groups.map((group) => (
        <PanelSectionRow key={group.group}>
          <div style={{ width: "100%" }}>
            <SectionHeading level="group">{group.group}</SectionHeading>
            {group.settings.map((descriptor) => (
              <SettingControl
                key={descriptor.key}
                descriptor={descriptor}
                value={values[descriptor.key]}
                capabilities={capabilities}
                remembered={sliderPositions[descriptor.key]}
                blockedBy={requirementMet(descriptor, values) ? null : requirementLabel(descriptor, descriptors)}
                onChange={(value) => onChange(descriptor.key, value)}
                onSliderPosition={(position) => onSliderPosition(descriptor.key, position)}
              />
            ))}
          </div>
        </PanelSectionRow>
      ))}
    </>
  );
}

function SettingControl({
  descriptor,
  value,
  capabilities,
  remembered,
  blockedBy,
  onChange,
  onSliderPosition,
}: {
  descriptor: StreamSettingDescriptor;
  value: StreamSettingValue | undefined;
  capabilities: OptionContext;
  remembered: number | undefined;
  blockedBy: string | null;
  onChange: (value: StreamSettingValue | undefined) => void;
  onSliderPosition: (position: number) => void;
}) {
  switch (descriptor.kind) {
    case "tristate-toggle":
      return (
        <ChoiceRow
          label={descriptor.label}
          description={blockedBy ?? descriptor.description}
          options={TRISTATE_VALUES.map((state) => ({ data: state, label: capitalise(state) }))}
          value={value}
          disabled={blockedBy !== null}
          onChange={onChange}
        />
      );
    case "enum":
      return (
        <ChoiceRow
          label={descriptor.label}
          description={blockedBy ?? descriptor.description}
          options={optionsFor(descriptor, capabilities, value).map((option) => ({
            data: option.value,
            label: option.label,
          }))}
          value={value}
          disabled={blockedBy !== null}
          onChange={onChange}
        />
      );
    case "slider": {
      // Two ordinary stacked rows, the way Steam's performance panel presents its TDP
      // limit: d-pad down moves between them and neither nests a focusable.
      const shown = sliderShown(descriptor, value, remembered);
      const enabled = value !== undefined;
      return (
        <>
          <ToggleField
            label={descriptor.label}
            description={blockedBy ?? (enabled ? descriptor.description : INHERIT_LABEL)}
            checked={enabled}
            disabled={blockedBy !== null}
            onChange={(on) => onChange(sliderToggle(on, shown))}
          />
          <SliderField
            label={`${String(shown)} ${descriptor.unit}`}
            value={shown}
            min={descriptor.min}
            max={descriptor.max}
            step={descriptor.step}
            disabled={!enabled || blockedBy !== null}
            onChange={(position) => {
              onSliderPosition(position);
              onChange(position);
            }}
          />
        </>
      );
    }
  }
}

function ChoiceRow({
  label,
  description,
  options,
  value,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  options: readonly { data: StreamSettingValue; label: string }[];
  value: StreamSettingValue | undefined;
  disabled: boolean;
  onChange: (value: StreamSettingValue | undefined) => void;
}) {
  return (
    <Field
      label={label}
      description={description}
      childrenLayout="below"
      childrenContainerWidth="max"
    >
      <Dropdown
        rgOptions={[{ data: INHERIT, label: INHERIT_LABEL }, ...options]}
        selectedOption={value ?? INHERIT}
        disabled={disabled}
        onChange={(option) =>
          onChange(option.data === INHERIT ? undefined : (option.data as StreamSettingValue))
        }
      />
    </Field>
  );
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

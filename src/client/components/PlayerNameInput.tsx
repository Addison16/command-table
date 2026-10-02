import { useState } from 'react';
import { Field } from './ui.js';

export function PlayerNameInput({
  label,
  value,
  defaultName,
  onChange,
  disabled = false,
  hint,
}: {
  label: string;
  value: string;
  defaultName: string;
  onChange: (name: string) => void;
  disabled?: boolean;
  hint?: string;
}) {
  const [typedValue, setTypedValue] = useState<string>();
  return (
    <Field label={label} hint={hint}>
      <input
        value={value === defaultName && typedValue !== value ? '' : value}
        placeholder={defaultName}
        maxLength={40}
        autoComplete="nickname"
        disabled={disabled}
        onChange={(event) => {
          setTypedValue(event.target.value);
          onChange(event.target.value);
        }}
      />
    </Field>
  );
}

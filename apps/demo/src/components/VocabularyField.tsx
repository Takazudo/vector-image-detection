import { fieldClass, fieldHintClass, fieldInputClass, fieldLabelClass } from "./ui";

export interface VocabularyFieldProps {
  id: string;
  label: string;
  value: string;
  hint?: string;
  onChange: (value: string) => void;
}

/** Free-text vocabulary entry. Separators are commas and newlines, so multi-word labels survive. */
export function VocabularyField({ id, label, value, hint, onChange }: VocabularyFieldProps) {
  return (
    <div className={`${fieldClass} basis-field grow`}>
      <label className={fieldLabelClass} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={fieldInputClass}
        type="text"
        value={value}
        spellCheck={false}
        autoComplete="off"
        placeholder="cat, dog"
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && <p className={fieldHintClass}>{hint}</p>}
    </div>
  );
}

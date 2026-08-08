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
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="field__input"
        type="text"
        value={value}
        spellCheck={false}
        autoComplete="off"
        placeholder="cat, dog"
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && <p className="field__hint">{hint}</p>}
    </div>
  );
}

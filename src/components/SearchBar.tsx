interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

export function SearchBar({ value, onChange }: SearchBarProps) {
  return (
    <label className="field">
      <span>Search sessions</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search titles, summaries, or notes"
      />
    </label>
  );
}

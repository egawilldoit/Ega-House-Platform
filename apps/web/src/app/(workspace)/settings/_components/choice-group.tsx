export type ChoiceOption = {
  value: string;
  label: string;
  description?: string;
};

/**
 * Native radio group rendered as selectable cards.
 *
 * A real `<fieldset>/<legend>` keeps the group name and description available to
 * assistive technology, arrow-key navigation and Space/Enter selection come from
 * the radios themselves, and the visible focus ring is on the card wrapper
 * (`.choice-card`) rather than a decorative span. No client JavaScript needed.
 */
export function ChoiceGroup({
  name,
  legend,
  description,
  value,
  options,
  idPrefix,
}: {
  name: string;
  legend: string;
  description?: string;
  value: string;
  options: readonly ChoiceOption[];
  idPrefix: string;
}) {
  const descriptionId = description ? `${idPrefix}-description` : undefined;

  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={descriptionId}>
      <legend className="text-[length:var(--text-body)] font-medium text-ega-text">
        {legend}
      </legend>
      {description ? (
        <p
          id={descriptionId}
          className="text-[length:var(--text-meta)] text-ega-text-secondary"
        >
          {description}
        </p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <label key={option.value} className="choice-card">
            <input
              type="radio"
              name={name}
              value={option.value}
              defaultChecked={option.value === value}
              className="mt-0.5 h-4 w-4 flex-none accent-[var(--ega-ink)]"
            />
            <span className="min-w-0">
              <span className="choice-card-label">{option.label}</span>
              {option.description ? (
                <span className="choice-card-description">{option.description}</span>
              ) : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

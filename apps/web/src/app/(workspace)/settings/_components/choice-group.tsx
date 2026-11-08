import type { ReactNode } from "react";

import styles from "./choice-group.module.css";

export type ChoiceOption = {
  value: string;
  label: string;
  description?: string;
  /** Decorative preview rendered above/beside the label; never the only name. */
  preview?: ReactNode;
};

const GRID_CLASSES = {
  auto: styles.gridAuto,
  two: styles.gridTwo,
  three: styles.gridThree,
  five: styles.gridFive,
} as const;

/**
 * Native radio group rendered as selectable cards.
 *
 * A real `<fieldset>/<legend>` keeps the group name and description available to
 * assistive technology, arrow-key navigation and Space/Enter selection come from
 * the radios themselves, and the visible focus ring is on the card wrapper
 * rather than a decorative span. No client JavaScript is needed, so saved
 * values survive reload even before hydration.
 */
export function ChoiceGroup({
  name,
  legend,
  description,
  value,
  options,
  idPrefix,
  columns = "auto",
  layout = "row",
  visuallyHideInput = false,
  visuallyHideLegend = false,
  describedBy,
}: {
  name: string;
  legend: string;
  description?: string;
  value: string;
  options: readonly ChoiceOption[];
  idPrefix: string;
  columns?: keyof typeof GRID_CLASSES;
  layout?: "row" | "stack";
  /** Keeps the native radio focusable while a swatch or preview carries the UI. */
  visuallyHideInput?: boolean;
  /** Use when a visible section heading already names the group. */
  visuallyHideLegend?: boolean;
  /** External description id when the visible copy lives outside the group. */
  describedBy?: string;
}) {
  const descriptionId = description ? `${idPrefix}-description` : describedBy;

  return (
    <fieldset className={styles.group} aria-describedby={descriptionId}>
      <legend className={visuallyHideLegend ? styles.srOnly : styles.legend}>
        {legend}
      </legend>
      {description ? (
        <p id={descriptionId} className={styles.description}>
          {description}
        </p>
      ) : null}
      <div className={`${styles.grid} ${GRID_CLASSES[columns]}`}>
        {options.map((option) => (
          <label
            key={option.value}
            className={`${styles.card} ${layout === "stack" ? styles.cardStack : styles.cardRow}`}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              defaultChecked={option.value === value}
              className={visuallyHideInput ? styles.inputHidden : styles.input}
            />
            {option.preview ? (
              <span className={styles.preview}>{option.preview}</span>
            ) : null}
            <span className={styles.copy}>
              <span className={styles.label}>{option.label}</span>
              {option.description ? (
                <span className={styles.cardDescription}>{option.description}</span>
              ) : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ChoiceGroup } from "./choice-group";

const OPTIONS = [
  { value: "system", label: "System", description: "Follow this device." },
  { value: "dark", label: "Dark", description: "Always dark." },
] as const;

test("renders a native radio group with a legend and linked description", () => {
  const markup = renderToStaticMarkup(
    <ChoiceGroup
      name="theme"
      legend="Theme"
      description="Choose one."
      value="dark"
      options={OPTIONS}
      idPrefix="appearance-theme"
    />,
  );

  assert.match(markup, /<fieldset[^>]*aria-describedby="appearance-theme-description"/);
  assert.match(markup, /<legend[^>]*>Theme<\/legend>/);
  assert.match(markup, /id="appearance-theme-description"/);
  assert.match(markup, /type="radio"/g);
  assert.match(markup, /name="theme"/);
  assert.match(markup, /value="system"/);
  assert.match(markup, /value="dark"/);
});

test("marks the current value checked and keeps descriptions inside the label", () => {
  const markup = renderToStaticMarkup(
    <ChoiceGroup
      name="theme"
      legend="Theme"
      value="dark"
      options={OPTIONS}
      idPrefix="appearance-theme"
    />,
  );

  const darkInput = markup.match(/<input[^>]*value="dark"[^>]*>/)?.[0] ?? "";
  const systemInput = markup.match(/<input[^>]*value="system"[^>]*>/)?.[0] ?? "";
  assert.match(darkInput, /checked=""/);
  assert.doesNotMatch(systemInput, /checked=""/);

  // Each option is one label: radio + title + description are announced together.
  const labels = markup.match(/<label[^>]*>[\s\S]*?<\/label>/g) ?? [];
  assert.equal(labels.length, OPTIONS.length);
  assert.ok(labels.every((label) => label.includes('type="radio"')));
  assert.ok(labels.some((label) => label.includes("Follow this device.")));
});

test("omits the described-by attribute when no group description is supplied", () => {
  const markup = renderToStaticMarkup(
    <ChoiceGroup
      name="density"
      legend="Density"
      value="comfortable"
      options={OPTIONS}
      idPrefix="appearance-density"
    />,
  );

  assert.doesNotMatch(markup, /aria-describedby/);
  assert.match(markup, /<legend[^>]*>Density<\/legend>/);
});

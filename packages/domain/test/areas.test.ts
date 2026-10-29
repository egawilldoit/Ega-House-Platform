import assert from "node:assert/strict";
import test from "node:test";

import {
  AREA_DESCRIPTION_MAX_LENGTH,
  AREA_NAME_MAX_LENGTH,
  DEFAULT_AREA_COLOR,
  DEFAULT_AREA_ICON,
  isAreaColor,
  isAreaIcon,
  normalizeAreaFormValues,
} from "../src/index";

test("area tokens accept the documented allowlists only", () => {
  assert.equal(isAreaIcon("briefcase"), true);
  assert.equal(isAreaIcon("data:image/svg+xml"), false);
  assert.equal(isAreaColor("blue"), true);
  assert.equal(isAreaColor("#ff0000"), false);
});

test("area normalization trims and defaults presentation tokens", () => {
  const result = normalizeAreaFormValues({
    name: "  Job hunt  ",
    icon: "not-an-icon",
    color: "not-a-colour",
    description: "  Applications  ",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.values, {
    name: "Job hunt",
    icon: DEFAULT_AREA_ICON,
    color: DEFAULT_AREA_COLOR,
    description: "Applications",
  });
});

test("area normalization rejects missing and over-long fields", () => {
  assert.equal(
    normalizeAreaFormValues({
      name: " ",
      icon: "folder",
      color: "slate",
      description: "",
    }).ok,
    false,
  );

  assert.equal(
    normalizeAreaFormValues({
      name: "x".repeat(AREA_NAME_MAX_LENGTH + 1),
      icon: "folder",
      color: "slate",
      description: "",
    }).ok,
    false,
  );

  assert.equal(
    normalizeAreaFormValues({
      name: "Job hunt",
      icon: "folder",
      color: "slate",
      description: "x".repeat(AREA_DESCRIPTION_MAX_LENGTH + 1),
    }).ok,
    false,
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import { buildHomeGreeting } from "./home-greeting";

const NAME = "ab.mortaki";

test("EGA-663: greeting follows the canonical account timezone, not the runtime zone", () => {
  // 10:30 UTC is morning in Africa/Casablanca (UTC+1).
  const greeting = buildHomeGreeting({
    date: "2024-09-24",
    timezone: "Africa/Casablanca",
    name: NAME,
    now: new Date("2024-09-24T10:30:00.000Z"),
  });

  assert.equal(greeting.greeting, "Good morning, ab.mortaki");
  assert.equal(greeting.dateLine, "TUE, SEP 24, 2024");
  assert.equal(greeting.fullDateLine, "Tuesday, September 24");
  assert.equal(greeting.subtitle, "Let's make progress today.");
});

test("EGA-663: the same instant yields evening in a far-east account zone", () => {
  const greeting = buildHomeGreeting({
    date: "2024-09-24",
    timezone: "Asia/Tokyo",
    name: NAME,
    now: new Date("2024-09-24T10:30:00.000Z"),
  });

  // 19:30 Tokyo — evening, same local date.
  assert.equal(greeting.greeting, "Good evening, ab.mortaki");
  assert.equal(greeting.dateLine, "TUE, SEP 24, 2024");
});

test("EGA-663: the canonical local date is rendered verbatim", () => {
  // 05:00 UTC is still the previous evening in America/Los_Angeles, so the
  // supplied canonical date (2024-09-23) is rendered as-is regardless of zone.
  const greeting = buildHomeGreeting({
    date: "2024-09-23",
    timezone: "America/Los_Angeles",
    name: NAME,
    now: new Date("2024-09-24T05:00:00.000Z"),
  });

  assert.equal(greeting.greeting, "Good evening, ab.mortaki");
  assert.equal(greeting.dateLine, "MON, SEP 23, 2024");
  assert.equal(greeting.fullDateLine, "Monday, September 23");
});

test("EGA-663: the date line is stable in far-east zones at UTC+12 and later", () => {
  // Rendering noon-UTC inside a UTC+12/+14 zone rolls to the next local day,
  // which used to show the wrong weekday/month for these accounts.
  for (const timezone of ["Pacific/Auckland", "Pacific/Chatham", "Pacific/Kiritimati"]) {
    const midMonth = buildHomeGreeting({
      date: "2024-09-24",
      timezone,
      name: NAME,
      now: new Date("2024-09-24T02:00:00.000Z"),
    });
    assert.equal(midMonth.dateLine, "TUE, SEP 24, 2024", `date line drifted in ${timezone}`);
    assert.equal(midMonth.fullDateLine, "Tuesday, September 24", `full date drifted in ${timezone}`);

    // Month-end proves the month name is not rolled forward either.
    const monthEnd = buildHomeGreeting({
      date: "2024-09-30",
      timezone,
      name: NAME,
      now: new Date("2024-09-30T02:00:00.000Z"),
    });
    assert.equal(monthEnd.dateLine, "MON, SEP 30, 2024", `month rolled in ${timezone}`);
    assert.equal(monthEnd.fullDateLine, "Monday, September 30", `month rolled in ${timezone}`);
  }
});

test("EGA-663: afternoon and evening boundaries follow local hours", () => {
  const afternoon = buildHomeGreeting({
    date: "2024-09-24",
    timezone: "UTC",
    name: NAME,
    now: new Date("2024-09-24T13:00:00.000Z"),
  });
  assert.equal(afternoon.greeting, "Good afternoon, ab.mortaki");

  const evening = buildHomeGreeting({
    date: "2024-09-24",
    timezone: "UTC",
    name: NAME,
    now: new Date("2024-09-24T18:00:00.000Z"),
  });
  assert.equal(evening.greeting, "Good evening, ab.mortaki");

  const midnight = buildHomeGreeting({
    date: "2024-09-24",
    timezone: "UTC",
    name: NAME,
    now: new Date("2024-09-24T00:00:00.000Z"),
  });
  assert.equal(midnight.greeting, "Good morning, ab.mortaki");
});

test("EGA-663: the display name is trimmed and never fabricates a first name", () => {
  const greeting = buildHomeGreeting({
    date: "2024-09-24",
    timezone: "UTC",
    name: "  ab.mortaki  ",
    now: new Date("2024-09-24T10:00:00.000Z"),
  });

  assert.equal(greeting.greeting, "Good morning, ab.mortaki");
});

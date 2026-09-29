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

test("EGA-663: the displayed date shifts with the account zone", () => {
  // 05:00 UTC is still the previous evening in America/Los_Angeles.
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

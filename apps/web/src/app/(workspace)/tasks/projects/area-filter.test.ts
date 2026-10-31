import assert from "node:assert/strict";
import test from "node:test";

import {
  ALL_PROJECT_AREAS,
  buildProjectsHref,
  groupProjectsByArea,
  parseProjectAreaQuery,
  toRepositoryAreaFilter,
} from "./area-filter";

const AREA_ID = "11111111-1111-4111-8111-111111111111";

test("area query parsing falls back to all for legacy or malformed URLs", () => {
  assert.deepEqual(parseProjectAreaQuery(undefined), ALL_PROJECT_AREAS);
  assert.deepEqual(parseProjectAreaQuery(""), ALL_PROJECT_AREAS);
  assert.deepEqual(parseProjectAreaQuery("not-a-uuid"), ALL_PROJECT_AREAS);
  assert.deepEqual(parseProjectAreaQuery("unassigned"), { kind: "unassigned" });
  assert.deepEqual(parseProjectAreaQuery(AREA_ID), { kind: "area", areaId: AREA_ID });
});

test("area filter never drops the existing view parameter", () => {
  assert.equal(
    buildProjectsHref("archived", { kind: "area", areaId: AREA_ID }),
    `/tasks/projects?view=archived&area=${AREA_ID}`,
  );
  assert.equal(buildProjectsHref("active", ALL_PROJECT_AREAS), "/tasks/projects");
  assert.equal(
    buildProjectsHref("all", { kind: "unassigned" }),
    "/tasks/projects?view=all&area=unassigned",
  );
  assert.deepEqual(toRepositoryAreaFilter({ kind: "unassigned" }), {
    kind: "unassigned",
  });
  assert.equal(toRepositoryAreaFilter(ALL_PROJECT_AREAS), null);
});

test("grouping keeps every project and puts unassigned last", () => {
  const areas = [
    {
      id: AREA_ID,
      name: "Job hunt",
      icon: "briefcase",
      color: "blue",
      description: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Gymtrack",
      icon: "dumbbell",
      color: "green",
      description: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  const projects = [
    {
      id: "p1",
      areaId: AREA_ID,
      areaName: "Job hunt",
      areaIcon: "briefcase",
      areaColor: "blue",
    },
    { id: "p2", areaId: null, areaName: null, areaIcon: null, areaColor: null },
    {
      id: "p3",
      areaId: "22222222-2222-4222-8222-222222222222",
      areaName: "Gymtrack",
      areaIcon: "dumbbell",
      areaColor: "green",
    },
    {
      id: "p4",
      areaId: "33333333-3333-4333-8333-333333333333",
      areaName: "Legacy area",
      areaIcon: null,
      areaColor: null,
    },
  ];

  const groups = groupProjectsByArea(projects, areas);

  assert.deepEqual(
    groups.map((group) => [group.name, group.projects.map((project) => project.id)]),
    [
      ["Job hunt", ["p1"]],
      ["Gymtrack", ["p3"]],
      ["Legacy area", ["p4"]],
      ["Unassigned", ["p2"]],
    ],
  );
});

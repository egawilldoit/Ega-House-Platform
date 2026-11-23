import { createAuthenticatedActor } from "@ega/application";
import type {
  AuthenticatedActor,
  ExpenseRepository,
  MoneyCoffeeVisitCreateInput,
  MoneyCoffeeVisitRepository,
  MoneyCreateRecordInput,
  MoneyImportAdoptionRecord,
  MoneyImportAdoptionWrite,
  MoneyImportRepository,
  MoneyImportTargetCoffeeVisit,
  MoneyImportTargetMovement,
  MoneyImportTargetObligation,
  MoneyMovementRepository,
  MoneyPeriodCreateRecordInput,
  MoneyPeriodRepository,
  NovemberImportDependencies,
  RepositoryResult,
} from "../src";
import type { ExpenseCategory, PersonalExpense } from "@ega/domain/expenses";
import type {
  MoneyCoffeeVisitRecord,
  MoneyDirection,
  MoneyKind,
  MoneyLedgerRow,
  MoneyOpening,
  MoneyPeriod,
} from "@ega/domain/money";

export const IMPORT_ACTOR = createAuthenticatedActor("owner-import-a");
export const OTHER_ACTOR = createAuthenticatedActor("owner-import-b");
export const IMPORT_ENVIRONMENT = "test";

export type StoredImportMovement = MoneyLedgerRow & {
  ownerUserId: string;
  createFingerprint: string;
  idempotencyKey: string;
};

type StoredVisit = MoneyCoffeeVisitRecord & {
  ownerUserId: string;
  visitFingerprint: string;
};

type SeededObligation = MoneyImportTargetObligation & { ownerUserId: string };

export type ImportHarness = {
  deps: NovemberImportDependencies;
  state: {
    movements: StoredImportMovement[];
    periods: MoneyPeriod[];
    openings: Map<string, MoneyOpening>;
    visits: StoredVisit[];
    obligations: SeededObligation[];
    adoptions: Map<string, MoneyImportAdoptionRecord>;
    writes: {
      adoption: number;
      movement: number;
      period: number;
      visit: number;
    };
    failMovementCreateAfter: number | null;
    movementCreateAttempts: number;
    afterMovementCreate: ((count: number) => void) | null;
    afterCoffeeVisitCreate: ((visitId: string) => void) | null;
  };
  seedMovement(input: {
    idempotencyKey?: string;
    kind: MoneyKind;
    direction: MoneyDirection;
    amountMinor: number;
    category?: ExpenseCategory | null;
    note?: string | null;
    merchant?: string | null;
    needVsWant?: "need" | "want" | null;
    purpose?: "fixed" | "flexible" | "emergency" | null;
    countsInDaily?: boolean;
    bookingDate: string;
    occurredAt?: string | null;
    deletedAt?: string | null;
    ownerUserId?: string;
  }): StoredImportMovement;
  seedObligation(input: {
    id?: string;
    description: string;
    amountMinor: number;
    dueDate: string;
    periodStart?: string;
    periodEnd?: string;
    state?: string;
    paymentExpenseId?: string | null;
    ownerUserId?: string;
  }): SeededObligation;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function seededUuid(value: string): string {
  if (UUID_RE.test(value)) return value;
  const digits = String(value)
    .replace(/\D/g, "")
    .padStart(11, "0")
    .slice(-11);
  return `00000000-0000-4000-8000-9${digits}`;
}

export function createImportHarness(): ImportHarness {
  let sequence = 0;
  const nextId = () =>
    `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
  const nowIso = "2026-11-23T10:00:00.000Z";

  const state: ImportHarness["state"] = {
    movements: [],
    periods: [],
    openings: new Map(),
    visits: [],
    obligations: [],
    adoptions: new Map(),
    writes: { adoption: 0, movement: 0, period: 0, visit: 0 },
    failMovementCreateAfter: null,
    movementCreateAttempts: 0,
    afterMovementCreate: null,
    afterCoffeeVisitCreate: null,
  };

  function publicRow(row: StoredImportMovement): MoneyLedgerRow {
    const {
      ownerUserId: _owner,
      createFingerprint: _fingerprint,
      idempotencyKey: _key,
      ...rest
    } = row;
    void _owner;
    void _fingerprint;
    void _key;
    return rest;
  }

  function targetMovement(row: StoredImportMovement): MoneyImportTargetMovement {
    return {
      id: row.id,
      idempotencyKey: row.idempotencyKey,
      kind: row.kind,
      direction: row.direction,
      amountMinor: row.amountMinor,
      category: row.category,
      note: row.note,
      merchant: row.merchant,
      bookingDate: row.bookingDate,
      deletedAt: row.deletedAt,
    };
  }

  function toPersonalExpense(row: StoredImportMovement): PersonalExpense {
    return {
      id: row.id,
      kind: "expense",
      direction: "out",
      occurredAt: row.occurredAt,
      bookingDate: row.bookingDate,
      amountMinor: row.amountMinor,
      currency: "MAD",
      category: (row.category ?? "other") as ExpenseCategory,
      note: row.note,
      merchant: row.merchant,
      needVsWant: row.needVsWant ?? "need",
      paymentMethod: row.paymentMethod,
      purpose: row.purpose,
      countsInDaily: row.countsInDaily,
      periodId: row.periodId,
      idempotencyKey: row.idempotencyKey,
      version: row.version,
      deletedAt: row.deletedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  const movementRepository: MoneyMovementRepository = {
    async findByIdempotencyKey(actor, key) {
      const row = state.movements.find(
        (entry) => entry.ownerUserId === actor.userId && entry.idempotencyKey === key,
      );
      if (!row) return { ok: true, value: null };
      return {
        ok: true,
        value: {
          movement: publicRow(row),
          createFingerprint: row.createFingerprint,
        },
      };
    },
    async create(actor, input: MoneyCreateRecordInput) {
      state.movementCreateAttempts += 1;
      if (
        state.failMovementCreateAfter !== null &&
        state.movementCreateAttempts > state.failMovementCreateAfter
      ) {
        return { ok: false, error: { code: "unknown" } };
      }
      const existing = state.movements.find(
        (entry) =>
          entry.ownerUserId === actor.userId &&
          entry.idempotencyKey === input.values.idempotencyKey,
      );
      if (existing) {
        if (existing.createFingerprint !== input.createFingerprint) {
          return { ok: false, error: { code: "conflict" } };
        }
        return { ok: true, value: publicRow(existing) };
      }
      const row: StoredImportMovement = {
        id: nextId(),
        ownerUserId: actor.userId,
        kind: input.values.kind,
        direction: input.values.direction,
        amountMinor: input.values.amountMinor,
        currency: "MAD",
        category: input.values.category,
        note: input.values.note,
        merchant: input.values.merchant,
        needVsWant: input.values.needVsWant,
        paymentMethod: input.values.paymentMethod,
        purpose: input.values.purpose,
        countsInDaily: input.values.countsInDaily,
        bookingDate: input.values.bookingDate,
        occurredAt: input.values.occurredAt,
        periodId: input.periodId,
        version: 1,
        deletedAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
        createFingerprint: input.createFingerprint,
        idempotencyKey: input.values.idempotencyKey,
      };
      state.movements.push(row);
      state.writes.movement += 1;
      state.afterMovementCreate?.(state.writes.movement);
      return { ok: true, value: publicRow(row) };
    },
    async get() {
      throw new Error("get is not used by the import use case");
    },
    async list() {
      throw new Error("list is not used by the import use case");
    },
    async update() {
      throw new Error("update is not used by the import use case");
    },
    async aggregate() {
      throw new Error("aggregate is not used by the import use case");
    },
  };

  const periodRepository: MoneyPeriodRepository = {
    async findTracking() {
      const tracking = state.periods.find((entry) => entry.lifecycle === "tracking");
      return { ok: true, value: tracking ?? null };
    },
    async findById(_actor, id) {
      return { ok: true, value: state.periods.find((entry) => entry.id === id) ?? null };
    },
    async findByExactRange(_actor, range) {
      return {
        ok: true,
        value: state.periods.filter(
          (entry) =>
            entry.startDate === range.startDate && entry.endDate === range.endDate,
        ),
      };
    },
    async findOverlapping(_actor, range) {
      return {
        ok: true,
        value: state.periods.filter(
          (entry) => entry.startDate <= range.endDate && range.startDate <= entry.endDate,
        ),
      };
    },
    async list() {
      return { ok: true, value: [...state.periods] };
    },
    async create(actor, input: MoneyPeriodCreateRecordInput) {
      const values = input.values;
      const overlapping = state.periods.some(
        (entry) => entry.startDate <= values.endDate && values.startDate <= entry.endDate,
      );
      if (overlapping || state.periods.some((entry) => entry.lifecycle === "tracking")) {
        return { ok: false, error: { code: "conflict" } };
      }
      const id = nextId();
      let openingMovementId: string | null = null;
      if (values.opening) {
        const openingId = nextId();
        const openingRow: StoredImportMovement = {
          id: openingId,
          ownerUserId: actor.userId,
          kind: "opening",
          direction: "in",
          amountMinor: values.opening.amountMinor,
          currency: "MAD",
          category: null,
          note: values.opening.note,
          merchant: null,
          needVsWant: null,
          paymentMethod: null,
          purpose: null,
          countsInDaily: false,
          bookingDate: values.startDate,
          occurredAt: null,
          periodId: id,
          version: 1,
          deletedAt: null,
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
          createFingerprint: input.openingCreateFingerprint ?? "0".repeat(64),
          idempotencyKey: `opening:${id}`,
        };
        state.movements.push(openingRow);
        state.openings.set(openingId, {
          id: openingId,
          amountMinor: values.opening.amountMinor,
          currency: "MAD",
          bookingDate: values.startDate,
          version: 1,
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
        });
        openingMovementId = openingId;
      }
      const period: MoneyPeriod = {
        id,
        startDate: values.startDate,
        endDate: values.endDate,
        currency: "MAD",
        timezone: values.timezone,
        activeDate: values.activeDate,
        lifecycle: "tracking",
        initialization: values.opening ? "reconciled" : "uninitialized",
        openingMovementId,
        provenance: input.provenance,
        settings: values.settings,
        version: values.opening ? 2 : 1,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      };
      state.periods.push(period);
      state.writes.period += 1;
      return { ok: true, value: period };
    },
    async update() {
      throw new Error("update is not used by the import use case");
    },
    async getOpening(_actor, id) {
      return { ok: true, value: state.openings.get(id) ?? null };
    },
    async sumLedgerByDirection(actor, window) {
      const rows = state.movements.filter(
        (entry) =>
          entry.ownerUserId === actor.userId &&
          entry.deletedAt === null &&
          entry.kind !== "opening" &&
          entry.bookingDate >= window.startDate &&
          entry.bookingDate <= window.endDateInclusive,
      );
      let inflowsMinor = 0;
      let outflowsMinor = 0;
      for (const row of rows) {
        if (row.direction === "in") inflowsMinor += row.amountMinor;
        else outflowsMinor += row.amountMinor;
      }
      return {
        ok: true,
        value: {
          inflowsMinor,
          outflowsMinor,
          recordCount: rows.length,
          truncated: false,
        },
      };
    },
    async ledgerOverview() {
      throw new Error("ledgerOverview is not used by the import use case");
    },
    async getDayCloseForDate() {
      throw new Error("getDayCloseForDate is not used by the import use case");
    },
    async getReserveInputs() {
      throw new Error("getReserveInputs is not used by the import use case");
    },
  };

  const coffeeRepository: MoneyCoffeeVisitRepository = {
    async findByVisitKey(actor, visitKey) {
      const visit = state.visits.find(
        (entry) => entry.ownerUserId === actor.userId && entry.visitKey === visitKey,
      );
      return { ok: true, value: visit ? stripVisit(visit) : null };
    },
    async createVisit(actor, input: MoneyCoffeeVisitCreateInput) {
      state.writes.visit += 1;
      const visit: StoredVisit = {
        id: nextId(),
        ownerUserId: actor.userId,
        visitKey: input.values.visitKey,
        visitFingerprint: input.visitFingerprint,
        localDate: input.values.localDate,
        timezone: input.values.timezone,
        note: input.values.note,
        version: 1,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
        lines: input.values.expenseIds.map((expenseId) => {
          const row = state.movements.find(
            (entry) => entry.ownerUserId === actor.userId && entry.id === expenseId,
          );
          return {
            expenseId,
            amountMinor: row?.amountMinor ?? 0,
            category: row?.category ?? "other",
            bookingDate: row?.bookingDate ?? input.values.localDate,
            deletedAt: row?.deletedAt ?? null,
          };
        }),
      };
      state.visits.push(visit);
      state.afterCoffeeVisitCreate?.(visit.id);
      return { ok: true, value: stripVisit(visit) };
    },
    async getVisit(actor, id) {
      const visit = state.visits.find(
        (entry) => entry.ownerUserId === actor.userId && entry.id === id,
      );
      return { ok: true, value: visit ? stripVisit(visit) : null };
    },
    async listVisits(actor, query) {
      return {
        ok: true,
        value: state.visits
          .filter(
            (entry) =>
              entry.ownerUserId === actor.userId &&
              entry.localDate >= query.from &&
              entry.localDate <= query.to,
          )
          .slice(query.offset, query.offset + query.limit)
          .map(stripVisit),
      };
    },
    async deleteVisit() {
      throw new Error("deleteVisit is not used by the import use case");
    },
    async listVisitIdsForExpense(actor, expenseId) {
      return {
        ok: true,
        value: state.visits
          .filter(
            (entry) =>
              entry.ownerUserId === actor.userId &&
              entry.lines.some((line) => line.expenseId === expenseId),
          )
          .map((entry) => entry.id),
      };
    },
  };

  const expenseRepository = {
    async get(actor: AuthenticatedActor, id: string) {
      const row = state.movements.find(
        (entry) =>
          entry.ownerUserId === actor.userId &&
          entry.id === id &&
          entry.kind === "expense" &&
          entry.deletedAt === null,
      );
      if (!row) return { ok: true, value: null };
      return { ok: true, value: toPersonalExpense(row) };
    },
  } as unknown as ExpenseRepository;

  function stripVisit(visit: StoredVisit): MoneyCoffeeVisitRecord {
    const { ownerUserId: _owner, ...rest } = visit;
    void _owner;
    return rest;
  }

  const importRepository: MoneyImportRepository = {
    async listTargetMovements(actor, range) {
      return {
        ok: true,
        value: state.movements
          .filter(
            (entry) =>
              entry.ownerUserId === actor.userId &&
              entry.deletedAt === null &&
              entry.bookingDate >= range.startDate &&
              entry.bookingDate <= range.endDate,
          )
          .map(targetMovement),
      };
    },
    async listTargetMovementsBefore(actor, beforeDate, limit) {
      return {
        ok: true,
        value: state.movements
          .filter(
            (entry) =>
              entry.ownerUserId === actor.userId &&
              entry.deletedAt === null &&
              entry.bookingDate < beforeDate,
          )
          .sort((left, right) => {
            if (left.bookingDate !== right.bookingDate) {
              return left.bookingDate < right.bookingDate ? 1 : -1;
            }
            return left.id < right.id ? 1 : left.id > right.id ? -1 : 0;
          })
          .slice(0, Math.max(0, limit))
          .map(targetMovement),
      };
    },
    async listTargetObligations(actor, range) {
      return {
        ok: true,
        value: state.obligations.filter(
          (entry) =>
            entry.ownerUserId === actor.userId &&
            entry.dueDate >= range.startDate &&
            entry.dueDate <= range.endDate,
        ),
      };
    },
    async listTargetCoffeeVisits(actor, range) {
      return {
        ok: true,
        value: state.visits
          .filter(
            (entry) =>
              entry.ownerUserId === actor.userId &&
              entry.localDate >= range.startDate &&
              entry.localDate <= range.endDate,
          )
          .map((entry): MoneyImportTargetCoffeeVisit => ({
            id: entry.id,
            visitKey: entry.visitKey,
            localDate: entry.localDate,
            expenseIds: entry.lines.map((line) => line.expenseId),
          })),
      };
    },
    async getAdoption(actor, snapshotId) {
      return {
        ok: true,
        value: state.adoptions.get(`${actor.userId}:${snapshotId}`) ?? null,
      };
    },
    async beginAdoption(actor, record: MoneyImportAdoptionWrite) {
      const key = `${actor.userId}:${record.snapshotId}`;
      if (state.adoptions.has(key)) {
        return { ok: false, error: { code: "conflict" } };
      }
      state.writes.adoption += 1;
      const stored: MoneyImportAdoptionRecord = { id: nextId(), ...record };
      state.adoptions.set(key, stored);
      return { ok: true, value: stored };
    },
    async completeAdoption(actor, record) {
      return finish(actor, record, "adopted");
    },
    async markAdoptionReview(actor, record) {
      return finish(actor, record, "review_needed");
    },
    async listMovementsByKeys(actor, keys) {
      const wanted = new Set(keys);
      return {
        ok: true,
        value: state.movements
          .filter(
            (entry) =>
              entry.ownerUserId === actor.userId &&
              entry.deletedAt === null &&
              wanted.has(entry.idempotencyKey),
          )
          .map(targetMovement),
      };
    },
  };

  function finish(
    actor: AuthenticatedActor,
    record: MoneyImportAdoptionRecord,
    status: "adopted" | "review_needed",
  ): RepositoryResult<MoneyImportAdoptionRecord> {
    const key = `${actor.userId}:${record.snapshotId}`;
    const existing = state.adoptions.get(key);
    if (!existing || existing.status !== "applying") {
      return { ok: false, error: { code: "conflict" } };
    }
    state.writes.adoption += 1;
    const saved: MoneyImportAdoptionRecord = { ...record, status };
    state.adoptions.set(key, saved);
    return { ok: true, value: saved };
  }

  return {
    deps: {
      imports: importRepository,
      periods: periodRepository,
      movements: movementRepository,
      coffee: coffeeRepository,
      expenses: expenseRepository,
    },
    state,
    seedMovement(input) {
      const row: StoredImportMovement = {
        id: seededUuid(`seed${sequence + 1}`),
        ownerUserId: input.ownerUserId ?? IMPORT_ACTOR.userId,
        kind: input.kind,
        direction: input.direction,
        amountMinor: input.amountMinor,
        currency: "MAD",
        category: input.category ?? null,
        note: input.note ?? null,
        merchant: input.merchant ?? null,
        needVsWant: input.needVsWant ?? null,
        paymentMethod: null,
        purpose: input.purpose ?? null,
        countsInDaily: input.countsInDaily ?? false,
        bookingDate: input.bookingDate,
        occurredAt: input.occurredAt ?? null,
        periodId: null,
        version: 1,
        deletedAt: input.deletedAt ?? null,
        createdAt: nowIso,
        updatedAt: nowIso,
        createFingerprint: "f".repeat(64),
        idempotencyKey: input.idempotencyKey ?? `seed-${sequence + 1}`,
      };
      sequence += 1;
      state.movements.push(row);
      return row;
    },
    seedObligation(input) {
      const obligation: SeededObligation = {
        id: input.id ?? seededUuid(`obligation${sequence + 1}`),
        ownerUserId: input.ownerUserId ?? IMPORT_ACTOR.userId,
        description: input.description,
        amountMinor: input.amountMinor,
        dueDate: input.dueDate,
        periodStart: input.periodStart ?? "2026-11-01",
        periodEnd: input.periodEnd ?? "2026-11-30",
        state: input.state ?? "pending",
        paymentExpenseId: input.paymentExpenseId ?? null,
      };
      state.obligations.push(obligation);
      return obligation;
    },
  };
}

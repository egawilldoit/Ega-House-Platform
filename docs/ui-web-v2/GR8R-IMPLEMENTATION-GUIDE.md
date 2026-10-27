# Gr8r implementation guide

How to rebuild the Gr8r-inspired workspace upgrades inside EGA House. This
guide is the working summary of the contract in
[EGA-771](https://linear.app/egawilldoit/issue/EGA-771/chore-gr8r-upgrade-w0-build-health-baseline-before-frontend-work);
the Linear issue remains the authority if the two disagree.

`styles/tokens.css` and `WORKSPACE-DESIGN-SYSTEM.md` are the current visual
authority. Older gold/editorial guidance in `DESIGN-SYSTEM-MAP.md` is
historical where it conflicts.

## 1. Reference boundary

- Gr8r is a **UX reference only**: study observable behaviour, then rebuild it
  with EGA's Next.js/React stack.
- Do not copy or translate Gr8r JavaScript, markup, CSS, seed data, assets or
  its store/render loop. Source visibility is not a reuse licence, and a rewrite
  is not "formal clean-room isolation" — do not claim that.
- Research links in the Linear tickets are pinned snapshots. They are not
  instructions to work against a stale base: always implement on current `main`.

## 2. Reuse inventory before coding

For each feature, record: the existing component, action/service, contract,
persistence and callers; then classify each as **reuse**, **extend**,
**replace** or **new**. Justify new dependencies. Delete a superseded path only
after its consumers are accounted for.

Preserve scheduling, recurrence, reminders, timer evidence, the Today
projection, analytics, calendar sync and owner isolation.

## 3. React

- Typed JSX, semantic HTML, stable entity keys, React event handlers, existing
  server actions.
- Server routes and read models stay server-side. Small client components own
  menus, draft text, selection and dragging.
- No document-wide delegated data engine, no HTML-string render loop, no
  `innerHTML`, no mirrored derived state, no wholesale client conversion.

## 4. State

- Persisted product data belongs to services and the DB.
- Task selection, filters, sort and layout belong to the existing URL contracts.
- Draft, selection, popover and drag state stays local to the nearest owner.
- Browser-storage preferences/drafts are account-scoped and cleared or isolated
  on account switch. No task database or auth material in `localStorage`.
- Do not add a global store unless a concrete unmet requirement proves it.

## 5. CSS

- Use the real `tokens.css` plus Tailwind 4 `@theme` mappings and the existing
  component layers. Feature CSS stays scoped.
- No Gr8r resets, no alternate palette, no reordering of the cascade.
- Reuse Lucide for icons and the existing `motion/react` provider for motion.
  Do not add an icon or animation framework.

## 6. Primitives

Reuse first: `button`, `input`, `textarea`, `card`, `badge`, `status-badge`,
`filter-pill`, `progress-bar`, `empty-state`, `skeleton`, `tabs`, `tooltip`.

Available for the Gr8r work (added by EGA-806):

| Primitive | File | Semantics |
| --- | --- | --- |
| `Popover`, `PopoverTrigger`, `PopoverContent` | `components/ui/popover.tsx` | Radix shell: focus return, Escape/outside dismissal, collision-aware placement |
| `MenuList` | `components/ui/menu-list.tsx` | `role="listbox"` + `role="option"`, active option announced via `aria-activedescendant` (not roving tabindex), arrow/Home/End/Enter/Space, type-ahead, disabled skipped, auto-scrolls the active row |
| `PropertyPill` | `components/ui/property-pill.tsx` | Trigger with `aria-haspopup="listbox"` + `aria-expanded`, composes `Popover` + `MenuList`, closes and reports the selection |
| `Kbd` | `components/ui/kbd.tsx` | Presentational `<kbd>`; the control owns the shortcut and should expose `aria-keyshortcuts` |
| `StatusIcon` | `components/ui/status-icon.tsx` | `todo`/`in_progress`/`done`/`blocked`, `role="img"` + label, `decorative` when a visible label exists |
| `PriorityIcon` | `components/ui/priority-icon.tsx` | `low`/`medium`/`high`/`urgent`, same a11y contract |

Rules:

- `MenuList` is a listbox, **not** a combobox. The pickers it serves are small
  fixed sets; type-ahead covers keyboard lookup. A picker that needs real search
  must be built as a combobox with `role="combobox"`, `aria-expanded`,
  `aria-controls` and `aria-activedescendant`.
- Each primitive ships with its first consumer. Do not grow a generic component
  library ahead of demand.
- `Sheet` is custom and modal/sidebar-oriented; non-modal task detail needs the
  Radix Dialog foundation with explicit focus/dismissal behaviour, without
  rewriting existing `Sheet` callers.

## 7. Data and security

- `@ega/domain` / `@ega/application` own durable policy; `@ega/contracts` own
  wire types; `@ega/data-access` owns request-scoped persistence.
- Web server-side code composes those layers and must not self-fetch Hono to
  reuse in-process policy. Mobile uses `@ega/api-client` over Hono.
- Identity and actor provenance are derived server-side. A new child reference
  must prove **parent owner equality**, not just `owner_user_id = auth.uid()`.
- Never use service-role CRUD to bypass authorization.

## 8. Mutations

- Validate at the boundary; show per-field errors and pending states.
- Handle duplicate submits and retries; invalidate every affected projection.
- A Supabase HTTP request per statement is not a transaction. Where atomicity is
  required, use a bounded repository transaction or RPC.
- Realtime updates must not overwrite an active draft.
- Undo is an authorised inverse with concurrency preconditions, not a
  client-supplied row snapshot.

## 9. Verification

- Narrow affected tests first, then the required package/consumer,
  architecture and security gates.
- Prove constraints, RLS, rollback and concurrency in a disposable DB.
- Authenticated browser walkthrough at desktop and phone: action → response →
  persisted result → refreshed projection.
- Cover empty/loading/error, long content, keyboard and focus, a click/tap
  alternative to dragging, and reduced motion.
- Do not weaken assertions or skip checks to get green.

## 10. Performance

- Establish a fresh same-environment production baseline before claiming an
  optimisation; `PERFORMANCE-BASELINE.md` is historical.
- Record route/client JS, query counts and interaction timing as relevant.
- No blanket memoisation, caching, virtualisation, package migration or
  arbitrary score claims.

## 11. Completion

- Implementation, review, merge, migration delivery and runtime acceptance are
  distinct states. A green PR or a checked box does not prove production
  readiness.
- Milestone dates and points are forecasts, not measured commitments.
- Large tickets land as separately reviewable stages without claiming the whole
  ticket early.
- No new features, issues or infrastructure are implied by this cleanup.

## Token mapping (Gr8r reference → EGA)

Map to existing tokens; never import Gr8r values.

| Gr8r | EGA |
| --- | --- |
| `--surface` | `--ega-surface` |
| `--border` | `--ega-border` |
| `--text-2` | `--ega-text-secondary` |
| `--accent` | `--ega-accent` |
| `--shadow-pop` | `--ega-shadow-md` |
| `--shadow-drag` | `--ega-shadow-drag` |
| `--r` | `--radius-md` |
| `--s-*` | `--space-*` |
| `--ease` / `--spring` | `--ease-default` / `--ease-spring` |
| `--dur` | `--duration-base` |
| `--st-progress` | `--status-info` |
| `--st-done` | `--status-healthy` |
| `--st-review` | **not defined** — EGA-790 is an unapproved owner decision |

## EGA-806 stage ledger

The primitive ticket was split so nothing is built ahead of a consumer. The
parent contract forbids a "generic component library upfront", so the remainder
is owned by the tickets that actually mount it.

| Deliverable | State | Owner of the missing part |
| --- | --- | --- |
| `Popover`, `MenuList`, `PropertyPill`, `Kbd` | built + tested | — |
| `StatusIcon` | built + tested; consumed by `StatusBadge` | — |
| `PriorityIcon` | built + tested; first consumer is the EGA-781 task drawer | EGA-781 |
| `--ega-shadow-drag` | token in both palettes + test | consumed by EGA-785 (drag) |
| `--status-review*` | **not defined** | EGA-790 is an unapproved owner decision |
| Toast queue + undo | not built | EGA-786 (owns the server receipt/replay contract) |
| Context menu, bulk bar | not built (dependency installed) | EGA-786 |
| Dropdown menu primitive | not built (dependency installed) | EGA-786 (task row actions) |
| `MiniCalendar` | not built; prefer a native date input | EGA-793 |
| Radix Dialog task overlay + motion keyframes | not built | EGA-781 (drawer) |
| `components/motion-provider.tsx` change | not needed yet — the current provider already scopes reduced motion for these primitives | EGA-781 if the drawer needs a new variant |
| Command palette | not built | EGA-795 (combobox semantics) |

`PropertyPill`/`Popover`/`MenuList`/`Kbd` are the exception to "with a consumer":
they are the shared picker foundation every Wave-1 surface needs, and their
behaviour is covered by direct tests until the drawer mounts them.

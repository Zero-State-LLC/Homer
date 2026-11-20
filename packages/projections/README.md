# Projections

Pure Activity Calendar, Project Timeline and Source Freshness functions.

```ts
import { replayEffectiveHistory } from "@zs-home/event-ledger";
import { projectActivityCalendar, projectProjectTimeline } from "@zs-home/projections";

const events = replayEffectiveHistory(await ledger.readHistory());
const calendar = projectActivityCalendar(events, {
  timeZone: "America/Los_Angeles",
  bucket: "week",
});
const timeline = projectProjectTimeline(events, {
  projectId: "project:example",
  asOf: "2026-11-19T01:00:00Z",
});
```

See the [contract and acceptance scenarios](../../specs/projections/spec.md).
Do not pass raw or unverified history. Render returned text as text, never HTML.
No live data, Identity Bindings, default freshness budgets or UI are bundled.

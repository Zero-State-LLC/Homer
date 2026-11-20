import type { ActivityEvent, ActorKind, SourceSystem } from "@zs-home/shared-contracts";

export interface CalendarOptions {
  timeZone: string;
  bucket: "day" | "week" | "month";
  projectId?: string;
  actorId?: string;
  actorKind?: ActorKind | "unattributed";
}
export interface CalendarBucket {
  key: string;
  events: ActivityEvent[];
}
function instant(value: string): bigint {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);
  if (
    !match ||
    !Number.isFinite(Date.parse(`${match[1]!}Z`)) ||
    new Date(`${match[1]!}Z`).toISOString().slice(0, 19) !== match[1]
  )
    throw new RangeError("Expected a valid UTC instant");
  return BigInt(Date.parse(`${match[1]}Z`)) * 1000000n + BigInt((match[2] ?? "").padEnd(9, "0"));
}
const lexical = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export function projectActivityCalendar(
  events: readonly ActivityEvent[],
  options: CalendarOptions,
): CalendarBucket[] {
  if (!["day", "week", "month"].includes(options.bucket))
    throw new RangeError("Invalid calendar bucket");
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: options.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const selected = events.filter(
    (e) =>
      (!options.projectId || e.projectId === options.projectId) &&
      (!options.actorId || e.actor.actorId === options.actorId) &&
      (!options.actorKind ||
        (options.actorKind === "unattributed"
          ? !e.actor.actorId
          : !!e.actor.actorId && e.actor.actorKind === options.actorKind)),
  );
  selected.sort((a, b) => {
    const delta = instant(a.occurredAt) - instant(b.occurredAt);
    return delta < 0n ? -1 : delta > 0n ? 1 : lexical(a.eventKey, b.eventKey);
  });
  const buckets = new Map<string, ActivityEvent[]>();
  for (const event of selected) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(event.occurredAt)).map((p) => [p.type, p.value]),
    );
    let key = `${parts.year!}-${parts.month!}-${parts.day!}`;
    if (options.bucket === "month") key = key.slice(0, 7);
    if (options.bucket === "week") {
      const d = new Date(`${key}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      key = d.toISOString().slice(0, 10);
    }
    const group = buckets.get(key) ?? [];
    group.push(structuredClone(event));
    buckets.set(key, group);
  }
  return [...buckets].sort(([a], [b]) => lexical(a, b)).map(([key, events]) => ({ key, events }));
}
export interface SourceCheckpoint {
  sourceSystem: SourceSystem;
  lastSuccessAt: string | null;
  maxAgeSeconds: number | null;
  lastAttemptFailed?: boolean;
}
export interface SourceFreshness extends SourceCheckpoint {
  status: "fresh" | "stale" | "unknown";
  warnings: string[];
}
export function projectSourceFreshness(
  checkpoints: readonly SourceCheckpoint[],
  asOf: string,
): SourceFreshness[] {
  const now = instant(asOf);
  const systems: SourceSystem[] = ["github", "linear", "control-room", "software-factory"];
  return systems.map((sourceSystem) => {
    const matches = checkpoints.filter((c) => c.sourceSystem === sourceSystem);
    const c =
      matches.length === 1
        ? matches[0]!
        : { sourceSystem, lastSuccessAt: null, maxAgeSeconds: null };
    let status: SourceFreshness["status"] = "unknown";
    const warnings: string[] = [];
    if (matches.length === 0) warnings.push(`${sourceSystem}: missing checkpoint`);
    else if (matches.length > 1) warnings.push(`${sourceSystem}: multiple checkpoints`);
    else {
      const validBudget =
        c.maxAgeSeconds !== null && Number.isSafeInteger(c.maxAgeSeconds) && c.maxAgeSeconds >= 0;
      if (!validBudget) warnings.push(`${sourceSystem}: invalid freshness budget`);
      if (c.lastSuccessAt === null) warnings.push(`${sourceSystem}: missing last success`);
      else {
        try {
          const age = now - instant(c.lastSuccessAt);
          if (age < 0n) warnings.push(`${sourceSystem}: last success is in the future`);
          else if (validBudget)
            status = age <= BigInt(c.maxAgeSeconds!) * 1000000000n ? "fresh" : "stale";
        } catch {
          warnings.push(`${sourceSystem}: invalid last success`);
        }
      }
    }
    return { ...structuredClone(c), status, warnings };
  });
}
export interface VerifiedCompletion {
  eventKey: string;
  sourceUrl: string;
  evidenceUrl: string;
}
export interface Milestone {
  id: string;
  subject: string;
  plannedDate: string | null;
  actualDate: string | null;
  ownerActorId: string | null;
  dependencies: string[];
  evidence: string[];
}
export interface ProjectTimeline {
  projectId: string;
  milestones: Milestone[];
  blockers: { id: string; milestoneId: string | null; subject: string; sourceUrl: string }[];
  releaseGates: ActivityEvent[];
  sourceFreshness: SourceFreshness[];
  warnings: string[];
}
function dateOnly(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}
export function projectProjectTimeline(
  events: readonly ActivityEvent[],
  options: {
    projectId: string;
    asOf: string;
    checkpoints?: readonly SourceCheckpoint[];
    verifiedCompletions?: readonly VerifiedCompletion[];
  },
): ProjectTimeline {
  const milestones = new Map<string, Milestone>();
  const blockers = new Map<string, ProjectTimeline["blockers"][number]>();
  const warnings: string[] = [];
  const releaseGates: ActivityEvent[] = [];
  for (const event of events.filter((e) => e.projectId === options.projectId)) {
    const data = event.data ?? {};
    if (event.kind === "milestone.planned" || event.kind === "milestone.completed") {
      if (event.provenance.sourceSystem !== "linear") {
        warnings.push(`${event.eventKey}: unexpected Milestone Authority`);
        continue;
      }
      if (typeof data.milestoneId !== "string" || !data.milestoneId.trim()) {
        warnings.push(`${event.eventKey}: missing milestoneId`);
        continue;
      }
      const milestone = milestones.get(data.milestoneId) ?? {
        id: data.milestoneId,
        subject: event.subject,
        plannedDate: null,
        actualDate: null,
        ownerActorId: null,
        dependencies: [],
        evidence: [],
      };
      milestone.subject = event.subject;
      if (event.kind === "milestone.planned") {
        milestone.plannedDate = dateOnly(data.plannedDate) ? data.plannedDate : null;
        if (data.plannedDate != null && !dateOnly(data.plannedDate))
          warnings.push(`${event.eventKey}: invalid Planned Date`);
        milestone.ownerActorId =
          typeof data.ownerActorId === "string" && /^actor:[a-z0-9-]+$/.test(data.ownerActorId)
            ? data.ownerActorId
            : null;
        milestone.dependencies =
          Array.isArray(data.dependencies) &&
          data.dependencies.every((d) => typeof d === "string" && d.trim())
            ? [...new Set(data.dependencies as string[])]
            : [];
        if (
          data.dependencies !== undefined &&
          (!Array.isArray(data.dependencies) ||
            !data.dependencies.every((d) => typeof d === "string" && d.trim()))
        )
          warnings.push(`${event.eventKey}: invalid dependencies`);
      } else {
        const verified = options.verifiedCompletions?.find(
          (v) =>
            v.eventKey === event.eventKey &&
            v.sourceUrl === event.provenance.sourceUrl &&
            event.evidence?.some((e) => e.url === v.evidenceUrl),
        );
        if (verified) {
          instant(event.occurredAt);
          milestone.actualDate = event.occurredAt;
          milestone.evidence = [verified.sourceUrl, verified.evidenceUrl];
        } else warnings.push(`${event.eventKey}: completion requires verified evidence`);
      }
      milestones.set(milestone.id, milestone);
    }
    if (event.kind === "blocker.raised" || event.kind === "blocker.cleared") {
      if (typeof data.blockerId !== "string" || !data.blockerId.trim()) {
        warnings.push(`${event.eventKey}: missing blockerId`);
        continue;
      }
      // Keep identifiers scoped to their Source System.
      const id = `${event.provenance.sourceSystem}:${data.blockerId}`;
      if (event.kind === "blocker.cleared") blockers.delete(id);
      else
        blockers.set(id, {
          id,
          milestoneId: typeof data.milestoneId === "string" ? data.milestoneId : null,
          subject: event.subject,
          sourceUrl: event.provenance.sourceUrl,
        });
    }
    if (["ci.completed", "deployment.completed", "factory.verdict_recorded"].includes(event.kind))
      releaseGates.push(structuredClone(event));
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(id: string): void {
    if (visiting.has(id)) {
      warnings.push(`Milestone ${id}: dependency cycle`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of milestones.get(id)?.dependencies ?? []) {
      if (!milestones.has(dependency))
        warnings.push(`Milestone ${id}: unknown dependency ${dependency}`);
      else visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  }
  [...milestones.keys()].sort(lexical).forEach(visit);
  const sourceFreshness = projectSourceFreshness(options.checkpoints ?? [], options.asOf);
  for (const source of sourceFreshness) {
    // Absence is normal before a Collector is configured; supplied bad inputs are not.
    if (options.checkpoints?.some((c) => c.sourceSystem === source.sourceSystem))
      warnings.push(...source.warnings);
  }
  return {
    projectId: options.projectId,
    milestones: [...milestones.values()].sort((a, b) => lexical(a.id, b.id)),
    blockers: [...blockers.values()].sort((a, b) => lexical(a.id, b.id)),
    releaseGates,
    sourceFreshness,
    warnings: [...new Set(warnings)],
  };
}

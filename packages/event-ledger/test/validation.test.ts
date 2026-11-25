import { expect, it } from "vitest";
import { validateCorrection, validateEvent } from "../src/validation.js";
import { buzzEvent, event } from "./fixture.js";
it("refuses non-JSON values before storage, without invoking accessors", () => {
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  const accessor = Object.defineProperty({}, "x", {
    enumerable: true,
    get() {
      throw new Error("getter invoked");
    },
  });
  const hidden = Object.defineProperty({}, "x", { value: 1 });
  for (const bad of [
    undefined,
    Infinity,
    NaN,
    1n,
    () => 1,
    Symbol("x"),
    new Date(),
    new Map(),
    "\ud800",
    cycle,
    accessor,
    hidden,
    new Array(2),
    { [Symbol("x")]: 1 },
  ])
    expect(validateEvent({ ...event(), data: { bad } }).ok).toBe(false);
});

it("refuses deeply nested JSON instead of escaping validation with a stack error", () => {
  let nested: unknown = null;
  for (let i = 0; i < 10000; i++) nested = { child: nested };
  expect(validateEvent({ ...event(), data: { nested } })).toEqual({
    ok: false,
    errors: ["Activity Event must be valid canonical JSON"],
  });
});

it("accepts contract version 2 events and still checks the Event Key's Kind", () => {
  expect(validateEvent(buzzEvent()).ok).toBe(true);
  expect(validateEvent({ ...event(), contract: "home.activity-event/v2" }).ok).toBe(true);
  const flagged = { ...buzzEvent(), kind: "knowledge.flagged", subject: "Buzz knowledge flag" };
  expect(validateEvent(flagged)).toEqual({
    ok: false,
    errors: ["Event Key Kind segment must equal kind"],
  });
});

it("refuses a buzz:// link on a version 1 event and on a non-Buzz version 2 event", () => {
  const link = buzzEvent().provenance.sourceUrl;
  const v1 = event();
  expect(validateEvent({ ...v1, provenance: { ...v1.provenance, sourceUrl: link } }).ok).toBe(
    false,
  );
  const v2 = { ...v1, contract: "home.activity-event/v2" as const };
  expect(validateEvent({ ...v2, provenance: { ...v2.provenance, sourceUrl: link } }).ok).toBe(
    false,
  );
});

it("validates Correction Provenance from every Source System", () => {
  const base = {
    contract: "home.correction/v1",
    correctionId: "c-buzz",
    targetEventKey: buzzEvent().eventKey,
    action: "retract",
    reason: "Reviewed synthetic evidence",
  };
  expect(validateCorrection({ ...base, provenance: buzzEvent().provenance }).ok).toBe(true);
  const homer = {
    ...event().provenance,
    sourceSystem: "homer",
    collector: "curator-runner",
  };
  expect(validateCorrection({ ...base, provenance: homer }).ok).toBe(true);
  expect(validateCorrection({ ...base, provenance: event().provenance }).ok).toBe(true);
  // Version 3's Source System, for retracting or superseding a machine alert.
  const sparkdash = {
    ...event().provenance,
    sourceSystem: "sparkdash",
    sourceObjectId: "delphi:thermal@1764007080000",
    collector: "fleet-collector",
  };
  expect(validateCorrection({ ...base, provenance: sparkdash }).ok).toBe(true);
  const unknown = { ...event().provenance, sourceSystem: "unknown-system" };
  expect(validateCorrection({ ...base, provenance: unknown }).ok).toBe(false);
  // A buzz:// link is still Buzz's alone.
  const linked = { ...sparkdash, sourceUrl: buzzEvent().provenance.sourceUrl };
  expect(validateCorrection({ ...base, provenance: linked })).toEqual({
    ok: false,
    errors: [
      '/provenance/sourceUrl must match pattern "^https://"',
      '/provenance must match "else" schema',
    ],
  });
});

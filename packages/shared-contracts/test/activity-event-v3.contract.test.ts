import { describe, expect, it } from "vitest";
import {
  fleetRuleName,
  hasIpAddress,
  machineAlertEventKey,
  machineAlertObjectId,
  machineAlertSubject,
  validateActivityEvent,
  validateProvenance,
  type ActivityEvent,
} from "../src/index.js";
import { validateProvenance as workerValidateProvenance } from "@zs-home/shared-contracts/workers";
import { loadFixture } from "./fixture.js";

// One event from every Source System, and each machine alert shape.
const validFixtures = [
  "valid/activity-event-v3-github-commit-pushed.json",
  "valid/activity-event-v3-linear-task-created.json",
  "valid/activity-event-v3-control-room-work-session-started.json",
  "valid/activity-event-v3-software-factory-verdict-recorded.json",
  "valid/activity-event-v3-buzz-message.json",
  "valid/activity-event-v3-homer-curator-profile-switched.json",
  "valid/activity-event-v3-homer-reachability.json",
  "valid/activity-event-v3-sparkdash-alert-fired.json",
  "valid/activity-event-v3-sparkdash-alert-cleared.json",
  "valid/activity-event-v3-sparkdash-unknown-rule.json",
];

function accepted(name: string): ActivityEvent {
  const result = validateActivityEvent(loadFixture(name));
  if (!result.ok) {
    expect.fail(`${name}: ${result.errors.join("\n")}`);
  }
  return result.value;
}

function errorsOf(name: string): string {
  const result = validateActivityEvent(loadFixture(name));
  expect(result.ok, name).toBe(false);
  return result.ok ? "" : result.errors.join("\n");
}

describe("Activity Event contract version 3", () => {
  it.each(validFixtures)("accepts %s", (name) => {
    expect(accepted(name).contract).toBe("home.activity-event/v3");
  });

  it("keeps version 2 as it was: no sparkdash Source System and no machine Kinds", () => {
    const errors = errorsOf("invalid/activity-event-v2-sparkdash-source.json");
    expect(errors).toContain("/provenance/sourceSystem must be equal to one of the allowed values");
    expect(errors).toContain("/kind must be equal to one of the allowed values");
  });

  it("admits machine alerts only from sparkdash and homer, and sparkdash only for them", () => {
    expect(errorsOf("invalid/activity-event-v3-machine-kind-from-github.json")).toContain(
      "/provenance/sourceSystem must be equal to one of the allowed values",
    );
    expect(errorsOf("invalid/activity-event-v3-sparkdash-wrong-kind.json")).toContain(
      "/kind must be equal to one of the allowed values",
    );
  });

  it("gives a machine alert no Actor, and its source's own account", () => {
    expect(errorsOf("invalid/activity-event-v3-machine-alert-with-actor-id.json")).toContain(
      "/actor must NOT have more than 1 properties",
    );
    expect(errorsOf("invalid/activity-event-v3-sparkdash-wrong-account.json")).toContain(
      "/actor/sourceAccount must be equal to constant",
    );
  });

  it("keeps sparkDash's text out: fixed subjects from Homer's catalogue, and fixed data", () => {
    expect(errorsOf("invalid/activity-event-v3-free-text-subject.json")).toContain(
      "/subject must match pattern",
    );
    expect(errorsOf("invalid/activity-event-v3-subject-not-from-catalogue.json")).toContain(
      'subject must be "GPU temperature on <machine name>", from Homer\'s rule catalogue',
    );
    expect(errorsOf("invalid/activity-event-v3-summary-in-data.json")).toContain(
      "/data must NOT have additional properties",
    );
    expect(errorsOf("invalid/activity-event-v3-evidence-on-machine-alert.json")).toContain(
      "/evidence boolean schema is false",
    );
  });

  it("builds the Event Key and object id from the machine, the rule and when it began", () => {
    expect(errorsOf("invalid/activity-event-v3-event-key-not-from-data.json")).toBe(
      "eventKey must be <source>:<kind>:<data.machineId>:<data.rule>:<data.startsAt in ms>",
    );
    expect(errorsOf("invalid/activity-event-v3-object-id-not-from-data.json")).toBe(
      "provenance.sourceObjectId must be <data.machineId>:<data.rule>@<data.startsAt in ms>",
    );
    const fired = accepted("valid/activity-event-v3-sparkdash-alert-fired.json");
    const cleared = accepted("valid/activity-event-v3-sparkdash-alert-cleared.json");
    // One occurrence, one pair of keys.
    expect(fired.eventKey.replace("alert_fired", "alert_cleared")).toBe(cleared.eventKey);
    expect(
      machineAlertEventKey(
        "sparkdash",
        "machine.alert_fired",
        "delphi",
        "thermal",
        "2026-11-24T17:58:00Z",
      ),
    ).toBe(fired.eventKey);
    expect(machineAlertObjectId("delphi", "thermal", "2026-11-24T17:58:00Z")).toBe(
      fired.provenance.sourceObjectId,
    );
    expect(
      machineAlertEventKey("homer", "machine.alert_fired", "pc-one", "reachability", "soon"),
    ).toBe(undefined);
  });

  it("keeps reachability to homer, always critical, and every other rule to sparkDash", () => {
    expect(errorsOf("invalid/activity-event-v3-sparkdash-reachability-rule.json")).toContain(
      "/data/rule must NOT be valid",
    );
    expect(errorsOf("invalid/activity-event-v3-homer-other-rule.json")).toContain(
      "/data/rule must be equal to constant",
    );
    expect(errorsOf("invalid/activity-event-v3-bad-severity.json")).toContain(
      "/data/severity must be equal to one of the allowed values",
    );
    expect(errorsOf("invalid/activity-event-v3-rule-id-pattern.json")).toContain(
      '/data/rule must match pattern "^[a-z0-9-]{1,40}$"',
    );
  });

  it("refuses an IP address anywhere in a machine alert", () => {
    expect(errorsOf("invalid/activity-event-v3-address-in-source-url.json")).toBe(
      "/provenance/sourceUrl must not carry an IP address",
    );
    expect(errorsOf("invalid/activity-event-v3-ipv6-in-subject.json")).toContain(
      "/subject must not carry an IP address",
    );
  });
});

describe("Provenance on its own, for a Correction", () => {
  it("accepts every Source System's Provenance, sparkdash included, and keeps buzz:// to Buzz", () => {
    const sparkdash = accepted("valid/activity-event-v3-sparkdash-alert-fired.json").provenance;
    const buzz = accepted("valid/activity-event-v3-buzz-message.json").provenance;
    const cases: [unknown, boolean][] = [
      [sparkdash, true],
      [buzz, true],
      [{ ...sparkdash, sourceUrl: buzz.sourceUrl }, false],
      [{ ...sparkdash, sourceSystem: "unknown-system" }, false],
      [{ ...sparkdash, extra: true }, false],
      [null, false],
    ];
    for (const [value, ok] of cases) {
      const result = validateProvenance(value);
      expect(result.ok, JSON.stringify(value)).toBe(ok);
      // The Event Ledger runs the Workers validator; it must answer the same.
      expect(workerValidateProvenance(value)).toEqual(result);
    }
  });
});

describe("the rule catalogue and the address check", () => {
  it("names a rule from Homer's catalogue, or as an unknown sparkDash rule", () => {
    expect(fleetRuleName("thermal")).toBe("GPU temperature");
    expect(fleetRuleName("reachability")).toBe("SSH unreachable");
    expect(fleetRuleName("new-rule")).toBe("sparkDash rule new-rule");
    // Only the catalogue's own entries, never the prototype's.
    expect(fleetRuleName("constructor")).toBe("sparkDash rule constructor");
    for (const rule of ["New Rule", "toString", "", "x".repeat(41)]) {
      expect(fleetRuleName(rule), rule).toBeUndefined();
    }
    expect(machineAlertSubject("machine.alert_cleared", "oom", "Delphi")).toBe(
      "Out-of-memory kill cleared on Delphi",
    );
    expect(machineAlertSubject("machine.alert_fired", "oom", "Del\nphi")).toBeUndefined();
  });

  it.each([
    "10.0.0.5",
    "https://192.168.1.20:3000/",
    "::1",
    "[::1]:22",
    "fe80::1%eth0",
    "2001:db8::8a2e:370:7334",
    "::ffff:192.0.2.1",
    "1:2:3:4:5:6:7:8",
  ])("finds the address in %s", (text) => {
    expect(hasIpAddress(text)).toBe(true);
  });

  it.each([
    "2026-11-24T18:00:00.123456789Z",
    "0.1.0+a1b2c3d",
    "2.91.0",
    "sparkdash:machine.alert_fired:delphi:thermal:1764007080000",
    "beef:cafe:dead",
    "Mac Studio",
  ])("finds no address in %s", (text) => {
    expect(hasIpAddress(text)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { SHAPE_CHANGED, parseAlerts, parseHealth, parseMetrics } from "../src/index.js";
import { activeAlert, alertsBody, entry, metricsText, units } from "./fixture.js";

describe("the sparkDash parsers", () => {
  it("keeps only the release from /api/health", () => {
    expect(
      parseHealth(JSON.stringify({ ok: true, bindHost: "127.0.0.1", version: "2.91.0" })),
    ).toEqual({
      version: "2.91.0",
    });
    for (const body of ["{}", '{"Version":"2.91.0"}', '{"version":"2.91.0; rm -rf"}', "not json"]) {
      expect(parseHealth(body), body).toBe(SHAPE_CHANGED);
    }
  });

  it("keeps sparkdash_up and the collector timestamps, and drops every other family and label", () => {
    const parsed = parseMetrics(metricsText());
    expect(parsed).not.toBe(SHAPE_CHANGED);
    if (parsed === SHAPE_CHANGED) return;
    expect([...parsed.entries()]).toEqual([
      ["delphi", { name: "Delphi", kind: "spark", up: true, lastSuccessMs: 1795543200000 }],
      ["studio", { name: "Mac Studio", kind: "mac", up: false, lastSuccessMs: undefined }],
      ["lab-box", { name: "Lab box", kind: "host", up: true, lastSuccessMs: 1795543200000 }],
    ]);
    expect(JSON.stringify([...parsed.values()])).not.toContain("GB10");
  });

  it("reads escaped label values", () => {
    const parsed = parseMetrics(metricsText([{ ...units[0]!, name: 'Del"phi\\one\nx' }]));
    expect(parsed === SHAPE_CHANGED ? undefined : parsed.get("delphi")?.name).toBe(
      'Del"phi\\one\nx',
    );
  });

  it("is shape_changed for a body that is not sparkDash's exposition", () => {
    for (const text of [
      "<html>Prometheus export is off</html>",
      metricsText().replace("# TYPE sparkdash_up gauge\n", ""),
      metricsText().replace('kind="spark"', 'kind="toaster"'),
      metricsText().replace("sparkdash_up{", 'sparkdash_up{unit="delphi",'),
      metricsText().replace(/\} 1\n/, "} 2\n"),
      metricsText().replace(
        '{unit="delphi",unit_name="Delphi",kind="spark",role="standalone"} 1',
        "{unit=delphi} 1",
      ),
    ]) {
      expect(parseMetrics(text), text.slice(0, 60)).toBe(SHAPE_CHANGED);
    }
  });

  it("keeps only the listed alert fields, oldest first", () => {
    const parsed = parseAlerts(
      alertsBody(
        [entry({ id: 7, status: "firing" }), entry({ id: 8, status: "resolved" })],
        [activeAlert()],
      ),
    );
    expect(parsed).not.toBe(SHAPE_CHANGED);
    if (parsed === SHAPE_CHANGED) return;
    expect(parsed.recent.map((e) => e.id)).toEqual([7, 8]);
    expect(Object.keys(parsed.recent[0]!).sort()).toEqual(
      ["at", "endsAt", "id", "key", "ruleId", "severity", "startsAt", "status", "unitId"].sort(),
    );
    expect(Object.keys(parsed.active[0]!).sort()).toEqual(
      ["key", "ruleId", "severity", "startsAt", "unitId"].sort(),
    );
    const text = JSON.stringify(parsed);
    for (const dropped of [
      "10.0.0.5",
      "fe80::1",
      "192.168.1.20",
      "<script>",
      "GPU0",
      "Connection refused",
      "peakSeverity",
      "ruleName",
    ]) {
      expect(text, dropped).not.toContain(dropped);
    }
  });

  it("names an unknown rule id that fits the pattern, and refuses any other", () => {
    const named = parseAlerts(alertsBody([entry({ id: 1, status: "firing", ruleId: "new-rule" })]));
    expect(named === SHAPE_CHANGED ? undefined : named.recent[0]?.ruleId).toBe("new-rule");
    for (const ruleId of ["New Rule", "rule!", "x".repeat(41), "reachability"]) {
      expect(parseAlerts(alertsBody([entry({ id: 1, status: "firing", ruleId })])), ruleId).toBe(
        SHAPE_CHANGED,
      );
    }
  });

  it("is shape_changed for a missing or renamed field, or a history that is not contiguous", () => {
    const renamed = { ...entry({ id: 1, status: "firing" }) };
    renamed["start"] = renamed["startsAt"];
    delete renamed["startsAt"];
    for (const body of [
      JSON.stringify({ active: [], recent: [] }),
      JSON.stringify({ enabled: "yes", active: [], recent: [] }),
      alertsBody([renamed]),
      alertsBody([{ ...entry({ id: 1, status: "firing" }), key: "other:thermal" }]),
      alertsBody([{ ...entry({ id: 1, status: "firing" }), severity: "info" }]),
      alertsBody([{ ...entry({ id: 1, status: "firing" }), status: "pending" }]),
      alertsBody([entry({ id: 1, status: "firing" }), entry({ id: 3, status: "firing" })]),
      alertsBody([], [{ ...activeAlert(), status: "resolved" }]),
    ]) {
      expect(parseAlerts(body), body.slice(0, 80)).toBe(SHAPE_CHANGED);
    }
  });
});

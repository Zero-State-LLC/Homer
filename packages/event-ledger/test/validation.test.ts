import { expect, it } from "vitest";
import { validateEvent } from "../src/validation.js";
import { event } from "./fixture.js";
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

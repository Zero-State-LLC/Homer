import { expect, it } from "vitest";
import { sparkdashUrl } from "../src/fleet-status.js";

it("links the sparkDash page only through a bare https front door with a host name", () => {
  expect(sparkdashUrl(undefined)).toBeNull();
  expect(sparkdashUrl("")).toBeNull();
  expect(sparkdashUrl("https://sparkdash.example.test")).toBe("https://sparkdash.example.test/");
  expect(sparkdashUrl("https://sparkdash.example.test/")).toBe("https://sparkdash.example.test/");
  for (const value of [
    "http://sparkdash.example.test",
    "https://sparkdash.example.test/units",
    "https://sparkdash.example.test/?token=x",
    "https://sparkdash.example.test/#x",
    "https://user:secret@sparkdash.example.test",
    "https://10.0.0.5",
    "https://[fd00::5]",
    "https://SPARKDASH.example.test",
    "not a url",
  ])
    expect(sparkdashUrl(value), value).toBeNull();
});

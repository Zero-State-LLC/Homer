import { adminPaths } from "./admin.js";
import { calendarPaths } from "./calendar.js";
import { enrollmentPaths } from "./controller-http.js";
import { fleetPaths } from "./fleet-http.js";
import { fleetStatusPaths } from "./fleet-status.js";
import { directoryPaths } from "./directory-ui.js";
import { editorPaths } from "./editor.js";
import { runnerPaths } from "./runner-http.js";

/**
 * Who calls each `homer-catalog` path (ADR 013): people and agents, through
 * Access, with the read audience or the admin audience. A read path also
 * admits the admin audience. A path not listed is refused before any handler
 * runs. Machine routes are in `homer-intake`.
 */
export interface CatalogRoute {
  caller: "person";
  audience: "read" | "admin";
}
const read: CatalogRoute = { caller: "person", audience: "read" };
const admin: CatalogRoute = { caller: "person", audience: "admin" };
const readPages = [...calendarPaths, ...directoryPaths, ...fleetStatusPaths];

export const catalogRoutes: ReadonlyMap<string, CatalogRoute> = new Map<string, CatalogRoute>([
  ["/v1/catalog", read],
  ["/v1/version", read],
  ["/v1/credentials", read],
  ["/v1/my-setup", read],
  ...readPages.map((p): [string, CatalogRoute] => [p, read]),
  ["/v1/admin/catalog", admin],
  ["/v1/admin/catalog/archive", admin],
  ["/v1/admin/catalog/snapshot", admin],
  ...[...editorPaths, ...adminPaths, ...runnerPaths, ...enrollmentPaths, ...fleetPaths].map(
    (p): [string, CatalogRoute] => [p, admin],
  ),
]);

/** The route for a path, including one Credential's detail, `/v1/credentials/<id>`. */
export function catalogRoute(pathname: string): CatalogRoute | undefined {
  return (
    catalogRoutes.get(pathname) ??
    (pathname.startsWith("/v1/credentials/") && pathname.length > "/v1/credentials/".length
      ? read
      : undefined)
  );
}

/**
 * The one `machineId` query parameter that names a machine in the runner
 * fleet configuration. Shared by the catalog's enrollment routes and
 * `homer-intake`'s controller routes, so both read a machine the same way.
 */
export function machineIdFrom(url: URL): string | undefined {
  const machineId = url.searchParams.get("machineId");
  if (
    !machineId ||
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(machineId) ||
    [...url.searchParams.keys()].some((k) => k !== "machineId") ||
    url.searchParams.getAll("machineId").length !== 1
  )
    return undefined;
  return machineId;
}

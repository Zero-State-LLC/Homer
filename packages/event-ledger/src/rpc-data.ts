/** Detach Cloudflare's root RPC disposer, not arbitrary non-JSON properties.
 * Use only on trusted RPC responses, never on archive inputs or backup storage.
 * Preserve descriptors so strict JSON validation still rejects getters/symbols.
 */
export function ledgerRpcData<T extends object | null>(value: T): T {
  if (value === null) return value;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new Error("invalid_ledger_rpc_data");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  Reflect.deleteProperty(descriptors, Symbol.dispose);
  return Object.defineProperties({}, descriptors) as T;
}

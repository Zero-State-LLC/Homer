import type { ObjectStore } from "./index.js";

/** No public routes or credentials. Bind separately scoped landing/archive buckets. */
export function r2Store(bucket: R2Bucket): ObjectStore {
  return {
    async read(key, maxBytes) {
      const object = await bucket.get(key);
      if (!object) return null;
      if (object.size > maxBytes) {
        await object.body.cancel();
        throw new Error("object_too_large");
      }
      const reader = object.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) {
            await reader.cancel();
            throw new Error("object_too_large");
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return bytes;
    },
    async create(key, bytes) {
      // Object creation is atomic across concurrent retries. Never retry by overwriting.
      return (
        (await bucket.put(key, new Uint8Array(bytes), { onlyIf: { etagDoesNotMatch: "*" } })) !==
        null
      );
    },
  };
}

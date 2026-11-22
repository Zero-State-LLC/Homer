// Synthetic metadata only, loaded by the isolated browser fixture service.
import { createHash } from "node:crypto";
const principalDigest = createHash("sha256")
  .update("https://synthetic.cloudflareaccess.com\nuser:synthetic-browser")
  .digest("hex");
const credential = {
  credentialId: "fixture_owned",
  revision: 1,
  provider: "Synthetic provider",
  purpose: "Developer diagnostic",
  ownershipClass: "developer-owned",
  ownerActorId: "human:fixture",
  projectId: "project:homer",
  environment: "staging",
  consumers: [{ consumerId: "fixture_consumer", label: "Synthetic diagnostic consumer" }],
  consumerDiscovery: "unknown",
  health: "unknown",
  healthEvidence: null,
  expiresAt: null,
  activeVersion: null,
  rotationState: "unknown",
};
export const directoryFixture = {
  version: 1,
  policyRevision: 1,
  metadataRevision: 1,
  observedAt: "2026-11-20T00:00:00Z",
  bindings: [
    {
      principalDigest,
      principalKind: "human",
      actorId: "human:fixture",
      actorKind: "human",
      evidenceRef: "synthetic_review",
    },
    {
      principalDigest: "b".repeat(64),
      principalKind: "human",
      actorId: "human:other",
      actorKind: "human",
      evidenceRef: "synthetic_other",
    },
  ],
  grants: [
    {
      principalDigest,
      capability: "metadata-read",
      ownershipClass: "developer-owned",
      ownerActorId: "human:fixture",
      projectId: "project:homer",
      environment: "staging",
    },
    {
      principalDigest,
      capability: "metadata-read",
      ownershipClass: "shared-service",
      ownerActorId: "human:other",
      projectId: "project:archive",
      environment: "production",
    },
  ],
  credentials: [
    credential,
    {
      ...credential,
      credentialId: "fixture_shared",
      purpose: "Shared archive",
      ownershipClass: "shared-service",
      ownerActorId: "human:other",
      projectId: "project:archive",
      environment: "production",
      consumers: [],
      consumerDiscovery: "configured-only",
    },
    {
      ...credential,
      credentialId: "fixture_hidden",
      purpose: "Another developer private integration",
      ownerActorId: "human:other",
    },
  ],
};

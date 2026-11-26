# Staging trace archive storage provisioning

Date: November 21, 2026 PT, approximately 21:50.

Daniel explicitly approved the two named private staging buckets after the prior
automatic approval rejection. Both were then created successfully in the Zero
State Cloudflare account and their settings read back through authenticated APIs.

| Bucket | Created UTC | Storage | Location |
| --- | --- | --- | --- |
| `homer-traces-landing-staging` | 2026-11-22T05:50:53.802Z | Standard | WNAM |
| `homer-traces-archive-staging` | 2026-11-22T05:50:54.487Z | Standard | WNAM |

Verified for both buckets:

- Managed r2.dev access is disabled after an explicit disable operation.
- Custom domain list is empty.
- Bucket lock rule list is empty.
- No lifecycle rule deletes completed objects or changes storage class.
- Cloudflare's default rule aborts unfinished multipart uploads after seven days.
  This rule was preserved; it does not delete completed archive objects.
- Jurisdiction is default. WNAM placement is not a jurisdiction guarantee.

No credentials were created. No object data was uploaded. Existing recovery
backups, catalog mappings, Access policies and production resources were untouched.

This proves storage provisioning and configuration only. Langfuse export,
scheduling, real developer trace ingestion, archive completeness and recovery
remain unverified. The archive foundation remains a draft in PR #30.

This receipt supersedes the provisioning blocker in the earlier foundation
receipt; that historical receipt is retained unchanged.

# Jobs Aggregator Integration

Free hiring-signal data from the three largest ATS providers — **Greenhouse**, **Lever**, and **Ashby** — using their public, unauthenticated job board APIs.

## What it does

For any company whose ATS slug is known, fetches every open job posting and normalizes it into a single `NormalizedJob` shape across providers. This powers questions like:

- "Is this company hiring engineers?"
- "What roles are open at Stripe right now?"
- "Are they growing the sales org?"

## Cost

**$0.** All three ATS providers expose their hosted boards as public JSON endpoints with no API key, no rate limit auth, and no quota.

Compare to the existing path through Browserbase/Stagehand scraping, which costs ~$0.01–0.05 per company at headless-browser runtime — so for a 1M-company sweep, this integration replaces a ~$10k–50k Browserbase bill with $0.

## Endpoints (verified, no auth)

| Provider   | URL pattern                                                              |
| ---------- | ------------------------------------------------------------------------ |
| Greenhouse | `https://boards-api.greenhouse.io/v1/boards/{slug}/jobs`                 |
| Lever      | `https://api.lever.co/v0/postings/{slug}?mode=json`                      |
| Ashby      | `https://api.ashbyhq.com/posting-api/job-board/{slug}`                   |

Each per-ATS service:
- Has a 10s timeout (via `fetchWithTimeout`).
- Returns `[]` on 404 (slug missing or board private).
- Throws on 5xx so callers can fall back or retry.

## Finding a company's ATS slug

1. **From a careers URL** — use `detectATSFromCareersUrl(url)`:
   - `boards.greenhouse.io/stripe` → `greenhouse` + slug `stripe`
   - `jobs.lever.co/palantir` → `lever` + slug `palantir`
   - `jobs.ashbyhq.com/ashby` → `ashby` + slug `ashby`
2. **Brute force** — call `fetchJobsForCompany(slug, "all")` and see which providers return jobs. The slug is usually the company's lowercase name.

## Chat tools

Registered in `src/lib/tools/index.ts`:

- **`getCompanyJobs`** — `{ companySlug, ats? }` → `{ company, ats_tried, jobs, total }`. Defaults to trying all three ATS providers in parallel.
- **`detectHiringSignal`** — `{ companySlug, ats?, titleKeywords?, departmentKeywords? }` → matched postings only. Use for binary "are they hiring X?" questions.

## Files

- `src/lib/services/jobs/greenhouse.ts`
- `src/lib/services/jobs/lever.ts`
- `src/lib/services/jobs/ashby.ts`
- `src/lib/services/jobs/index.ts` — unified `fetchJobsForCompany` + `detectATSFromCareersUrl`
- `src/lib/tools/jobs-tools.ts` — `getCompanyJobs`, `detectHiringSignal`
- `scripts/test-jobs.ts` — end-to-end smoke tests against real public boards

## Test command

```bash
pnpm exec tsx scripts/test-jobs.ts
```

Hits live Stripe (Greenhouse), Palantir (Lever), and Ashby (Ashby) boards. Requires only network access.

## Known limitations

- **Slug required.** We can detect the ATS from a careers URL, but a company that uses a custom domain or self-hosted careers page still needs its slug supplied. There is no universal directory.
- **Public boards only.** Boards marked private in the ATS will 404 and return `[]`.
- **No company directory.** This integration enriches a known company; it does not discover companies. Pair it with LakeB2B discovery (`discoverWithLakeB2B`) for that.
- **Field coverage varies.** Greenhouse exposes departments + offices; Lever uses a flat `categories` object; Ashby uses `department` + `team`. We normalize to `department?` + `team?` but expect occasional gaps.
- **Updated-at, not posted-at.** Greenhouse and Ashby return last-updated timestamps, not the original posted date. Lever returns `createdAt`.

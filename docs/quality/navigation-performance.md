# Navigation performance pass

## Changes

- `useStoreResource` shares one upstream subscription and comparison per store/account. Unchanged immutable snapshots avoid repeated deep serialization; hydration, read failures, and in-place writes announced by the store remain observable. Key order alone does not trigger a render.
- Local JSON reads reuse their parsed snapshot until the stored string changes. Lecture filtering and cloud objective-map assembly keep stable references between updates. The parsed cache is bounded to 64 keys.
- Study history uses the shared calibration resource rather than stringifying/parsing the full log per hook render. Answer matching and recovery index by session and compute quality exclusions once. Matching rules, timestamps, objective links, scores, and journal records are unchanged.
- Concurrent exam-history consumers share a request and a 10-second warm read, scoped to account/block. Published session changes and focus invalidate the cache. Failed reads can be retried; no failed result is cached.
- Secondary tools, imports, diagnostics, and major views load on demand. Content and modal Suspense boundaries preserve the navigation shell. Boot has a loading message; errors outside an individual study view have a recovery screen.

## Measurements and proof boundaries

`node scripts/profile-navigation.mjs` uses 1,200 synthetic answers with mirrored records and 25 unrelated exclusions. Before: history projection 89.5 ms, recovery 44.6 ms. After: 5.5 ms and 3.2 ms on the same machine. This is a focused calculation benchmark, not a measured end-to-end page-speed improvement.

The main Shell chunk fell from 1,969.12 kB (481.28 kB gzip) to approximately 712 kB (235 kB gzip); shared dependencies and the selected page still contribute to startup transfer. This is not a claim that every page transfers only 712 kB.

Tests cover unchanged-snapshot traversal, shared subscriptions, hydration/errors, ordering, external storage updates, history identity/exclusions, account/block cache isolation, cache invalidation/retry, and root-display recovery. No stored study history was deleted or rewritten by this performance pass. The active signed-in quiz was left untouched; live heap reduction and the intermittent colored screen require a fresh post-quiz tab to measure. The colored screen was not reproduced during this pass.

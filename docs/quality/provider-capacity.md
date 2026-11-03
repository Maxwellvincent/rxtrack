# Provider capacity failures during question preparation

The November 3 incident showed a Codex usage-limit error followed by Ollama Cloud HTTP 429, both wrapped by the local bridge as 502. The 20-question picker was not the cause. The server log does not establish whether the Ollama response represents a short request-rate window or a longer allowance limit.

Strict routed bridge calls now classify upstream capacity errors even behind 502. They retain a per-backend, per-tab cooldown, honoring an exposed Retry-After header when available, otherwise using a one-minute retry gate. That default is not a claimed provider reset time. A limited route does not disable another healthy route. Cooldowns do not change subscriptions, credentials, spending caps, models or quality requirements.

When both configured routes hit capacity, the preparation error retains both causes without exposing prompt fragments. Capacity failures do not trigger network-reconnect recovery, nor permanently block a lecture as though its content failed review. Reviewed questions and ordinary partial-preparation persistence remain unchanged. There is no recall/local-model substitution.

Validation: 2,308 full-suite tests passed / 37 skipped, followed by 111 focused final checks; production build, changed-file lint and patch checks passed. Fake transports test repeated rejection without repeated fetch, independent routes and Retry-After expiry. On November 3, a minimal Codex-only localhost diagnostic returned HTTP 200 and the expected JSON after the incident. No lecture content was transmitted, no cloud fallback was requested and no RXTrack questions or learner progress were saved. That probe does not verify full medical quiz generation or restored Ollama Cloud capacity.

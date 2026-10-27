# Production readiness review

Reviewed on 2026-10-24. Changes are implemented in this worktree; this review does not publish or deploy the site.

## Findings addressed

| Area | Result |
| --- | --- |
| Connection correctness | Full mainnet genesis hash verification fixes rejection of valid endpoints. Failed preflight preserves existing results and exposes connection settings. Endpoint validation agrees with the browser's connection policy. |
| Recovery | Transport deadlines include response bodies; limited retries honor cancellation and rate limits. Retry targets incomplete wallets using the original search scope. Successful holdings survive other lookup failures and cancellation. |
| Token/NFT correctness | Original SPL Token and Token-2022 accounts are aggregated with integer arithmetic. Zero-decimal fungible tokens remain visible. Real Metaplex token standards identify NFTs; collection filters require verified membership. |
| Responsiveness | Shared token-account queries and batched mint/metadata reads reduce RPC traffic. Balances appear before pricing completes. Rendering is bounded to pages of 100 while exports include the full filtered dataset. |
| Persistence | Wallet remembering is explicit, off by default, schema/size checked, resilient to storage errors, and respects opt-out from another tab. Unsearched edits are preserved in the current tab. |
| Imports and exports | TXT/CSV import supports deduplication, undo, drag/drop, concurrent reads, and actionable validation. Exports preserve precision, quote fields, neutralize formulas, and distinguish complete/partial/failed/empty/filtered/unchecked records. |
| Supply chain and privacy | Pinned dependencies and checked-in local bundles replace runtime CDN loading and the legacy SDK dependency tree. No arbitrary metadata URI downloads. Provider credentials are excluded from application error messages. |
| Accessibility and layout | Native labelled dialog, keyboard switches, focus restoration, accessible tables/copy controls, status announcements, and 320/390 px layouts. User-requested concise copy and combined token/NFT flow are retained. |
| Release maintenance | Reproducible build, content-hashed asset references, dependency audit, automated checks, deployment header configuration, and updated operating documentation. |

## Verification evidence

- `npm test`: 40 passing UX, protocol, and transport tests. Protocol fixtures use genuine base58 addresses and serialized on-chain metadata with the shipped decoder.
- `npm run build:check`: generated browser dependencies and content hashes match their sources.
- `npm audit --audit-level=moderate`: zero reported vulnerabilities across the installed dependency tree at review time.
- Headless Chrome: import/undo/drop, remembering/reload/clear, keyboard switches, connection dialog/Escape focus, combined results, partial errors, targeted retry, wrong-network data preservation, verified collection filter, pagination/full export, actual request cancellation, copy feedback, and narrow layouts passed.
- Axe: no violations for the selected WCAG 2 A/AA, WCAG 2.1 AA, and best-practice rules in empty, connection dialog, populated/error, connection failure, and mobile states. Automated accessibility checks do not replace assistive-technology testing.
- `npm run test:live`: public mainnet identity, RPC methods, USDC on-chain metadata, and Jupiter quote identity/value passed.
- `LIVE_BROWSER_CHECK=1 LIVE_RPC_URL=https://solana-rpc.publicnode.com node tests/browser-check.cjs`: real browser RPC/CORS, USDC metadata, and Jupiter passed. Solana's default public endpoint returned HTTP 403 to browser-origin requests during the same review, although its Node smoke check passed. Production users need a browser-accessible provider; the app reports that connection failure safely.
- Desktop and 320 px screenshots were visually inspected. No desktop focus or personal browser profile was used.

## Release boundaries

The implementation is ready for a deployment review within the documented scope. Remaining verification depends on the actual deployment environment:

1. At the final HTTPS origin, confirm static asset paths, cache invalidation, security response headers, and a real search through the intended RPC provider. `_headers` requires a compatible host; configure equivalent headers on other platforms.
2. Run manual Safari/Firefox and screen-reader acceptance checks before claiming support verified in those environments. This review exercised Chrome; native operating-system file picker behavior was not automated.
3. Observe real provider limits and availability after release. Live checks establish current interoperability, not an availability guarantee. The included CI intentionally uses deterministic fixtures rather than depending on external services.

Compressed NFTs, Metaplex Core, non-Metaplex NFT standards, off-chain artwork, transaction execution, account authentication, and cross-device wallet synchronization are outside the product's current scope. Results are point-in-time RPC reads rather than an atomic multi-wallet snapshot. No changes in this review add those capabilities or imply their support.

# Solana Wallet Searcher

A static, read-only website for exploring tokens and standard Metaplex NFTs across Solana wallets. No wallet connection, signatures, transactions, or application backend.

## Run locally

In Cedros Code, use **Start preview** or the approved `dev` Run script. Cedros owns the server and assigns its `web` port. `scripts/serve.py` reads `APP_PORT_WEB`; open the exact URL shown by the running service. The development server disables caching so changes appear after a refresh.

Outside Cedros Code, serve the repository with a static HTTP server, for example `python3 -m http.server`, and open the address it prints. The checked-in browser assets are ready to serve; installing Node dependencies is only necessary for development and verification.

1. Choose **Set up RPC** and enter a browser-accessible Solana mainnet endpoint, such as one from [Helius](https://www.helius.dev/), [QuickNode](https://www.quicknode.com/), or [Alchemy](https://www.alchemy.com/solana). The app verifies connectivity and the full mainnet genesis hash before accepting it. Remote endpoints require HTTPS; local development endpoints may use HTTP.
2. Paste wallet addresses, choose **Import file**, or drop a TXT/CSV onto the input. Imports merge into the editable list and remove duplicates. **Undo import** removes the last imported additions while preserving other edits. CSV files support a single address column or a heading named `Wallet Address`, `Address`, or `Public Key`. Files are limited to 2 MB and searches to 1,000 wallets.
3. Enable **Remember searched wallets** to save the last searched list in this browser. It is off by default. Unsearched edits are not saved. Restoring a list never starts a search; turning the option off clears storage and keeps the current input.
4. Tokens are included by default. Enable **Include NFTs** to include NFT holdings in the same run. Optionally select particular token mints or verified NFT collections.
5. Choose **Search wallets**. Balances appear before pricing finishes. **Cancel search** aborts pending requests and retains published holdings. **Retry incomplete wallets** rechecks incomplete wallets from the original search scope while retaining other results. Failed connection checks preserve the previous results.
6. Group results by wallet or change the small-balance filter without another request. Click an abbreviated address to copy it or its external-link icon to open Solscan. Large result sets show 100 items at a time with **Show next 100**.
7. **Export CSV** exports all results matching the current display filters, including records beyond the displayed page. It also records empty, failed, filtered, and unchecked wallets; incomplete records are labelled explicitly. Columns include retrieval timestamps. Balances retain integer precision, fields are quoted, and spreadsheet formulas are neutralized.

Use **Light / Dark / System** in the footer to choose an appearance. System is the default and follows device changes immediately. The preference is saved in this browser; when storage is unavailable, it still works for the current visit.

## Data and behavior

- Searches read native SOL, original SPL Token, and Token-2022 accounts. Multiple accounts for one mint are combined with integer arithmetic. Zero-decimal fungible tokens are included; identified NFTs appear in NFT results.
- NFT support covers standard on-chain Metaplex metadata, including programmable NFTs and legacy records identified by mint supply/decimals. Compressed NFTs, Core assets, and other NFT standards are outside this scope. Collection filters require verified membership. Missing metadata is reported rather than presented as a successful complete lookup.
- Values are estimated Jupiter swap quotes for the full holding, denominated in USDC. Unpriced tokens remain visible. The small-balance filter hides only known values below 0.01 USDC. Quotes are estimates, not an executable trade or guaranteed portfolio value.
- Wallets are processed sequentially. Metadata reads are batched in groups of up to 100 accounts; token and NFT searches reuse owner-account queries within a run. Metadata is cached for five minutes and successful quotes for 15 seconds, with bounded caches. Retries keep successful holdings and identify incomplete data.
- Network requests have bounded timeouts, limited retries/backoff for transient failures, cancellation, response-size limits, and validated RPC envelopes. Error messages do not expose endpoint credentials. Browser access (CORS), method support, rate limits, and availability depend on the selected provider.
- Search results stay in page memory. The RPC URL is stored in this browser; if storage is unavailable, it can be used for the current visit. Wallet lists are stored only with opt-in. Opting out in another tab is respected before later writes. Stored data is local to the browser origin and is not encrypted.
- The browser requests data only from the configured RPC and Jupiter. Dependencies are bundled locally; arbitrary off-chain metadata URLs are never downloaded. No analytics, runtime CDN scripts, or application tracking are included.

## Develop and verify

Use Node.js 24 and npm. Dependencies are pinned in `package-lock.json`.

```sh
npm ci --ignore-scripts
npm run build
npm run build:check
npm test
npm run test:browser
npm audit --omit=dev --audit-level=moderate
```

`build` produces `assets/vendor.js` and its license notices, then updates content hashes in `index.html` for local scripts and styles. Commit those outputs with source changes. `build:check` fails when generated assets or references are stale.

The browser suite requires Chrome/Chromium and uses an isolated headless profile, temporary fixture server, real address/metadata decoding, and axe accessibility checks. It does not use the normal browser profile or desktop focus. On macOS it defaults to `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`; elsewhere set `BROWSER_PATH=/path/to/chrome`. Screenshots are written to the temporary directory printed by the check.

Optional live checks use public protocol addresses without personal wallets or API keys:

```sh
npm run test:live
LIVE_BROWSER_CHECK=1 npm run test:browser
```

The latter also verifies actual browser RPC/CORS and Jupiter access. `LIVE_RPC_URL` can select a browser-accessible public mainnet RPC for this check. Public endpoints can reject browser-origin traffic or rate-limit requests, so an external service failure must be distinguished from a deterministic regression. Automated CI runs build consistency, dependency audit, unit/protocol/transport tests, and the fixture browser suite; live services are checked separately.

## Deploy

Run the checks above and publish the static repository files to an HTTPS host. Keep `assets/`, `javascript/`, and `css/` paths intact. Never publish `node_modules/` or local settings. No server secrets are needed; users supply their own browser-compatible RPC endpoints.

`index.html` includes a restrictive Content Security Policy and no-referrer policy. `_headers` adds CSP framing protection, MIME sniffing protection, and restricted browser permissions on hosts supporting that format. Other hosts, including GitHub Pages, require equivalent platform header configuration. Verify the deployed headers, asset paths/cache invalidation, and a real provider search at the final HTTPS origin. Provider CORS rules may differ between localhost and production.

See [production-readiness notes](docs/production-readiness.md) for verified coverage and release boundaries.

## Source map

- `javascript/main.js`: imports, persistence, search lifecycle, rendering, filters, clipboard, and CSV export.
- `javascript/network.js` and `javascript/rpc.js`: bounded transport and strictly read-only RPC methods.
- `javascript/token.js`, `javascript/nft.js`, and `javascript/vendor-entry.js`: on-chain metadata, NFT classification, address validation, and bundled library entry point.
- `index.html` and `css/style.css`: accessible controls, responsive layouts, result panels, and native connection dialog.
- `scripts/`: reproducible browser build, managed preview server, and live smoke check.
- `tests/`: UX, transport, protocol, and headless browser regressions.

## License

MIT. See [LICENSE](LICENSE).

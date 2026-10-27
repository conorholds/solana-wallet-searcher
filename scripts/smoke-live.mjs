import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';

// Public protocol checks only; no personal wallet addresses or credentials are used.
const context = vm.createContext({
  window: {}, isSecureContext: true, crypto: webcrypto, fetch, Response, Headers,
  TextEncoder, TextDecoder, Uint8Array, URL, URLSearchParams, atob,
  AbortController, DOMException, setTimeout, clearTimeout,
});
for (const file of ['assets/vendor.js', 'javascript/network.js', 'javascript/rpc.js', 'javascript/token.js']) {
  vm.runInContext(await readFile(file, 'utf8'), context);
}
context.solanaWeb3 = context.window.solanaWeb3;
const run = code => vm.runInContext(code, context);
run('globalThis.controller = new AbortController(); globalThis.rpc = new solanaWeb3.Connection("https://api.mainnet-beta.solana.com", {signal:controller.signal})');
const timer = setTimeout(() => run('controller.abort()'), 45000);
try {
  assert.equal(await run('rpc.getGenesisHash()'), '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d');
  assert.ok(Number.isSafeInteger(await run('rpc.getSlot()')));
  const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  context.mint = mint;
  const metadata = await run('TokenService.getTokenMetadata(rpc,mint,controller.signal)');
  assert.equal(metadata.metadataUnavailable, false);
  assert.equal(metadata.symbol, 'USDC');
  assert.equal(metadata.isNft, false);
  const accounts = await run('rpc.getParsedTokenAccountsByOwner(new solanaWeb3.PublicKey("11111111111111111111111111111111"),{mint:new solanaWeb3.PublicKey(mint)})');
  assert.ok(Array.isArray(accounts.value));
  const url = 'https://lite-api.jup.ag/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint='+mint+'&amount=1000000000&slippageBps=50';
  context.quoteUrl = url;
  const quote = await run('Network.json(quoteUrl,{}, {signal:controller.signal})');
  assert.equal(quote.outputMint, mint);
  assert.equal(quote.inAmount, '1000000000');
  assert.ok(BigInt(quote.outAmount) > 0n);
  console.log('Live checks passed: mainnet identity, RPC read methods, USDC on-chain metadata decoder, and Jupiter quote identity/value.');
} finally { clearTimeout(timer); run('controller.abort()'); }

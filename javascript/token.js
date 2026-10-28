/* Read on-chain metadata only; arbitrary metadata URIs are never requested. */
const TokenService = (() => {
  const cache = new Map();
  const MAX_CACHE = 2000, TTL = 5 * 60 * 1000;
  const token2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
  const programs = new Set(['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', token2022]);
  const keyFor = (connection, mint) => `${connection.rpcEndpoint || ''}:${mint}`;
  const check = signal => { if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError'); };
  function cached(connection, mint) {
    const entry = cache.get(keyFor(connection, mint));
    return entry && entry.expires > Date.now() ? entry.value : null;
  }
  function remember(connection, mint, value) {
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
    cache.set(keyFor(connection, mint), { value, expires: Date.now() + TTL });
  }
  function describe(info, metadata) {
    const result = { name: 'Unknown token', symbol: 'Unknown', isNft: false, collection: null, metadataUnavailable: !info };
    const extension = info?.extensions?.find(item => item.extension === 'tokenMetadata')?.state;
    if (extension) { result.name = extension.name || result.name; result.symbol = extension.symbol || result.symbol; }
    if (metadata) {
      if (String(metadata.owner) !== window.assetMetadata.program) throw new Error('Wrong metadata program');
      const decoded = window.assetMetadata.decode(metadata.data);
      result.name = decoded.name || result.name; result.symbol = decoded.symbol || result.symbol;
      result.collection = decoded.collection;
      result.isNft = decoded.tokenStandard == null ? info?.decimals === 0 && info?.supply === '1' : [0, 3, 4, 5].includes(decoded.tokenStandard);
    }
    return result;
  }
  async function prefetch(connection, mints, signal) {
    if (!connection.getMultipleAccountsInfo) return;
    const missing = [...new Set(mints)].filter(mint => !cached(connection, mint));
    for (let offset = 0; offset < missing.length; offset += 50) {
      check(signal);
      const batch = missing.slice(offset, offset + 50);
      try {
        const publicKeys = batch.map(mint => new solanaWeb3.PublicKey(mint));
        const pdas = await Promise.all(publicKeys.map(mint => window.assetMetadata.address(mint)));
        const accounts = await connection.getMultipleAccountsInfo([...publicKeys, ...pdas]);
        check(signal);
        batch.forEach((mint, index) => {
          try {
            const account = accounts[index], metadata = accounts[index + batch.length];
            if (!account || !programs.has(String(account.owner)) || account.data.length < 82) return;
            // Token-2022 metadata extensions use the parsed fallback when no Metaplex account exists.
            if (String(account.owner) === token2022 && !metadata) return;
            const view = new DataView(account.data.buffer, account.data.byteOffset, account.data.byteLength);
            const info = { decimals: account.data[44], supply: view.getBigUint64(36, true).toString() };
            const result = describe(info, metadata);
            if (!result.metadataUnavailable) remember(connection, mint, result);
          } catch { /* A malformed item falls back independently, without losing its siblings. */ }
        });
      } catch (error) { check(signal); /* Unsupported batches fall back to individual read methods. */ }
    }
  }
  async function getTokenMetadata(connection, mint, signal) {
    check(signal);
    const hit = cached(connection, mint);
    if (hit) return hit;
    try {
      const publicKey = new solanaWeb3.PublicKey(mint);
      const account = await connection.getParsedAccountInfo(publicKey);
      const info = account?.value?.data?.parsed?.info;
      const metadata = await connection.getAccountInfo(await window.assetMetadata.address(publicKey));
      check(signal);
      const result = describe(info, metadata);
      if (!result.metadataUnavailable) remember(connection, mint, result);
      return result;
    } catch (error) {
      check(signal);
      return { name: 'Unknown token', symbol: 'Unknown', isNft: false, collection: null, metadataUnavailable: true };
    }
  }
  return { getTokenMetadata, prefetch };
})();

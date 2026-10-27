const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function app() {
  const elements = { displaySmallBalances: { checked: false } };
  const storage = new Map();
  const context = vm.createContext({
    console, document: { addEventListener() {}, getElementById: id => elements[id] },
    window: {}, AbortController, DOMException, URL, URLSearchParams, setTimeout, clearTimeout,
    Network: { json: async () => { throw new Error("No price"); } },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key),
    },
  });
  vm.runInContext(fs.readFileSync(`${__dirname}/../javascript/main.js`, 'utf8'), context);
  return { context, elements, storage, run: code => vm.runInContext(code, context) };
}

test('deduplicates and trims pasted addresses', () => {
  const { run } = app();
  assert.equal(run('JSON.stringify(uniqueAddresses(" wallet-a \\r\\nwallet-b\\nwallet-a\\r\\n"))'), '["wallet-a","wallet-b"]');
});

test('imports CSV address columns with quoted labels, BOM, CRLF, and escaped quotes', () => {
  const { context, run } = app();
  context.csv = '\ufeffLabel,Wallet Address\r\n"Wallet, one",wallet-a\r\n"Wallet ""two""",wallet-b\r\nDuplicate,wallet-a\r\n';
  assert.equal(run('JSON.stringify(parseWalletFile(csv, "wallets.csv"))'), '["wallet-a","wallet-b"]');
  assert.equal(run('JSON.stringify(parseWalletFile("wallet-a\\nwallet-b", "wallets.csv"))'), '["wallet-a","wallet-b"]');
  assert.throws(() => run('parseWalletFile("name,key\\na,b", "wallets.csv")'), /column heading/);
  assert.throws(() => run('parseCSV(\'"unfinished\')'), /unclosed quote/);
});

test('hides priced dust while keeping unpriced tokens and tiny quantities with substantial value', () => {
  const { run } = app();
  assert.equal(run(`JSON.stringify(visibleTokens([
    {balance: "1", usdcValue: null}, {balance: "1", usdcValue: 0.009},
    {balance: "1", usdcValue: 1}, {balance: "0", usdcValue: null}
  ]).map(t => t.usdcValue))`), '[null,1]');
  assert.equal(run('visibleTokens([{balance: "1", usdcValue: 0}], true).length'), 1);
});

test('formats balances without rounding large integers and supports zero decimals', () => {
  const { run } = app();
  assert.equal(run('formatTokenBalance("1234560000000", 9)'), '1,234.56');
  assert.equal(run('formatTokenBalance("1234", 0)'), '1,234');
  assert.equal(run('formatTokenBalance("9007199254740993123456", 6)'), '9,007,199,254,740,993.123456');
});

test('CSV export round-trips commas, quotes and line breaks with consistent column counts', () => {
  const { run, context } = app();
  context.name = 'A "quoted", token\nname';
  run(`Object.assign(searches.tokens, {
    results: [{walletAddress: "wallet-a", symbol: "EX", tokenName: name, tokenAddress: "mint", balance: "1234560000000", decimals: 9, usdcValue: null}],
    checked: ["wallet-a", "wallet-b"], failures: new Map([["wallet-b", "RPC failed"]])
  })`);
  assert.equal(run('parseCSV(createCSV("tokens"))[1][4]'), '1234.56');
  assert.equal(run('parseCSV(createCSV("tokens"))[1][2]'), context.name);
  assert.equal(run('parseCSV(createCSV("tokens")).every(row => row.length === 9)'), true);
  assert.equal(run('parseCSV(createCSV("tokens"))[2][6]'), 'FAILED');
});

test('cancellation releases an in-flight provider request immediately', async () => {
  const { run } = app();
  const waiting = run('globalThis.control = new AbortController(); withAbort(new Promise(() => {}), control.signal)');
  run('control.abort()');
  await assert.rejects(waiting, { name: 'AbortError' });
});

test('quote failures keep the balance available and remove timers', async () => {
  const { run, context } = app();
  context.Network.json = async () => { throw new Error("No price"); };
  assert.equal(await run('getTokenUsdcValue("mint", "1", new AbortController().signal)'), null);
  context.Network.json = async () => ({ inputMint: 'mint', outputMint: run('USDC_MINT'), inAmount: '1', outAmount: '1234567' });
  assert.equal(await run('getTokenUsdcValue("mint", "1", new AbortController().signal)'), 1.234567);
});

test('token lookups aggregate accounts and retain unpriced holdings when a program is unavailable', async () => {
  const { run, context } = app();
  context.solanaWeb3 = { PublicKey: class { constructor(value) { this.value = value; } } };
  context.TokenService = { getTokenMetadata: async () => ({ name: 'Test', symbol: 'T' }) };
  context.connection = {
    getBalance: async () => 0,
    getParsedTokenAccountsByOwner: async (owner, query) => {
      if (query.programId.value.startsWith('Tokenz')) throw new Error('Provider unavailable');
      return { value: ['1000000', '2000000'].map(amount => ({ account: { data: { parsed: { info: { mint: 'mint', tokenAmount: { amount, decimals: 6 } } } } } })) };
    },
  };
  run('getTokenUsdcValue = async () => null; wait = async () => {}');
  const result = await run('loadTokenWallet(connection, "wallet-a", [], new AbortController().signal)');
  assert.equal(result.entries[0].balance, '3000000');
  assert.equal(result.entries[0].usdcValue, null);
  assert.match(result.warning, /Some token accounts/);
});

function searchApp(includeNFTs = false) {
  const harness = app();
  for (const id of ['walletAddresses', 'wallet-input-error', 'search-message', 'tokenAddresses', 'nftCollectionAddresses', 'walletFile', 'importWalletsBtn', 'undoImportBtn', 'settingsBtn', 'searchBtn', 'cancelSearchBtn', 'search-empty', 'search-progress', 'search-progress-bar', 'search-progress-text', 'connection-status', 'connection-detail', 'connection-dot', 'retrySearchBtn']) {
    harness.elements[id] = { value: '', hidden: true, setAttribute() {}, focus() {} };
  }
  harness.elements.walletAddresses.value = 'wallet-a';
  harness.elements.includeNFTs = { checked: includeNFTs };
  harness.elements.rememberWallets = { checked: false };
  harness.elements.showAllTokens = { checked: true };
  harness.elements.showAllNFTs = { checked: true };
  harness.context.solanaWeb3 = { PublicKey: class { constructor(value) { this.value = value; } toString() { return this.value; } }, Connection: class { async getSlot() { return 42; } async getGenesisHash() { return "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"; } } };
  harness.context.window.solanaWeb3 = harness.context.solanaWeb3;
  harness.context.window.metaplex = { Metaplex: { make: () => ({}) } };
  harness.run(`settings.rpcUrl = 'https://example.com';
    renderResults = () => {};
    wait = async () => {};
    globalThis.lookups = [];
    loadTokenWallet = async (connection, address) => { lookups.push('tokens'); return { entries: [{walletAddress:address,balance:'1',usdcValue:null}], warning:'' }; };
    loadNftWallet = async (metaplex, address) => { lookups.push('nfts'); return { entries: [{walletAddress:address,nftName:'Example NFT'}], warning:'' }; };`);
  return harness;
}

test('default search fetches tokens only, even with unused NFT filters', async () => {
  const { run, elements } = searchApp();
  elements.showAllNFTs.checked = false;
  await run('runSearch()');
  assert.equal(run('JSON.stringify(lookups)'), '["tokens"]');
  assert.equal(run('searches.nfts.hasSearched'), false);
  assert.equal(run('searches.tokens.results.length'), 1);
});

test('Include NFTs performs both lookups in one run and disabling it clears old NFT results', async () => {
  const { run, elements } = searchApp(true);
  await run('runSearch()');
  assert.equal(run('JSON.stringify(lookups)'), '["tokens","nfts"]');
  assert.equal(run('searches.nfts.results.length'), 1);
  assert.equal(elements['search-progress-bar'].value, 1);
  assert.equal(elements.searchBtn.disabled, false);
  elements.includeNFTs.checked = false;
  await run('runSearch()');
  assert.equal(run('searches.nfts.results.length'), 0);
  assert.equal(run('searches.nfts.hasSearched'), false);
});

test('NFT provider failures report an incomplete wallet and preserve token holdings', async () => {
  const { run, context, elements } = searchApp(true);
  run('loadNftWallet = async () => { throw new Error("Provider failed"); }');
  await run('runSearch()');
  assert.equal(run('searches.tokens.results.length'), 1);
  assert.equal(run('searches.nfts.failures.size'), 1);
  assert.match(elements['search-message'].textContent, /0 failed · 1 incomplete/);
});

test('token failures still allow NFT results and a full failure is counted once per wallet', async () => {
  const { run, elements } = searchApp(true);
  run('loadTokenWallet = async () => { throw new Error("RPC failed"); }');
  await run('runSearch()');
  assert.equal(run('searches.nfts.results.length'), 1);
  assert.match(elements['search-message'].textContent, /0 failed · 1 incomplete/);
  run('loadNftWallet = async () => { throw new Error("RPC failed"); }');
  await run('runSearch()');
  assert.match(elements['search-message'].textContent, /1 failed/);
});

test('shared cancellation during NFTs preserves finished token holdings and releases controls', async () => {
  const { run, elements } = searchApp(true);
  run('loadNftWallet = async (metaplex, address, filters, signal) => { activeSearch.controller.abort(); assertActive(signal); }');
  await run('runSearch()');
  assert.equal(run('searches.tokens.results.length'), 1);
  assert.equal(run('searches.nfts.results.length'), 0);
  assert.equal(run('activeSearch'), null);
  assert.equal(elements.includeNFTs.disabled, false);
  assert.equal(elements.searchBtn.disabled, false);
  assert.match(elements['search-message'].textContent, /Search cancelled.*Retrieved holdings are kept/);
});

test('wallet storage stays empty while remembering is off', async () => {
  const { run, storage } = searchApp();
  await run('runSearch()');
  assert.equal(storage.has(run('WALLETS_KEY')), false);
});

test('remembering saves the normalized searched list, not later unsearched edits', async () => {
  const { run, elements, storage } = searchApp();
  elements.rememberWallets.checked = true;
  run("changeRememberWallets()");
  elements.walletAddresses.value = ' wallet-a \nwallet-b\nwallet-a';
  await run('runSearch()');
  elements.walletAddresses.value = 'unsearched-edit';
  assert.deepEqual(JSON.parse(storage.get(run('WALLETS_KEY'))), { remember: true, wallets: ['wallet-a', 'wallet-b'] });
});

test('opting in after a search remembers that search and opting out keeps the input', async () => {
  const { run, elements, storage } = searchApp();
  run('toast = text => { globalThis.lastToast = text; }');
  await run('runSearch()');
  elements.walletAddresses.value = 'unsearched-edit';
  elements.rememberWallets.checked = true;
  run('changeRememberWallets()');
  assert.deepEqual(JSON.parse(storage.get(run('WALLETS_KEY'))).wallets, ['wallet-a']);
  elements.rememberWallets.checked = false;
  run('changeRememberWallets()');
  assert.equal(storage.has(run('WALLETS_KEY')), false);
  assert.equal(elements.walletAddresses.value, 'unsearched-edit');
});

test('restoring remembered wallets restores the preference without querying a provider', () => {
  const { run, elements, storage } = searchApp();
  elements.walletAddresses.value = '';
  storage.set(run('WALLETS_KEY'), JSON.stringify({ remember: true, wallets: [' wallet-a ', 'wallet-b', 'wallet-a'] }));
  run('loadRememberedWallets()');
  assert.equal(elements.rememberWallets.checked, true);
  assert.equal(elements.walletAddresses.value, 'wallet-a\nwallet-b');
  assert.equal(run('JSON.stringify(lookups)'), '[]');
  elements.walletAddresses.value = 'current-edit';
  run('loadRememberedWallets()');
  assert.equal(elements.walletAddresses.value, 'current-edit');
});

test('malformed saved data leaves the input usable', () => {
  const { run, elements, storage } = searchApp();
  run('toast = text => { globalThis.lastToast = text; }');
  for (const data of ['{bad json', '{"remember":true,"wallets":[123]}']) {
    storage.set(run('WALLETS_KEY'), data);
    run('loadRememberedWallets()');
    assert.equal(elements.rememberWallets.checked, false);
    assert.equal(elements.walletAddresses.value, 'wallet-a');
    assert.match(run('lastToast'), /Couldn’t restore/);
  }
});

test('storage write failures do not block wallet searches', async () => {
  const { run, context, elements } = searchApp();
  elements.rememberWallets.checked = true;
  context.localStorage.setItem = () => { throw new Error('Storage unavailable'); };
  run('toast = text => { globalThis.lastToast = text; }');
  run('changeRememberWallets()');
  await run('runSearch()');
  assert.equal(run('searches.tokens.results.length'), 1);
  assert.equal(elements.searchBtn.disabled, false);
  assert.match(run('lastToast'), /Couldn’t save wallets/);
});

test('failed clearing reports the failure and keeps the preference accurate', () => {
  const { run, context, elements } = searchApp();
  context.localStorage.removeItem = () => { throw new Error('Storage unavailable'); };
  run('toast = text => { globalThis.lastToast = text; }');
  run('changeRememberWallets()');
  assert.equal(elements.rememberWallets.checked, true);
  assert.match(run('lastToast'), /Couldn’t clear saved wallets/);
});

test('RPC preflight failures preserve the previous results and expose a reconnect action', async () => {
  const {run,context,elements}=searchApp();
  await run('runSearch()');
  context.solanaWeb3.Connection=class{async getSlot(){throw Error('offline');}};
  await run('runSearch()');
  assert.equal(run('searches.tokens.results.length'),1);
  assert.match(elements['search-message'].textContent,/Previous results are kept/);
  assert.equal(elements['connection-status'].textContent,'Connection unavailable');
  assert.equal(elements.settingsBtn.disabled,false);
});

test('retry targets incomplete wallets with the original scope and preserves other holdings',async()=>{
 const {run,elements}=searchApp();elements.walletAddresses.value='wallet-a\nwallet-b';
 run(`loadTokenWallet=async(connection,address)=>{
   lookups.push(address);
   if(address==='wallet-b') throw Error('limited');
   return {entries:[{walletAddress:address,balance:'1',usdcValue:null}],warning:''};
 }`);
 await run('runSearch()');
 assert.equal(elements.retrySearchBtn.hidden,false);
 elements.walletAddresses.value='unsearched-edit';elements.includeNFTs.checked=true;
 run(`loadTokenWallet=async(connection,address)=>{lookups.push(address);return {entries:[{walletAddress:address,balance:'2',usdcValue:null}],warning:''};}`);
 await run('runSearch(true)');
 assert.equal(run('JSON.stringify(lookups)'),'["wallet-a","wallet-b","wallet-b"]');
 assert.equal(run('searches.tokens.results.length'),2);
 assert.equal(run('searches.nfts.hasSearched'),false);
 assert.equal(elements.retrySearchBtn.hidden,true);
});

test('remembering respects an opt-out from another tab before any later write',()=>{
 const {run,elements,storage}=searchApp();elements.rememberWallets.checked=true;
 run('changeRememberWallets()');storage.delete(run('WALLETS_KEY'));
 run('saveRememberedWallets(["wallet-a"])');
 assert.equal(elements.rememberWallets.checked,false);
 assert.equal(storage.has(run('WALLETS_KEY')),false);
 elements.walletAddresses.value='current edits';
 run('syncRememberedWallets({key:WALLETS_KEY,newValue:null})');
 assert.equal(elements.walletAddresses.value,'current edits');
});

test('CSV exports neutralize formulas and retain partial, failed and unchecked status',()=>{
 const {run}=app();
 run(`Object.assign(searches.tokens,{wallets:['a','b','c'],checked:['a','b'],results:[{walletAddress:'a',symbol:'=1+1',tokenName:'@SUM(1)',tokenAddress:'mint',balance:'1',decimals:0,usdcValue:null}],warnings:new Map([['a','Incomplete metadata']]),failures:new Map([['b','Failed']])})`);
 assert.equal(run('parseCSV(createCSV("tokens"))[1][1]'),"'=1+1");
 assert.equal(run('parseCSV(createCSV("tokens"))[1][6]'),'PARTIAL');
 assert.equal(run('parseCSV(createCSV("tokens"))[2][6]'),'FAILED');
 assert.equal(run('parseCSV(createCSV("tokens"))[3][6]'),'NOT_CHECKED');
 assert.equal(run('parseCSV(createCSV("tokens")).every(row=>row.length===9)'),true);
});

test('malformed CSV and ambiguous columns fail clearly',()=>{
 const {run}=app();
 assert.throws(()=>run('parseCSV(\'a,"closed"garbage\')'),/closing quote/);
 assert.throws(()=>run('parseWalletFile("Address,Wallet Address\\na,b", "wallets.csv")'),/multiple wallet/);
 assert.throws(()=>run('parseWalletFile("Label,Address\\nMissing,", "wallets.csv")'),/no wallet address/);
});

test('quotes with mismatched mint, amount or currency are rejected',async()=>{
 const {run,context}=app();context.Network.json=async()=>({inputMint:'wrong',outputMint:run('USDC_MINT'),inAmount:'1',outAmount:'1000000'});
 assert.equal(await run('getTokenUsdcValue("mint","1",new AbortController().signal)'),null);
});

test('already-aborted and non-responsive provider promises are safely bounded',async()=>{
 const {run}=app();
 await assert.rejects(run('globalThis.c=new AbortController();c.abort();withAbort(Promise.reject(new Error("late")),c.signal,10)'),{name:'AbortError'});
 await assert.rejects(run('withAbort(new Promise(()=>{}),new AbortController().signal,5)'),/too long/);
});

test('balances are published before pricing and remain usable when pricing is cancelled', async () => {
  const {run,context}=app();
  context.solanaWeb3={PublicKey:class{constructor(value){this.value=value;}}};
  context.TokenService={getTokenMetadata:async()=>({name:'Example',symbol:'EX'})};
  context.connection={getBalance:async()=>1000000000,getParsedTokenAccountsByOwner:async()=>({value:[]})};
  run(`globalThis.c=new AbortController();globalThis.published=[];
    getTokenUsdcValue=async()=>{c.abort();assertActive(c.signal);};`);
  await assert.rejects(run('loadTokenWallet(connection,"wallet-a",[],c.signal,entries=>published.push(...entries))'),{name:'AbortError'});
  assert.equal(run('published.length'),1);
  assert.equal(run('published[0].balance'),'1000000000');
  assert.equal(run('published[0].usdcValue'),null);
});

test('cancelling valuation keeps published holdings available for export and retry',async()=>{
 const {run,elements}=searchApp();
 run(`loadTokenWallet=async(connection,address,filters,signal,onProgress)=>{
   onProgress([{walletAddress:address,tokenAddress:'mint',tokenName:'Example',symbol:'EX',balance:'42',decimals:0,usdcValue:null}]);
   activeSearch.controller.abort();assertActive(signal);
 };`);
 await run('runSearch()');
 assert.equal(run('searches.tokens.results[0].balance'),'42');
 assert.equal(run('parseCSV(createCSV("tokens"))[1][6]'),'PARTIAL');
 assert.equal(elements.retrySearchBtn.hidden,false);
 assert.match(elements['search-message'].textContent,/cancelled/);
});

/* Browser-only UI and search lifecycle. No wallet access or transaction signing. */
const SETTINGS_KEY = "solanaWalletSearcherSettings";
const WALLETS_KEY = "solanaWalletSearcherWallets";
const MAX_WALLETS = 1000;
const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const PAGE_SIZE = 100;
const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const TOKEN_PROGRAMS = [
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
];
const $ = (id) => document.getElementById(id);
const searches = Object.fromEntries(["tokens", "nfts"].map((kind) => [kind, {
  results: [], wallets: [], checked: [], failures: new Map(), warnings: new Map(),
  running: false, hasSearched: false, limit: PAGE_SIZE, updatedAt: null,
}]));
let settings = { rpcUrl: "" };
let importVersion = 0;
let importing = false;
let lastImport = null;
let pendingSearch = false;
let activeSearch = null;
let lastRun = null;
let settingsController = null;
let settingsReturnFocus = null;
let toastTimer;

function uniqueAddresses(text) {
  return [...new Set(text.split(/\r?\n|\r/).map((line) => line.trim()).filter(Boolean))];
}

// Parse CSV records, including quoted commas, newlines, and escaped quotes.
function parseCSV(text) {
  if (text.length > MAX_INPUT_BYTES) throw new Error("The file is too large. Import a file smaller than 2 MB.");
  const rows = [];
  let row = [], field = "", quoted = false, closed = false;
  text = text.replace(/^\uFEFF/, "");
  const finishField = () => { row.push(field.trim()); field = ""; closed = false; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === '"') {
      if (field.trim() || closed) throw new Error("The CSV has a misplaced quote. Check the file and try again.");
      field = ""; quoted = true;
    } else if (c === ",") finishField();
    else if (c === "\n" || c === "\r") {
      finishField(); if (row.some(Boolean)) rows.push(row); row = [];
      if (c === "\r" && text[i + 1] === "\n") i++;
    } else if (closed && c.trim()) throw new Error("The CSV has text after a closing quote.");
    else if (!closed) field += c;
  }
  if (quoted) throw new Error("The CSV has an unclosed quote. Check the file and try again.");
  finishField(); if (row.some(Boolean)) rows.push(row);
  return rows;
}

function parseWalletFile(text, filename) {
  if (!filename.toLowerCase().endsWith(".csv")) return uniqueAddresses(text.replace(/^\uFEFF/, ""));
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const columns = rows[0].map((cell, index) => /^(wallet(address)?|address|publickey)$/.test(cell.toLowerCase().replace(/[\s_-]/g, "")) ? index : -1).filter(index => index >= 0);
  if (columns.length > 1) throw new Error("The CSV has multiple wallet address columns. Keep one address column.");
  const column = columns[0] ?? -1;
  if (column < 0 && rows.some((row) => row.length > 1)) {
    throw new Error('Add a “Wallet Address” column heading, or use a CSV with one address per row.');
  }
  const records = column >= 0 ? rows.slice(1) : rows;
  if (records.some(row => !row[column < 0 ? 0 : column])) throw new Error("A CSV row has no wallet address. Fill it in or remove the row.");
  return [...new Set(records.map(row => row[column < 0 ? 0 : column]))];
}

function getWalletAddresses() {
  return uniqueAddresses($("walletAddresses").value);
}

function readRememberedWallets(raw) {
  if (raw && raw.length > MAX_INPUT_BYTES) throw new Error("Invalid saved wallets");
  const saved = JSON.parse(raw || "null");
  if (!saved) return null;
  if (saved.remember !== true || !Array.isArray(saved.wallets) || saved.wallets.length > MAX_WALLETS || !saved.wallets.every(address => typeof address === "string" && address.length <= 100)) throw new Error("Invalid saved wallets");
  return uniqueAddresses(saved.wallets.join("\n"));
}

function loadRememberedWallets() {
  try {
    const wallets = readRememberedWallets(localStorage.getItem(WALLETS_KEY));
    $("rememberWallets").checked = wallets !== null;
    if (wallets && !$("walletAddresses").value.trim()) $("walletAddresses").value = wallets.join("\n");
  } catch {
    $("rememberWallets").checked = false;
    toast("Couldn’t restore saved wallets. Paste or import them again.");
  }
}

function saveRememberedWallets(wallets, optIn = false) {
  if (!$("rememberWallets").checked) return false;
  try {
    // Recheck durable consent: another tab may have cleared the saved list.
    if (!optIn && readRememberedWallets(localStorage.getItem(WALLETS_KEY)) === null) { $("rememberWallets").checked = false; return false; }
    localStorage.setItem(WALLETS_KEY, JSON.stringify({ remember: true, wallets }));
    return true;
  } catch {
    if (optIn) $("rememberWallets").checked = false;
    toast("Couldn’t save wallets in this browser. Your search can still continue.");
    return false;
  }
}

function changeRememberWallets() {
  if ($("rememberWallets").checked) {
    saveRememberedWallets(lastRun?.wallets || searches.tokens.wallets, true);
    return;
  }
  try { localStorage.removeItem(WALLETS_KEY); toast("Saved wallets cleared"); }
  catch { $("rememberWallets").checked = true; toast("Couldn’t clear saved wallets. Check this site’s storage permissions."); }
}

function syncRememberedWallets(event) {
  if (event.key !== WALLETS_KEY && event.key !== null) return;
  try { $("rememberWallets").checked = readRememberedWallets(event.newValue) !== null; }
  catch { $("rememberWallets").checked = false; }
  // Preserve unsaved input in this tab; only future searches follow the new preference.
}

function inputError(message = "") {
  $("wallet-input-error").textContent = message;
  $("wallet-input-error").hidden = !message;
  $("walletAddresses").setAttribute("aria-invalid", String(Boolean(message)));
}

function importFeedback(text, state) {
  $("import-feedback").hidden = false;
  $("import-feedback").dataset.state = state;
  $("import-status").textContent = text;
}

async function importWalletFile(file) {
  if (!file || activeSearch) return;
  const version = ++importVersion;
  inputError();
  $("undoImportBtn").hidden = true;
  importing = true;
  importFeedback(`Importing ${file.name}…`, "loading");
  try {
    if (file.size > MAX_INPUT_BYTES) throw new Error("The file is too large. Import a file smaller than 2 MB.");
    if (!/\.(txt|csv)$/i.test(file.name)) throw new Error("Choose a TXT or CSV file.");
    const addresses = parseWalletFile(await file.text(), file.name);
    if (version !== importVersion) return;
    if (!addresses.length) throw new Error("This file contains no wallet addresses.");
    if (addresses.length > MAX_WALLETS) throw new Error(`Import up to ${MAX_WALLETS.toLocaleString()} wallets at a time.`);
    // Merge into the current input, including edits made while the file was read.
    const current = getWalletAddresses();
    const existing = new Set(current);
    const added = addresses.filter((address) => !existing.has(address));
    if (current.length + added.length > MAX_WALLETS) throw new Error(`Search up to ${MAX_WALLETS.toLocaleString()} wallets at a time.`);
    if (added.length) $("walletAddresses").value = [...current, ...added].join("\n");
    lastImport = added.length ? added : null;
    $("undoImportBtn").hidden = !added.length;
    $("undoImportBtn").textContent = "Undo import";
    importFeedback(added.length ? `${file.name} · ${added.length} wallet${added.length === 1 ? "" : "s"} added` : `${file.name} · All wallets already in your list`, "success");
  } catch (error) {
    if (version !== importVersion) return;
    importFeedback(`Couldn’t import ${file.name}`, "error");
    inputError(error.message);
    // A failed import leaves the existing wallet list and its undo action intact.
    $("undoImportBtn").hidden = !lastImport;
    $("undoImportBtn").textContent = "Undo previous import";
  } finally {
    if (version === importVersion) importing = false;
  }
}

function undoImport() {
  if (!lastImport || importing) return;
  const added = new Set(lastImport);
  $("walletAddresses").value = getWalletAddresses().filter((address) => !added.has(address)).join("\n");
  lastImport = null;
  $("import-feedback").hidden = true;
  $("undoImportBtn").hidden = true;
  inputError();
  $("walletAddresses").focus();
  toast("Import undone");
}

function setupWalletImport() {
  $("importWalletsBtn").addEventListener("click", () => $("walletFile").click());
  $("walletFile").addEventListener("change", () => {
    const file = $("walletFile").files[0];
    $("walletFile").value = ""; // Choosing the same file again should still import it.
    importWalletFile(file);
  });
  $("undoImportBtn").addEventListener("click", undoImport);
  const zone = $("wallet-drop-zone");
  let dragDepth = 0;
  const isFileDrag = (event) => [...(event.dataTransfer?.types || [])].includes("Files");
  zone.addEventListener("dragenter", (event) => {
    if (!isFileDrag(event) || $("walletAddresses").disabled) return;
    event.preventDefault(); dragDepth++;
    zone.classList.add("drag-over");
  });
  zone.addEventListener("dragover", (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = $("walletAddresses").disabled ? "none" : "copy";
  });
  zone.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) zone.classList.remove("drag-over");
  });
  zone.addEventListener("drop", (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault(); dragDepth = 0; zone.classList.remove("drag-over");
    if ($("walletAddresses").disabled) return;
    if (event.dataTransfer.files.length !== 1) { inputError("Import one TXT or CSV file at a time."); return; }
    importWalletFile(event.dataTransfer.files[0]);
  });
}

function setConnection(status, detail, state = "") {
  $("connection-status").textContent = status;
  $("connection-detail").textContent = detail;
  $("connection-dot").className = `status-dot ${state}`;
  $("settingsBtn").textContent = settings.rpcUrl ? "Connection settings" : "Set up RPC";
}

function openSettings(resumeSearch = false) {
  pendingSearch = resumeSearch;
  settingsReturnFocus = $(resumeSearch ? "searchBtn" : "settingsBtn");
  $("rpcUrl").value = settings.rpcUrl;
  $("rpc-error").hidden = true;
  $("rpcUrl").removeAttribute("aria-invalid");
  $("settings-modal").showModal();
  $("rpcUrl").focus();
}

function normalizeRpcUrl(value) {
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error("Enter a valid RPC URL."); }
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new Error("Use an HTTPS RPC URL, or HTTP on localhost or 127.0.0.1.");
  if (url.username || url.password) throw new Error("Use your provider’s HTTPS endpoint without embedded username or password credentials.");
  url.hash = "";
  return url.toString();
}

function createConnection(signal) {
  return new solanaWeb3.Connection(settings.rpcUrl, { signal });
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    if (typeof saved?.rpcUrl === "string" && saved.rpcUrl) settings.rpcUrl = normalizeRpcUrl(saved.rpcUrl);
    if (settings.rpcUrl) setConnection("RPC saved", "Your saved endpoint will be checked when you search.");
  } catch { toast("Saved connection settings could not be loaded. Add your RPC URL again."); }
}

async function saveSettings(event) {
  event.preventDefault();
  if (settingsController) return;
  const input = $("rpcUrl").value.trim();
  const button = $("saveSettingsBtn");
  const controller = new AbortController();
  settingsController = controller;
  const timer = setTimeout(() => controller.abort(), 12000);
  button.disabled = true; button.textContent = "Testing connection…";
  $("rpc-error").hidden = true;
  try {
    const url = normalizeRpcUrl(input);
    if (!window.solanaWeb3) throw new Error("Solana tools could not load. Check your connection and reload the page.");
    const connection = new solanaWeb3.Connection(url, { signal: controller.signal });
    await withAbort(connection.getSlot(), controller.signal);
    // Verify the endpoint's chain before persisting a mainnet-only configuration.
    const genesis = await withAbort(connection.getGenesisHash(), controller.signal);
    if (genesis !== MAINNET_GENESIS) throw new Error("This endpoint is not Solana mainnet. Choose a mainnet RPC URL.");
    let savedToBrowser = true;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ rpcUrl: url })); }
    catch { savedToBrowser = false; }
    settings.rpcUrl = url;
    setConnection("Connected to Solana mainnet", "Connection verified. Wallet data is requested through your saved RPC endpoint.", "connected");
    const resume = pendingSearch;
    $("settings-modal").close();
    toast(savedToBrowser ? "Connection saved" : "Connected for this visit. Your browser could not save the RPC URL.");
    if (resume) runSearch();
  } catch (error) {
    if (!$("settings-modal").open) return;
    // Provider errors can contain URLs with API keys; keep UI errors credential-free.
    $("rpc-error").textContent = error.name === "AbortError"
      ? "The connection test timed out. Check the endpoint and try again."
      : (error.message.startsWith("Use ") || error.message.startsWith("This endpoint") || error.message.startsWith("Enter a") || error.message.startsWith("Solana tools"))
        ? error.message : "Could not connect. Check your RPC URL, provider limits, and browser access (CORS).";
    $("rpc-error").hidden = false;
    $("rpcUrl").setAttribute("aria-invalid", "true");
  } finally {
    clearTimeout(timer);
    if (settingsController === controller) settingsController = null;
    button.disabled = false; button.textContent = "Test & save connection";
  }
}

function withAbort(promise, signal, timeout = 40000) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(new DOMException("Cancelled", "AbortError")); };
    // Attach both handlers even when already aborted, so late provider rejections are consumed.
    Promise.resolve(promise).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => { cleanup(); reject(new Error("The provider took too long to respond. Retry the search.")); }, timeout);
  });
}

function assertActive(signal) {
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    assertActive(signal);
    const abort = () => { clearTimeout(timer); reject(new DOMException("Cancelled", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

function setBusy(busy) {
  for (const id of ["walletAddresses", "walletFile", "importWalletsBtn", "undoImportBtn", "showAllTokens", "showAllNFTs", "includeNFTs", "tokenAddresses", "nftCollectionAddresses", "settingsBtn", "searchBtn"]) $(id).disabled = busy;
  $("cancelSearchBtn").hidden = !busy;
  $("searchBtn").textContent = busy ? "Searching…" : "Search wallets";
  $("search-progress").hidden = !busy;
  $("retrySearchBtn").disabled = busy;
}

function visibleTokens(results, includeSmall = $("displaySmallBalances").checked) {
  return results.filter((token) => token.balance !== "0" && (includeSmall || token.usdcValue == null || token.usdcValue >= 0.01));
}

function searchMessage(text, tone = "") {
  const element = $("search-message");
  element.textContent = text; element.className = `message ${tone}`; element.hidden = !text;
}

function retryableWallets() {
  if (!lastRun) return [];
  return lastRun.wallets.filter(address => lastRun.kinds.some(kind => !searches[kind].checked.includes(address) || searches[kind].failures.has(address) || searches[kind].warnings.has(address)));
}

async function runSearch(retry = false) {
  if (activeSearch) return;
  inputError(); searchMessage("");
  if (importing) { inputError("Wait for the file to finish importing."); return; }
  if (!window.solanaWeb3) { searchMessage("Solana tools could not load. Reload the page and try again.", "error"); return; }
  let plan;
  if (retry && lastRun) plan = { ...lastRun, targets: retryableWallets() };
  else {
    if ($("walletAddresses").value.length > MAX_INPUT_BYTES) { inputError("The wallet list is too large. Search up to 1,000 wallets at a time."); return; }
    const wallets = getWalletAddresses();
    if (!wallets.length || wallets.length > MAX_WALLETS) { inputError(!wallets.length ? "Add at least one wallet address to begin." : "Search up to 1,000 wallets at a time."); $("walletAddresses").focus(); return; }
    const invalid = wallets.filter(address => { try { new solanaWeb3.PublicKey(address); return false; } catch { return true; } });
    if (invalid.length) { inputError(`${invalid.length} invalid wallet address${invalid.length === 1 ? "" : "es"}. Check: ${invalid.slice(0, 3).join(", ")}`); $("walletAddresses").focus(); return; }
    const kinds = $("includeNFTs").checked ? ["tokens", "nfts"] : ["tokens"];
    const filters = {};
    for (const kind of kinds) {
      const all = $(kind === "tokens" ? "showAllTokens" : "showAllNFTs").checked;
      const field = $(kind === "tokens" ? "tokenAddresses" : "nftCollectionAddresses");
      filters[kind] = all ? [] : uniqueAddresses(field.value);
      if (!all) {
        try {
          if (!filters[kind].length || filters[kind].length > MAX_WALLETS) throw new Error();
          filters[kind].forEach(address => new solanaWeb3.PublicKey(address));
        } catch { searchMessage(`Enter valid ${kind === "tokens" ? "token mint" : "collection"} addresses, one per line.`, "error"); field.focus(); return; }
      }
    }
    plan = { kinds, wallets, filters, targets: wallets };
  }
  if (!plan.targets.length) return;
  if (!settings.rpcUrl) { openSettings(true); return; }
  const { kinds, wallets, filters, targets } = plan;
  const run = { ...plan, controller: new AbortController(), checked: [] };
  activeSearch = run;
  const { signal } = run.controller;
  setBusy(true);
  $("search-progress-bar").max = targets.length;
  $("search-progress-bar").value = 0;
  $("search-progress-text").textContent = `Checking connection…`;
  let cancelled = false, committed = false;
  try {
    const connection = createConnection(signal);
    try {
      await withAbort(connection.getSlot(), signal);
      if (await withAbort(connection.getGenesisHash(), signal) !== MAINNET_GENESIS) throw new Error("Wrong network");
    } catch (error) {
      if (error.name === "AbortError") throw error;
      setConnection("Connection unavailable", "Check your mainnet endpoint and provider limits in connection settings.", "failed");
      throw new Error("Could not verify a Solana mainnet connection. Check connection settings and retry. Previous results are kept.");
    }
    setConnection("Connected to Solana mainnet", "Connection verified. Ready to search.", "connected");
    // Commit a new scan only after preflight succeeds; connection errors keep prior results.
    if (!retry) {
      for (const kind of Object.keys(searches)) {
        const included = kinds.includes(kind);
        Object.assign(searches[kind], { results: [], wallets: included ? wallets : [], checked: [], failures: new Map(), warnings: new Map(), hasSearched: included, running: included, limit: PAGE_SIZE, updatedAt: null });
        renderResults(kind);
      }
      lastRun = { kinds, wallets, filters };
      saveRememberedWallets(wallets);
    } else kinds.forEach(kind => { searches[kind].running = true; });
    committed = true;
    $("search-empty").hidden = true;
    $("retrySearchBtn").hidden = true;
    for (const address of targets) {
      for (const kind of kinds) {
        assertActive(signal);
        const search = searches[kind];
        $("search-progress-text").textContent = `Checking ${kind === "tokens" ? "tokens" : "NFTs"} for ${abbreviateAddress(address)} · ${run.checked.length} of ${targets.length} wallets checked`;
        try {
          const result = kind === "tokens"
            ? await loadTokenWallet(connection, address, filters.tokens, signal, partial => {
                assertActive(signal);
                const retrievedAt = new Date().toISOString();
                search.results = search.results.filter(entry => entry.walletAddress !== address);
                search.results.push(...partial.map(entry => ({ ...entry, retrievedAt })));
                search.warnings.set(address, "Valuation was not completed. Retry to refresh these holdings.");
                renderResults(kind);
              })
            : await loadNftWallet(connection, address, filters.nfts, signal);
          assertActive(signal);
          search.results = search.results.filter(entry => entry.walletAddress !== address);
          const retrievedAt = new Date().toISOString();
          search.results.push(...result.entries.map(entry => ({ ...entry, retrievedAt })));
          search.failures.delete(address); search.warnings.delete(address);
          if (result.warning) search.warnings.set(address, result.warning);
        } catch (error) {
          if (error.name === "AbortError") throw error;
          search.failures.set(address, `Could not fetch ${kind === "tokens" ? "token" : "NFT"} holdings. Check your provider limits and retry this wallet.`);
        }
        if (!search.checked.includes(address)) search.checked.push(address);
        search.updatedAt = new Date();
        renderResults(kind);
      }
      run.checked.push(address);
      $("search-progress-bar").value = run.checked.length;
      if (run.checked.length < targets.length) await wait(200, signal);
    }
  } catch (error) {
    cancelled = error.name === "AbortError";
    if (!cancelled) searchMessage(error.message, "error");
  } finally {
    const restoreFocus = document.activeElement === $("cancelSearchBtn");
    if (committed) for (const kind of kinds) { searches[kind].running = false; renderResults(kind); }
    setBusy(false); activeSearch = null;
    $("retrySearchBtn").hidden = !retryableWallets().length;
    if (cancelled || $("search-message").hidden) {
      const checked = committed ? wallets.filter(address => kinds.every(kind => searches[kind].checked.includes(address))).length : 0;
      const failed = committed ? wallets.filter(address => kinds.every(kind => searches[kind].failures.has(address))).length : 0;
      const incomplete = committed ? wallets.filter(address => !kinds.every(kind => searches[kind].failures.has(address)) && kinds.some(kind => searches[kind].failures.has(address) || searches[kind].warnings.has(address))).length : 0;
      searchMessage(`${cancelled ? "Search cancelled. " : ""}${checked} of ${wallets.length} wallet${wallets.length === 1 ? "" : "s"} checked · ${failed} failed${incomplete ? ` · ${incomplete} incomplete` : ""}.${cancelled ? " Retrieved holdings are kept." : ""}`, cancelled || failed || incomplete ? "warning" : "success");
    }
    if (restoreFocus) $("searchBtn").focus();
  }
}

const accountQueries = new WeakMap();
async function getWalletAccounts(connection, owner, filters, signal) {
  let cache = accountQueries.get(connection);
  if (!cache) { cache = new Map(); accountQueries.set(connection, cache); }
  const key = `${owner}:${filters.join(",")}`;
  if (cache.has(key)) return cache.get(key);
  const query = (async () => {
    const accounts = [], warnings = [];
    const queries = filters.length ? filters.map(mint => ({ mint: new solanaWeb3.PublicKey(mint) })) : TOKEN_PROGRAMS.map(programId => ({ programId: new solanaWeb3.PublicKey(programId) }));
    let successfulQueries = 0;
    for (const filter of queries) {
      try {
        const result = await withAbort(connection.getParsedTokenAccountsByOwner(owner, filter), signal);
        accounts.push(...result.value); successfulQueries++;
      } catch (error) {
        if (error.name === "AbortError") throw error;
        warnings.push("Some token accounts could not be retrieved.");
      }
    }
    return { accounts, warnings, successfulQueries };
  })();
  cache.set(key, query);
  return query;
}

async function loadTokenWallet(connection, walletAddress, filters, signal, onProgress = () => {}) {
  const owner = new solanaWeb3.PublicKey(walletAddress);
  const entries = [];
  const warnings = [];
  if (!filters.length || filters.includes(SOL_MINT)) {
    try {
      const balance = await withAbort(connection.getBalance(owner), signal);
      if (balance > 0) entries.push({ walletAddress, tokenAddress: SOL_MINT, tokenName: "Solana", symbol: "SOL", balance: String(balance), decimals: 9, isNativeSol: true });
    } catch (error) { if (error.name === "AbortError") throw error; warnings.push("SOL balance unavailable."); }
  }
  const balances = new Map();
  const snapshot = await getWalletAccounts(connection, owner, filters, signal);
  warnings.push(...snapshot.warnings);
  for (const account of snapshot.accounts) {
    try {
      const info = account.account.data.parsed.info;
      const amount = info.tokenAmount;
      if (!/^\d+$/.test(amount.amount) || !Number.isInteger(amount.decimals) || amount.decimals < 0 || amount.decimals > 255) throw new Error("Invalid balance");
      if (BigInt(amount.amount) === 0n) continue;
      const previous = balances.get(info.mint);
      balances.set(info.mint, { balance: (BigInt(previous?.balance || 0) + BigInt(amount.amount)).toString(), decimals: amount.decimals });
    } catch { warnings.push("Some token balances could not be read."); }
  }
  if (!snapshot.successfulQueries && !entries.length) throw new Error("Wallet queries failed");
  if (TokenService.prefetch) await withAbort(TokenService.prefetch(connection, [...balances.keys()], signal), signal);
  for (const [mint, amount] of balances) {
    const metadata = await withAbort(TokenService.getTokenMetadata(connection, mint, signal), signal);
    if (metadata.isNft) continue;
    if (metadata.metadataUnavailable) warnings.push("Some asset metadata is unavailable.");
    entries.push({ walletAddress, tokenAddress: mint, tokenName: metadata.name, symbol: metadata.symbol, ...amount });
  }
  onProgress(entries.map(entry => ({ ...entry, usdcValue: null })));
  for (const entry of entries) {
    assertActive(signal);
    entry.usdcValue = entry.tokenAddress === USDC_MINT
      ? Number(entry.balance) / 10 ** entry.decimals
      : await getTokenUsdcValue(entry.tokenAddress, entry.balance, signal);
    if (entry.tokenAddress !== USDC_MINT) await wait(150, signal);
  }
  entries.sort((a, b) => Number(Boolean(b.isNativeSol)) - Number(Boolean(a.isNativeSol)) || (b.usdcValue || 0) - (a.usdcValue || 0));
  return { entries, warning: [...new Set(warnings)].join(" ") };
}

const quoteCache = new Map();
async function getTokenUsdcValue(inputMint, amount, signal) {
  const key = `${inputMint}:${amount}`;
  const cached = quoteCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  try {
    assertActive(signal);
    const params = new URLSearchParams({ inputMint, outputMint: USDC_MINT, amount, slippageBps: 50 });
    const quote = await Network.json(`https://lite-api.jup.ag/swap/v1/quote?${params}`, {}, { signal, timeout: 5000, retries: 1 });
    if (quote.inputMint !== inputMint || quote.outputMint !== USDC_MINT || quote.inAmount !== amount || !/^\d+$/.test(quote.outAmount)) return null;
    const value = Number(quote.outAmount) / 1e6;
    if (!Number.isFinite(value)) return null;
    if (quoteCache.size > 2000) quoteCache.clear();
    quoteCache.set(key, { value, expires: Date.now() + 15000 });
    return value;
  } catch { assertActive(signal); return null; }
}

async function loadNftWallet(connection, walletAddress, filters, signal) {
  const snapshot = await getWalletAccounts(connection, new solanaWeb3.PublicKey(walletAddress), [], signal);
  if (!snapshot.successfulQueries) throw new Error("NFT account lookup failed");
  const entries = [], seen = new Set(), warnings = [...snapshot.warnings];
  const candidates = snapshot.accounts.flatMap(account => {
    const info = account.account?.data?.parsed?.info;
    return info?.tokenAmount?.decimals === 0 ? [info.mint] : [];
  });
  if (TokenService.prefetch) await withAbort(TokenService.prefetch(connection, candidates, signal), signal);
  for (const account of snapshot.accounts) {
    assertActive(signal);
    try {
      const info = account.account.data.parsed.info;
      if (info.tokenAmount.decimals !== 0 || BigInt(info.tokenAmount.amount) === 0n || seen.has(info.mint)) continue;
      seen.add(info.mint);
      const metadata = await withAbort(TokenService.getTokenMetadata(connection, info.mint, signal), signal);
      if (metadata.metadataUnavailable) { warnings.push("Some NFT metadata could not be read."); continue; }
      if (!metadata.isNft) continue;
      const collection = metadata.collection;
      // Collection filters match verified membership, not a claimed collection address.
      if (filters.length && (!collection?.verified || !filters.includes(collection.address))) continue;
      const collectionName = await withAbort(NFTService.getCollectionName(connection, collection, signal), signal);
      entries.push({ walletAddress, nftAddress: info.mint, nftName: metadata.name || "Unnamed NFT", collectionAddress: collection?.address || "", collectionName, collectionVerified: Boolean(collection?.verified) });
    } catch (error) { if (error.name === "AbortError") throw error; warnings.push("Some NFT records could not be read."); }
  }
  entries.sort((a, b) => a.collectionName.localeCompare(b.collectionName) || a.nftName.localeCompare(b.nftName));
  return { entries, warning: [...new Set(warnings)].join(" ") };
}

function formatTokenBalance(balance, decimals = 9) {
  // Format raw integer amounts without losing precision or treating 0 decimals as 9.
  const digits = BigInt(balance).toString().padStart(decimals + 1, "0");
  const integer = decimals ? digits.slice(0, -decimals) : digits;
  const fraction = decimals ? digits.slice(-decimals).replace(/0+$/, "") : "";
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraction ? `.${fraction}` : "");
}
function abbreviateAddress(address) { return address.length > 16 ? `${address.slice(0, 6)}…${address.slice(-6)}` : address; }
function formatValue(value) { return value == null ? "Price unavailable" : value > 0 && value < .01 ? "<0.01 USDC" : `${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`; }
function node(tag, className = "", text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}
function addressButton(address, label) {
  const button = node("button", "address address-copy", abbreviateAddress(address));
  button.type = "button"; button.title = address; button.dataset.focusKey = `copy:${address}`;
  button.setAttribute("aria-label", `Copy ${label}: ${address}`);
  button.addEventListener("click", () => copyToClipboard(address, `${label} copied`));
  return button;
}
function explorerLink(address, type = "token") {
  const link = node("a", "icon-button");
  link.href = `https://solscan.io/${type}/${encodeURIComponent(address)}`;
  link.target = "_blank"; link.rel = "noopener noreferrer"; link.dataset.focusKey = `view:${type}:${address}`;
  link.setAttribute("aria-label", "View on Solscan (opens in a new tab)"); link.title = "View on Solscan";
  link.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M10 5H5v14h14v-5"/></svg>';
  return link;
}
function appendCell(row, content, className = "") {
  const cell = node("td", className);
  if (typeof content === "string") cell.textContent = content;
  else cell.append(content);
  row.append(cell);
}
function createTable(kind, entries, includeWallet, key) {
  const scroll = node("div", "table-scroll");
  scroll.dataset.scrollKey = key;
  scroll.tabIndex = 0;
  scroll.setAttribute("role", "region");
  scroll.setAttribute("aria-label", `${kind === "tokens" ? "Token" : "NFT"} holdings${includeWallet ? " for all wallets" : ` for ${key}`}. Scroll horizontally for more columns.`);
  const table = node("table", "results-table");
  const caption = node("caption", "sr-only", `${kind === "tokens" ? "Token" : "NFT"} holdings${includeWallet ? " across wallets" : ` for ${key}`}`);
  const head = node("thead"), header = node("tr");
  const columns = [...(includeWallet ? ["Wallet"] : []), ...(kind === "tokens" ? ["Asset", "Mint address", "Balance", "Est. value (USDC)", "Explore"] : ["NFT", "Collection", "NFT address", "Explore"])];
  columns.forEach((name) => { const cell = node("th", name === "Balance" || name === "Est. value (USDC)" ? "numeric" : "", name); cell.scope = "col"; header.append(cell); });
  head.append(header);
  const body = node("tbody");
  entries.forEach((entry) => {
    const row = node("tr");
    if (includeWallet) appendCell(row, addressButton(entry.walletAddress, "wallet address"));
    const asset = node("div");
    asset.append(node("strong", "", kind === "tokens" ? entry.symbol || "Unknown" : entry.nftName));
    if (kind === "tokens") {
      asset.append(node("small", "", entry.tokenName || "Unknown token"));
      appendCell(row, asset, "asset-name");
      appendCell(row, addressButton(entry.tokenAddress, "token address"));
      appendCell(row, formatTokenBalance(entry.balance, entry.decimals), "numeric");
      appendCell(row, entry.usdcValue == null ? "Price unavailable" : formatValue(entry.usdcValue).replace(" USDC", ""), "numeric");
    } else {
      appendCell(row, asset, "asset-name");
      const collection = node("div", "asset-name");
      collection.append(node("strong", "", entry.collectionName));
      if (entry.collectionAddress) collection.append(addressButton(entry.collectionAddress, "collection address"));
      if (entry.collectionAddress && entry.collectionVerified === false) collection.append(node("small", "", "Unverified collection"));
      appendCell(row, collection);
      appendCell(row, addressButton(entry.nftAddress, "NFT address"));
    }
    appendCell(row, explorerLink(kind === "tokens" ? entry.tokenAddress : entry.nftAddress), "actions-cell");
    body.append(row);
  });
  table.append(caption, head, body);
  scroll.append(table);
  const block = node("div", "table-block");
  block.append(node("p", "table-hint", "Scroll sideways to see all columns →"), scroll);
  return block;
}

function assetLabel(kind, count) { return kind === "tokens" ? `token balance${count === 1 ? "" : "s"}` : `NFT${count === 1 ? "" : "s"}`; }

function renderResults(kind) {
  const search = searches[kind], container = $(`${kind}-result-container`);
  if (!search.hasSearched) { $(`${kind}-result`).hidden = true; $(`${kind}-more`).hidden = true; container.replaceChildren(); return; }
  $(`${kind}-result`).hidden = false;
  const entries = kind === "tokens" ? visibleTokens(search.results) : search.results;
  const limit = search.limit || PAGE_SIZE;
  const byWallet = new Map(search.checked.map(address => [address, []]));
  const scores = new Map();
  for (const entry of entries) {
    if (!byWallet.has(entry.walletAddress)) byWallet.set(entry.walletAddress, []);
    byWallet.get(entry.walletAddress).push(entry);
    scores.set(entry.walletAddress, (scores.get(entry.walletAddress) || 0) + (kind === "tokens" ? entry.usdcValue || 0 : 1));
  }
  const groups = [...byWallet.keys()].sort((a, b) => (scores.get(b) || 0) - (scores.get(a) || 0));
  let remaining = limit, renderedCount = 0;
  const grouped = $(kind === "tokens" ? "groupByWalletTokens" : "groupByWalletNFTs").checked;
  const positions = new Map([...container.querySelectorAll(".table-scroll")].map(el => [el.dataset.scrollKey, el.scrollLeft]));
  const focused = container.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
  container.replaceChildren();
  const shownGroups = groups.slice(0, limit);
  const flat = [];
  for (const address of shownGroups) {
    const all = byWallet.get(address);
    const walletEntries = all.slice(0, Math.max(0, remaining));
    remaining -= walletEntries.length;
    renderedCount += walletEntries.length;
    if (!grouped) flat.push(...walletEntries);
    if (!grouped && !search.failures.has(address) && !search.warnings.has(address)) continue;
    if (grouped && all.length && !walletEntries.length && !search.failures.has(address) && !search.warnings.has(address)) continue;
    const section = node("section", "wallet-group");
    const heading = node("div", "wallet-header");
    const title = node("div", "wallet-title"); title.append(addressButton(address, "wallet address"), explorerLink(address, "account"));
    heading.append(title, node("span", "wallet-count", search.failures.has(address) ? "Needs retry" : `${all.length} ${assetLabel(kind, all.length)}`));
    section.append(heading);
    if (search.failures.has(address)) section.append(node("p", "inline-note error", search.failures.get(address) + (all.length ? " Previously retrieved holdings are kept below." : "")));
    if (search.warnings.has(address)) {
      const message = search.warnings.get(address);
      section.append(node("p", "inline-note warning", search.running && message.startsWith("Valuation was not completed.") ? "Pricing holdings…" : message));
    }
    if (grouped) {
      if (walletEntries.length) section.append(createTable(kind, walletEntries, false, address));
      else if (!search.failures.has(address)) section.append(node("p", "inline-note", search.results.some(entry => entry.walletAddress === address) ? "All balances are below 0.01 USDC. Enable small balances to see them." : "No holdings found for this search."));
    }
    container.append(section);
  }
  if (!grouped && flat.length) container.append(createTable(kind, flat, true, "all"));
  if (!groups.length || (!grouped && !entries.length)) container.append(node("p", "inline-note", search.running ? "Results appear here as each lookup finishes." : "No holdings to display. Check filters and any failed wallets above."));
  container.querySelectorAll(".table-scroll").forEach(el => { el.scrollLeft = positions.get(el.dataset.scrollKey) || 0; });
  if (focused) [...container.querySelectorAll("[data-focus-key]")].find(el => el.dataset.focusKey === focused)?.focus({ preventScroll: true });
  const more = $(`${kind}-more`);
  more.hidden = entries.length <= renderedCount && groups.length <= shownGroups.length;
  more.textContent = `Show next ${PAGE_SIZE}`;
  $(`${kind}-summary`).textContent = `${renderedCount}${renderedCount < entries.length ? ` of ${entries.length}` : ""} ${assetLabel(kind, entries.length)} shown${entries.length !== search.results.length ? ` · ${search.results.length - entries.length} small balances hidden` : ""} · ${search.checked.length} wallet${search.checked.length === 1 ? "" : "s"} checked${search.updatedAt ? ` · ${search.updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}`;
  $(kind === "tokens" ? "downloadTokensBtn" : "downloadNftsBtn").disabled = !search.checked.length && !search.results.length;
  if (kind === "tokens") {
    const known = entries.reduce((sum, entry) => sum + (entry.usdcValue || 0), 0);
    const unpriced = entries.filter(entry => entry.usdcValue == null).length;
    $("tokens-value").textContent = `Priced assets: ${formatValue(known)}${unpriced ? ` · ${unpriced} without ${unpriced === 1 ? "a price" : "prices"}` : ""}`;
    $("tokens-value").title = "Estimated Jupiter swap quotes in USDC. Only priced, visible assets contribute to this total.";
  }
}

function escapeCSV(value) {
  let text = String(value ?? "");
  // Quoting alone does not stop spreadsheets from evaluating untrusted metadata as formulas.
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}
function createCSV(kind) {
  const search = searches[kind];
  const entries = kind === "tokens" ? visibleTokens(search.results) : search.results;
  const base = kind === "tokens" ? ["Wallet Address", "Symbol", "Token Name", "Token Address", "Balance", "USDC Value"] : ["Wallet Address", "Collection Address", "Collection Name", "NFT Name", "NFT Address", "Verified Collection"];
  const header = [...base, "Status", "Details", "Retrieved At (UTC)"];
  const status = address => search.failures.has(address) ? "FAILED" : search.warnings.has(address) ? "PARTIAL" : "COMPLETE";
  const details = address => [search.failures.get(address), search.warnings.get(address)].filter(Boolean).join(" ");
  const rows = entries.map(entry => {
    const columns = kind === "tokens"
      ? [entry.walletAddress, entry.symbol, entry.tokenName, entry.tokenAddress, formatTokenBalance(entry.balance, entry.decimals).replace(/,/g, ""), entry.usdcValue == null ? "" : entry.usdcValue.toFixed(6)]
      : [entry.walletAddress, entry.collectionAddress, entry.collectionName, entry.nftName, entry.nftAddress, entry.collectionAddress ? String(entry.collectionVerified) : ""];
    return [...columns, search.failures.has(entry.walletAddress) ? "PARTIAL" : status(entry.walletAddress), details(entry.walletAddress), entry.retrievedAt || ""];
  });
  const represented = new Set(entries.map(entry => entry.walletAddress));
  for (const address of search.wallets.length ? search.wallets : search.checked) {
    if (represented.has(address)) continue;
    const checked = search.checked.includes(address);
    const rowStatus = !checked ? "NOT_CHECKED" : search.failures.has(address) ? "FAILED" : search.warnings.has(address) ? "PARTIAL" : search.results.some(entry => entry.walletAddress === address) ? "FILTERED" : "EMPTY";
    rows.push([address, ...Array(base.length - 1).fill(""), rowStatus, details(address), ""]);
  }
  return [header, ...rows].map(row => row.map(escapeCSV).join(",")).join("\r\n") + "\r\n";
}
function downloadCSV(kind) {
  const url = URL.createObjectURL(new Blob([createCSV(kind)], { type: "text/csv;charset=utf-8;" }));
  const link = node("a"); link.href = url; link.download = `solana_${kind}_results.csv`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("CSV exported with the current filters");
}
function toast(text) {
  clearTimeout(toastTimer); $("toast").textContent = text; $("toast").hidden = false;
  toastTimer = setTimeout(() => { $("toast").hidden = true; }, 3500);
}
async function copyToClipboard(text, success) {
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); toast(success); return; } } catch { /* Try the local fallback after a permission denial. */ }
  const previous = document.activeElement;
  const field = node("textarea", "sr-only");
  field.value = text; document.body.append(field);
  try {
    field.select();
    if (!document.execCommand("copy")) throw new Error("Clipboard unavailable");
    toast(success);
  } catch { toast(`Could not copy. Full address: ${text}`); }
  finally { field.remove(); previous?.focus({ preventScroll: true }); }
}

document.addEventListener("DOMContentLoaded", () => {
  loadSettings();
  loadRememberedWallets();
  window.addEventListener("storage", syncRememberedWallets);
  $("rememberWallets").addEventListener("change", changeRememberWallets);
  $("walletAddresses").addEventListener("input", () => inputError());
  setupWalletImport();
  for (const [toggle, group] of [["showAllTokens", "specificTokensGroup"], ["showAllNFTs", "specificNFTsGroup"]]) $(toggle).addEventListener("change", () => { $(group).hidden = $(toggle).checked; });
  $("displaySmallBalances").addEventListener("change", () => renderResults("tokens"));
  $("groupByWalletTokens").addEventListener("change", () => renderResults("tokens"));
  $("groupByWalletNFTs").addEventListener("change", () => renderResults("nfts"));
  $("includeNFTs").addEventListener("change", () => { $("nft-options").hidden = !$("includeNFTs").checked; });
  $("searchBtn").addEventListener("click", () => runSearch());
  $("retrySearchBtn").addEventListener("click", () => runSearch(true));
  $("cancelSearchBtn").addEventListener("click", () => activeSearch?.controller.abort());
  $("downloadTokensBtn").addEventListener("click", () => downloadCSV("tokens"));
  $("downloadNftsBtn").addEventListener("click", () => downloadCSV("nfts"));
  $("settingsBtn").addEventListener("click", () => openSettings());
  $("settings-form").addEventListener("submit", saveSettings);
  for (const id of ["closeSettingsBtn", "cancelSettingsBtn"]) $(id).addEventListener("click", () => $("settings-modal").close());
  $("settings-modal").addEventListener("close", () => {
    settingsController?.abort();
    pendingSearch = false;
    if (!settingsReturnFocus?.disabled) settingsReturnFocus?.focus();
  });
  for (const kind of ["tokens", "nfts"]) $(`${kind}-more`).addEventListener("click", () => { searches[kind].limit += PAGE_SIZE; renderResults(kind); });
  $("rpcUrl").addEventListener("input", () => { $("rpc-error").hidden = true; $("rpcUrl").removeAttribute("aria-invalid"); });
});

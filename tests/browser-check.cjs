const {spawn}=require('node:child_process');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
const {fixtures,keys}=require('./fixtures.cjs');
const root=path.resolve(__dirname,'..');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'wallet-browser-profile-'));
const artifacts=fs.mkdtempSync(path.join(os.tmpdir(),'wallet-browser-artifacts-'));
const executable=process.env.BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const scenario={offline:false,wrongNetwork:false,failWallet:true,failMetadata:false,hang:false,rateLimit:0};
const calls=[];const errors=[];const remote=[];
let fixture,chrome,ws,sessionId,serial=0,server;
const pending=new Map();
function send(method,params={},session=sessionId){
 const id=++serial;
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP command timed out: '+method));},15000);
  pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});
  ws.send(JSON.stringify({id,method,params,...(session?{sessionId:session}:{})}));
 });
}
async function evaluate(expression){
 const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});
 if(result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
 return result.result.value;
}
async function until(expression){
 const deadline=Date.now()+30000;
 while(Date.now()<deadline){
  try{if(await evaluate(expression)) return;}catch(error){if(!/context|navigat/i.test(error.message))throw error;}
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 throw Error('Timed out: '+expression+'; state='+await evaluate('JSON.stringify({message:document.getElementById("search-message")?.textContent,active:Boolean(globalThis.activeSearch)})'));
}
async function axe(label){
 await evaluate(fs.readFileSync(require.resolve('axe-core/axe.min.js'),'utf8'));
 const violations=await evaluate('(async()=>{const result=await axe.run(document,{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa","best-practice"]}});return result.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}));})()');
 assert.deepEqual(violations,[],label+' accessibility violations');
}
function json(res,data,status=200){res.writeHead(status,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});res.end(JSON.stringify(data));}
async function handle(req,res){
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/rpc'){
  let raw='';for await(const chunk of req)raw+=chunk;
  const request=JSON.parse(raw);calls.push(request);
  if(scenario.hang && request.method==='getBalance'){scenario.hangStarted=true;res.on('close',()=>{scenario.transportAborted=true;});return;}
  if(scenario.offline){res.destroy();return;}
  if(scenario.rateLimit>0 && request.method==='getTokenAccountsByOwner'){scenario.rateLimit--;json(res,{error:'limited'},429);return;}
  const {id,method,params=[]}=request;let result;
  const fail=()=>json(res,{jsonrpc:'2.0',id,error:{code:-32000,message:'Provider failed https://secret.invalid/?key=NEVER_SHOW_THIS'}});
  if(method==='getSlot')result=42;
  else if(method==='getGenesisHash')result=scenario.wrongNetwork?'wrong-chain':'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
  else if(method==='getBalance'){
   if(scenario.failWallet && params[0]===keys.failedWallet)return fail();
   result={value:1000000000};
  }else if(method==='getTokenAccountsByOwner'){
   if(scenario.failWallet && params[0]===keys.failedWallet)return fail();
   const holdings=params[1].programId?.startsWith('Tokenz')?[[keys.whole,'1234',0]]:[[keys.usdc,'1234560000',6],[keys.unknown,'5000000',6],[keys.dust,'1000000',6],[keys.nft,'1',0]];
   const selected=params[1].mint?holdings.filter(([mint])=>mint===params[1].mint):holdings;
   result={value:selected.map(([mint,amount,decimals])=>({account:{data:{parsed:{info:{mint,tokenAmount:{amount,decimals}}}}}}))};
  }else if(method==='getMultipleAccounts'){
   if(scenario.failMetadata)return fail();
   result={value:params[0].map(key=>fixture.accounts.get(key)||null)};
  }else if(method==='getAccountInfo'){
   const mint=fixture.mints.get(params[0]);
   if(params[1].encoding==='jsonParsed')result={value:mint?{data:{parsed:{info:mint}}}:null};
   else {if(scenario.failMetadata)return fail();result={value:fixture.accounts.get(params[0]) || null};}
  }else throw Error('Unexpected RPC method: '+method);
  json(res,{jsonrpc:'2.0',id,result});return;
 }
 const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':decodeURIComponent(pathname)));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 try{const body=fs.readFileSync(file);res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.ico')?'image/x-icon':'text/html');res.setHeader('Cache-Control','no-store');res.end(body);}
 catch{res.writeHead(404).end();}
}
(async()=>{
 fixture=await fixtures();
 server=http.createServer((req,res)=>handle(req,res).catch(error=>{errors.push(error.message);res.destroy();}));
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const origin=`http://127.0.0.1:${server.address().port}`;
 chrome=spawn(executable,['--headless','--no-sandbox','--disable-gpu','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe']});
 const endpoint=await new Promise((resolve,reject)=>{let stderr='';chrome.stderr.on('data',chunk=>{stderr+=chunk;const match=stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match)resolve(match[1]);});chrome.once('error',reject);chrome.once('exit',code=>reject(Error('Browser exited '+code+' '+stderr)));});
 ws=new WebSocket(endpoint);await new Promise(resolve=>ws.addEventListener('open',resolve));
 ws.addEventListener('message',async event=>{
  const message=JSON.parse(event.data);
  if(message.id){const entry=pending.get(message.id);pending.delete(message.id);message.error?entry?.reject(Error(message.error.message)):entry?.resolve(message.result);return;}
  if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  if(message.method==='Network.requestWillBeSent'){
   const url=message.params.request.url;if(url.startsWith('https:'))remote.push(url);
  }
  if(message.method==='Fetch.requestPaused'){
   const {requestId,request}=message.params;
   const url=new URL(request.url),inputMint=url.searchParams.get('inputMint'),amount=url.searchParams.get('amount');
   const available=inputMint!==keys.unknown;
   const body=available?{inputMint,outputMint:keys.usdc,inAmount:amount,outAmount:inputMint===keys.dust?'1000':'100000000'}:{error:'No route'};
   await send('Fetch.fulfillRequest',{requestId,responseCode:available?200:404,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:'*'}],body:Buffer.from(JSON.stringify(body)).toString('base64')});
  }
 });
 const {targetId}=await send('Target.createTarget',{url:'about:blank'},null);
 ({sessionId}=await send('Target.attachToTarget',{targetId,flatten:true},null));
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('Emulation.setFocusEmulationEnabled',{enabled:true});
 await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});
 await send('Fetch.enable',{patterns:[{urlPattern:'*lite-api.jup.ag*'}]});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.testKeys=${JSON.stringify(keys)}`});
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:origin});
 await until('document.readyState === "complete" && typeof runSearch === "function"');
 assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
 await axe('empty');
 // Appearance follows the device until explicitly selected, and survives reloads.
 const appearance=async value=>evaluate(`document.querySelector('input[name="appearance"][value="${value}"]').click()`);
 const deviceTheme=async value=>send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value}]});
 assert.equal(await evaluate('document.querySelector("input[name=appearance]:checked").value'),'system');
 assert.equal(await evaluate('document.documentElement.dataset.theme'),'dark');
 await appearance('light');
 assert.equal(await evaluate('getComputedStyle(document.documentElement).colorScheme'),'light');
 await axe('light empty');
 await evaluate('window.__reloadProbe=true');await send('Page.reload',{ignoreCache:true});
 await until('!window.__reloadProbe && document.readyState==="complete" && typeof runSearch==="function"');
 assert.equal(await evaluate('document.querySelector("input[name=appearance]:checked").value'),'light');
 assert.equal(await evaluate('document.documentElement.dataset.theme'),'light');
 await deviceTheme('light');await deviceTheme('dark');
 assert.equal(await evaluate('document.documentElement.dataset.theme'),'light','explicit appearance ignores device changes');
 await appearance('system');await until('document.documentElement.dataset.theme==="dark"');
 await deviceTheme('light');await until('document.documentElement.dataset.theme==="light"');
 await deviceTheme('dark');await until('document.documentElement.dataset.theme==="dark"');
 // Native radio arrow navigation and storage-denied fallback both remain usable.
 await evaluate('document.querySelector("input[name=appearance]:checked").focus()');
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowLeft',code:'ArrowLeft',windowsVirtualKeyCode:37});
 await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowLeft',code:'ArrowLeft',windowsVirtualKeyCode:37});
 assert.equal(await evaluate('document.querySelector("input[name=appearance]:checked").value'),'dark');
 await evaluate('window.__setItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new Error("Storage denied")};document.querySelector("input[name=appearance][value=light]").click()');
 assert.equal(await evaluate('document.documentElement.dataset.theme'),'light');
 await evaluate('Storage.prototype.setItem=window.__setItem;delete window.__setItem');
 await appearance('system');
 console.log('Appearance checks passed: light/dark/system, device changes, persistence, keyboard selection, storage-denied fallback');
 // Import into the editable list, then undo only the newly added addresses.
 await evaluate(`$("walletAddresses").value = "wallet-a";
   const files = new DataTransfer();
   files.items.add(new File(["Wallet Address\\nwallet-a\\nwallet-b\\nwallet-b"], "wallets.csv", {type:"text/csv"}));
   $("walletFile").files = files.files;
   $("walletFile").dispatchEvent(new Event("change"));`);
 await until('!importing && !$("import-feedback").hidden');
 assert.equal(await evaluate('$("walletAddresses").value'),'wallet-a\nwallet-b');
 assert.match(await evaluate('$("import-status").textContent'),/1 wallet added/);
 assert.equal(await evaluate('$("walletFile").value'),'');
 await evaluate('$("walletAddresses").value += "\\nwallet-c"; $("undoImportBtn").click()');
 assert.equal(await evaluate('$("walletAddresses").value'),'wallet-a\nwallet-c');
 // A dropped file follows the same flow, and invalid files do not erase the list.
 await evaluate(`const dropped = new DataTransfer();
   dropped.items.add(new File(["wallet-a\\nwallet-d"], "dropped.txt", {type:"text/plain"}));
   $("wallet-drop-zone").dispatchEvent(new DragEvent("dragenter", {dataTransfer:dropped, bubbles:true, cancelable:true}));
   $("wallet-drop-zone").dispatchEvent(new DragEvent("drop", {dataTransfer:dropped, bubbles:true, cancelable:true}));`);
 await until('!importing');
 assert.equal(await evaluate('$("walletAddresses").value'),'wallet-a\nwallet-c\nwallet-d');
 assert.equal(await evaluate('$("wallet-drop-zone").classList.contains("drag-over")'),false);
 await evaluate('importWalletFile(new File(["bad"], "unsupported.json"))');
 assert.match(await evaluate('$("wallet-input-error").textContent'),/TXT or CSV/);
 assert.equal(await evaluate('$("walletAddresses").value'),'wallet-a\nwallet-c\nwallet-d');
 await evaluate('$("undoImportBtn").click()');
 assert.equal(await evaluate('$("walletAddresses").value'),'wallet-a\nwallet-c');
 await evaluate('importWalletFile(new File(["wallet-a"], "duplicate.txt"))');
 assert.match(await evaluate('$("import-status").textContent'),/already in your list/);
 assert.equal(await evaluate('$("undoImportBtn").hidden'),true);
 // Reading an older file must not replace a newer import or lose concurrent edits.
 await evaluate(`(async () => { window.oldImport = importWalletFile({name:"old.txt",text:()=>new Promise(resolve=>window.finishOldImport=resolve)});
   $("walletAddresses").value += "\\nwallet-e";
   await importWalletFile(new File(["wallet-f"], "new.txt"));
   window.finishOldImport("wallet-z"); await window.oldImport; })()`);
 assert.equal(await evaluate('$("walletAddresses").value'),'wallet-a\nwallet-c\nwallet-e\nwallet-f');
 await evaluate('$("walletAddresses").value=""; $("walletAddresses").dispatchEvent(new Event("input")); $("import-feedback").hidden=true');
 console.log('Import checks passed: file selection, merge/dedup, editable list, undo, drag/drop, invalid files, duplicates, concurrent reads');
 await evaluate('$("settingsBtn").click()');
 assert.equal(await evaluate('document.activeElement.id'),'rpcUrl');
 await axe('connection dialog');
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:53});
 await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:53});
 await until('!$("settings-modal").open && document.activeElement.id === "settingsBtn"');
 await evaluate(`$("settingsBtn").click();$("rpcUrl").value=${JSON.stringify(origin+'/rpc')};$("settings-form").requestSubmit()`);
 await until('!$("settings-modal").open && !$("saveSettingsBtn").disabled');
 assert.match(await evaluate('$("connection-status").textContent'),/Connected/);
 const setWallets=async addresses=>evaluate(`$("walletAddresses").value=${JSON.stringify(addresses.join('\n'))};$("walletAddresses").dispatchEvent(new Event("input"))`);
 const search=async()=>{await evaluate('$("searchBtn").click()');await until('!activeSearch && searches.tokens.hasSearched');};
 await setWallets([keys.wallet]);await search();
 assert.equal(await evaluate('localStorage.getItem(WALLETS_KEY)'),null);
 await evaluate('$("walletAddresses").value="unsearched-edit";$("rememberWallets").click()');
 assert.deepEqual(await evaluate('JSON.parse(localStorage.getItem(WALLETS_KEY)).wallets'),[keys.wallet]);
 await setWallets([keys.wallet,keys.failedWallet,keys.wallet]);await search();
 assert.equal(await evaluate('JSON.parse(localStorage.getItem(WALLETS_KEY)).wallets.length'),2);
 await evaluate('$("walletAddresses").value="unsent edit";window.__reloadProbe=true');
 await send('Page.reload',{ignoreCache:true});await until('!window.__reloadProbe && document.readyState==="complete" && typeof runSearch==="function"');
 assert.equal(await evaluate('$("rememberWallets").checked'),true);
 assert.equal(await evaluate('$("walletAddresses").value'),[keys.wallet,keys.failedWallet].join('\n'));
 assert.equal(await evaluate('searches.tokens.hasSearched'),false);
 await evaluate('$("rememberWallets").click()');assert.equal(await evaluate('localStorage.getItem(WALLETS_KEY)'),null);
 await evaluate('window.__reloadProbe=true');await send('Page.reload',{ignoreCache:true});await until('!window.__reloadProbe && document.readyState==="complete" && typeof runSearch==="function"');
 assert.equal(await evaluate('$("walletAddresses").value'),'');
 console.log('Opt-in storage/reload checks passed');
 assert.equal(await evaluate('$("includeNFTs").checked'),false);
 await setWallets([keys.wallet,keys.failedWallet]);await search();
 assert.match(await evaluate('$("search-message").textContent'),/1 failed/);
 assert.equal(await evaluate('visibleTokens(searches.tokens.results).length'),4);
 assert.equal(await evaluate('searches.tokens.results.some(t=>t.decimals===0)'),true);
 assert.equal(await evaluate('$("nfts-result").hidden'),true);
 assert.match(await evaluate('$("tokens-result-container").textContent'),/Price unavailable/);
 const requestCount=calls.length;
 await evaluate('$("displaySmallBalances").click();$("groupByWalletTokens").click()');
 assert.equal(await evaluate('visibleTokens(searches.tokens.results).length'),5);assert.equal(calls.length,requestCount);
 await evaluate('$("includeNFTs").focus()');
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32,nativeVirtualKeyCode:49});
 await send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32,nativeVirtualKeyCode:49});
 assert.equal(await evaluate('$("includeNFTs").checked'),true);
 const beforeCombined=calls.filter(call=>call.method==='getTokenAccountsByOwner').length;
 await search();
 assert.equal(calls.filter(call=>call.method==='getTokenAccountsByOwner').length-beforeCombined,4,'reuse account queries for the NFT lookup');
 assert.equal(await evaluate('searches.nfts.results.length'),1);
 assert.equal(await evaluate('!$("tokens-result").hidden && !$("nfts-result").hidden'),true);
 await axe('populated with provider error');
 await appearance('light');await axe('light populated with provider error');
 fs.writeFileSync(path.join(artifacts,'desktop-light.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
 await appearance('system');
 // Retry only the incomplete wallet and preserve successful data and scope.
 scenario.failWallet=false;const beforeRetry=calls.filter(call=>call.method==='getBalance').length;
 await evaluate('$("retrySearchBtn").click()');await until('!activeSearch && $("retrySearchBtn").hidden');
 assert.equal(calls.filter(call=>call.method==='getBalance').length-beforeRetry,1);
 assert.equal(await evaluate('searches.tokens.results.length'),10);
 assert.equal(await evaluate('searches.nfts.results.length'),2);
 // Wrong-network preflight must retain results and the reconnect action.
 scenario.wrongNetwork=true;await evaluate('$("searchBtn").click()');await until('!activeSearch');
 assert.equal(await evaluate('searches.tokens.results.length'),10);
 assert.match(await evaluate('$("search-message").textContent'),/Previous results are kept/);
 assert.equal(await evaluate('$("settingsBtn").disabled'),false);
 await axe('connection error');scenario.wrongNetwork=false;
 // Verified collection filters are applied by the real on-chain decoder.
 await setWallets([keys.wallet]);
 await evaluate(`$("showAllNFTs").click();$("nftCollectionAddresses").value=${JSON.stringify(keys.collection)}`);await search();
 assert.equal(await evaluate('searches.nfts.results.length'),1);
 for(const width of [390,320]){await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:true});assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);}
 await axe('mobile');
 fs.writeFileSync(path.join(artifacts,'mobile.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
 await appearance('light');await axe('light mobile');
 assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
 fs.writeFileSync(path.join(artifacts,'mobile-light.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
 await appearance('system');
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
 fs.writeFileSync(path.join(artifacts,'desktop.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
 // Pagination bounds the DOM; export still includes every record.
 await evaluate(`searches.tokens.results=Array.from({length:250},(_,i)=>({walletAddress:testKeys.wallet,tokenAddress:testKeys.unknown,symbol:'EX',tokenName:'Large portfolio '+i,balance:'1',decimals:0,usdcValue:1}));searches.tokens.limit=100;renderResults('tokens')`);
 assert.equal(await evaluate('$("tokens-result-container").querySelectorAll("tbody tr").length'),100);
 await evaluate('$("tokens-more").click()');assert.equal(await evaluate('$("tokens-result-container").querySelectorAll("tbody tr").length'),200);
 assert.equal(await evaluate('parseCSV(createCSV("tokens")).length'),251);
 // Real fetch cancellation closes the pending request and keeps prior holdings.
 scenario.hang=true;await evaluate('$("searchBtn").click()');await until('activeSearch && $("search-progress-text").textContent.startsWith("Checking tokens")');
 const waitFor=async predicate=>{const deadline=Date.now()+5000;while(!predicate()){if(Date.now()>deadline)throw Error('Transport condition timed out');await new Promise(resolve=>setTimeout(resolve,20));}};
 await waitFor(()=>scenario.hangStarted);
 await evaluate('$("cancelSearchBtn").focus();$("cancelSearchBtn").click()');await until('!activeSearch');
 assert.match(await evaluate('$("search-message").textContent'),/cancelled/);
 assert.equal(await evaluate('searches.tokens.results.length'),0);
 await waitFor(()=>scenario.transportAborted);
 assert.equal(await evaluate('document.activeElement.id'),'searchBtn');
 scenario.hang=false;await search();
 await evaluate('Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async text=>window.__copied=text}});$("tokens-result-container").querySelector(".address-copy").click()');await until('Boolean(window.__copied)');
 assert.match(await evaluate('$("toast").textContent'),/copied/);
 assert.equal(remote.every(url=>url.startsWith('https://lite-api.jup.ag/')),true,'no runtime CDNs or off-chain metadata requests');
 if(process.env.LIVE_BROWSER_CHECK==='1'){
  await send('Fetch.disable');
  await evaluate(`window.liveRpcUrl=${JSON.stringify(process.env.LIVE_RPC_URL || 'https://api.mainnet-beta.solana.com')}`);
  const live=await evaluate(`(async()=>{
   const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),40000);
   try{
    const probe=await fetch(window.liveRpcUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getGenesisHash',params:[]}),signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'});
    if(!probe.ok)throw Error('Live browser RPC rejected the request: HTTP '+probe.status);
    await probe.arrayBuffer();
    const connection=new solanaWeb3.Connection(window.liveRpcUrl,{signal:controller.signal});
    const genesis=await connection.getGenesisHash();
    const metadata=await TokenService.getTokenMetadata(connection,testKeys.usdc,controller.signal);
    const quote=await Network.json('https://lite-api.jup.ag/swap/v1/quote?inputMint='+testKeys.sol+'&outputMint='+testKeys.usdc+'&amount=1000000000&slippageBps=50',{}, {signal:controller.signal});
    return {genesis,symbol:metadata.symbol,available:!metadata.metadataUnavailable,quoteMint:quote.outputMint,amount:quote.inAmount};
   }finally{clearTimeout(timer);controller.abort();}
  })()`);
  assert.equal(live.genesis,'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d');assert.equal(live.symbol,'USDC');assert.equal(live.available,true);assert.equal(live.quoteMint,keys.usdc);assert.equal(live.amount,'1000000000');
  console.log('Live browser CORS, mainnet, metadata, and Jupiter checks passed.');
 }
 assert.equal(await evaluate('document.body.textContent.includes("NEVER_SHOW_THIS")'),false);
 assert.deepEqual(errors,[]);
 console.log('Browser checks passed: real address/metadata/RPC stack, storage, imports, keyboard controls, retry, data preservation, pagination/export, cancellation, 320/390px layout, and axe accessibility (empty, populated, error, mobile).');
 console.log('Screenshots: '+artifacts);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{
 ws?.close();chrome?.kill();server?.closeAllConnections();server?.close();
 if(chrome)chrome.once('exit',()=>fs.rmSync(profile,{recursive:true,force:true}));
});

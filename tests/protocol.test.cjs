const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {fixtures,keys}=require('./fixtures.cjs');
function runtime(){
 const context=vm.createContext({window:{},isSecureContext:true,console,TextEncoder,TextDecoder,crypto:require('node:crypto').webcrypto,Uint8Array,DataView,URL,atob,AbortController,DOMException,setTimeout,clearTimeout});
 vm.runInContext(fs.readFileSync(`${__dirname}/../assets/vendor.js`,'utf8'),context);
 context.solanaWeb3=context.window.solanaWeb3;
 vm.runInContext(fs.readFileSync(`${__dirname}/../javascript/token.js`,'utf8'),context);
 return {context,run:code=>vm.runInContext(code,context)};
}
test('shipped address validator rejects regex-shaped but invalid public keys',()=>{
 const {context,run}=runtime();
 context.key=keys.wallet;
 assert.equal(run('new solanaWeb3.PublicKey(key).toString()'),keys.wallet);
 assert.throws(()=>run('new solanaWeb3.PublicKey("BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB")'));
});
test('shipped metadata decoder identifies fungible zero-decimal tokens and verified NFTs',async()=>{
 const data=await fixtures();const {context,run}=runtime();
 context.connection={rpcEndpoint:'test',getParsedAccountInfo:async key=>({value:{data:{parsed:{info:data.mints.get(String(key))}}}}),getAccountInfo:async key=>{
  const account=data.accounts.get(String(key));return account?{...account,data:new Uint8Array(Buffer.from(account.data[0],'base64'))}:null;
 }};
 context.mint=keys.whole;
 const token=await run('TokenService.getTokenMetadata(connection,mint,new AbortController().signal)');
 assert.equal(token.isNft,false);assert.equal(token.name,'Whole-unit fungible token');
 context.mint=keys.nft;
 const nft=await run('TokenService.getTokenMetadata(connection,mint,new AbortController().signal)');
 assert.equal(nft.isNft,true);assert.equal(nft.collection.address,keys.collection);assert.equal(nft.collection.verified,true);
});
test('metadata failures are retryable and never fetch arbitrary metadata URIs',async()=>{
 const {context,run}=runtime();let calls=0;
 context.connection={rpcEndpoint:'test',getParsedAccountInfo:async()=>{calls++;throw Error('unavailable');}};
 context.fetch=()=>{throw Error('Off-chain metadata must not be fetched');};context.mint=keys.whole;
 await run('TokenService.getTokenMetadata(connection,mint,new AbortController().signal)');
 await run('TokenService.getTokenMetadata(connection,mint,new AbortController().signal)');
 assert.equal(calls,2);
});
test('read-only RPC adapter validates envelopes and sends only expected methods',async()=>{
 const {context,run}=runtime();let requested;
 context.Network={RequestError:class extends Error{},json:async(url,init)=>{requested=JSON.parse(init.body);return{jsonrpc:'2.0',id:requested.id,result:{value:123}};}};
 vm.runInContext(fs.readFileSync(`${__dirname}/../javascript/rpc.js`,'utf8'),context);
 context.solanaWeb3=context.window.solanaWeb3;context.owner=keys.wallet;
 assert.equal(await run('new solanaWeb3.Connection("https://example.com").getBalance(new solanaWeb3.PublicKey(owner))'),123);
 assert.equal(requested.method,'getBalance');assert.equal(requested.params[0],keys.wallet);
 context.Network.json=async()=>({jsonrpc:'2.0',id:999,result:1});
 await assert.rejects(run('new solanaWeb3.Connection("https://example.com").getSlot()'));
});

test('metadata batches decode real mint bytes and avoid individual follow-up reads',async()=>{
 const data=await fixtures();const {context,run}=runtime();let batchCalls=0;
 context.connection={rpcEndpoint:'batch',getMultipleAccountsInfo:async keys=>{batchCalls++;return keys.map(key=>{const account=data.accounts.get(String(key));return account?{...account,data:new Uint8Array(Buffer.from(account.data[0],'base64'))}:null;});},getParsedAccountInfo:async()=>{throw Error('Individual lookup must not run');}};
 context.mints=[keys.whole,keys.nft];
 await run('TokenService.prefetch(connection,mints,new AbortController().signal)');
 context.mint=keys.whole;
 const token=await run('TokenService.getTokenMetadata(connection,mint,new AbortController().signal)');
 context.mint=keys.nft;
 const nft=await run('TokenService.getTokenMetadata(connection,mint,new AbortController().signal)');
 assert.equal(batchCalls,1);assert.equal(token.name,'Whole-unit fungible token');assert.equal(token.isNft,false);assert.equal(nft.isNft,true);
});

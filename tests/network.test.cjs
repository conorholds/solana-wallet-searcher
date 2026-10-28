const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function network(fetch) {
  const context = vm.createContext({fetch,Response,Headers,Uint8Array,AbortController,DOMException,setTimeout,clearTimeout});
  vm.runInContext(fs.readFileSync(`${__dirname}/../javascript/network.js`,'utf8'),context);
  return {context,run:code=>vm.runInContext(code,context)};
}
test('HTTP retries are bounded, honor cancellation and omit credentials/referrers', async()=>{
 let count=0;
 const {run}=network(async (url,init)=>{
  count++; assert.equal(init.credentials,'omit'); assert.equal(init.referrerPolicy,'no-referrer');
  return count<3 ? new Response('limited',{status:429}) : Response.json({ok:true});
 });
 assert.equal(await run('Network.json("https://example.com",{}, {retries:2,retryDelay:1}).then(x=>x.ok)'),true);
 assert.equal(count,3);
});
test('a stalled network request times out and aborts its transport',async()=>{
 let aborted=false;
 const {run}=network((url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('Aborted','AbortError'));})));
 await assert.rejects(run('Network.request("https://example.com",{}, {timeout:10,retries:0})'),{code:'TIMEOUT'});
 assert.equal(aborted,true);
});
test('cancel aborts an actual pending fetch and does not retry',async()=>{
 let calls=0;
 const {run}=network((url,{signal})=>{calls++;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))));});
 const waiting=run('globalThis.controller=new AbortController(); Network.request("https://example.com",{}, {signal:controller.signal,retries:2})');
 run('controller.abort()');
 await assert.rejects(waiting,{name:'AbortError'});assert.equal(calls,1);
});
test('deadlines also bound a stalled response body',async()=>{
 const {run}=network(async(url,{signal})=>new Response(new ReadableStream({start(controller){signal.addEventListener('abort',()=>controller.error(new DOMException('Aborted','AbortError')));}})));
 await assert.rejects(run('Network.json("https://example.com",{}, {timeout:10,retries:0})'),{code:'TIMEOUT'});
});
test('provider error messages never contain endpoint credentials',async()=>{
 const {run}=network(async()=>{throw new TypeError('Failed https://secret.example/?api-key=TOP_SECRET');});
 await assert.rejects(run('Network.request("https://secret.example",{}, {retries:0})'),error=>!error.message.includes('TOP_SECRET')&&error.code==='NETWORK');
});
test('invalid JSON and oversized responses are rejected explicitly',async()=>{
 let {run}=network(async()=>new Response('bad JSON'));
 await assert.rejects(run('Network.json("https://example.com")'),{code:'INVALID_RESPONSE'});
 ({run}=network(async()=>new Response('x',{headers:{'content-length':String(21*1024*1024)}})));
 await assert.rejects(run('Network.request("https://example.com")'),{code:'TOO_LARGE'});
});

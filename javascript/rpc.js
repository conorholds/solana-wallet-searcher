/* Only the read methods this application uses; no signing or transaction API. */
(() => {
  class Connection {
    constructor(url, options = {}) {
      this.rpcEndpoint = url;
      this.signal = options.signal;
      this.requestId = 0;
    }
    async request(method, params = []) {
      const id = ++this.requestId;
      const data = await Network.json(this.rpcEndpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      }, { signal: this.signal });
      if (!data || data.id !== id || data.jsonrpc !== '2.0') throw new Network.RequestError('INVALID_RESPONSE', 'The RPC provider returned an invalid response.');
      if (data.error) throw new Network.RequestError('RPC', data.error.code === -32601 ? 'This RPC provider does not support the required query.' : 'The RPC provider rejected this query. Check its limits and access settings.');
      if (!Object.hasOwn(data, 'result')) throw new Network.RequestError('INVALID_RESPONSE', 'The RPC provider returned no result.');
      return data.result;
    }
    getSlot() { return this.request('getSlot', [{ commitment: 'confirmed' }]); }
    getGenesisHash() { return this.request('getGenesisHash'); }
    async getBalance(owner) {
      const result = await this.request('getBalance', [String(owner), { commitment: 'confirmed' }]);
      if (!Number.isSafeInteger(result?.value) || result.value < 0) throw new Network.RequestError('INVALID_RESPONSE', 'The provider returned an invalid SOL balance.');
      return result.value;
    }
    async getParsedTokenAccountsByOwner(owner, filter) {
      const query = Object.fromEntries(Object.entries(filter).map(([key, value]) => [key, String(value)]));
      const result = await this.request('getTokenAccountsByOwner', [String(owner), query, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
      if (!Array.isArray(result?.value)) throw new Network.RequestError('INVALID_RESPONSE', 'The provider returned invalid token accounts.');
      return result;
    }
    getParsedAccountInfo(key) {
      return this.request('getAccountInfo', [String(key), { encoding: 'jsonParsed', commitment: 'confirmed' }]);
    }
    decodeAccount(account) {
      if (account == null) return null;
      if (!Array.isArray(account.data) || account.data[1] !== 'base64') throw new Network.RequestError('INVALID_RESPONSE', 'The provider returned invalid account data.');
      return { ...account, data: Uint8Array.from(atob(account.data[0]), character => character.charCodeAt(0)) };
    }
    async getAccountInfo(key) {
      const result = await this.request('getAccountInfo', [String(key), { encoding: 'base64', commitment: 'confirmed' }]);
      return this.decodeAccount(result?.value);
    }
    async getMultipleAccountsInfo(keys) {
      const result = await this.request('getMultipleAccounts', [keys.map(String), { encoding: 'base64', commitment: 'confirmed' }]);
      if (!Array.isArray(result?.value) || result.value.length !== keys.length) throw new Network.RequestError('INVALID_RESPONSE', 'The provider returned an incomplete account batch.');
      return result.value.map(account => this.decodeAccount(account));
    }

  }
  if (window.solanaWeb3) window.solanaWeb3.Connection = Connection;
})();

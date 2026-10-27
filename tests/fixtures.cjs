const { getAddressDecoder, getAddressEncoder, getProgramDerivedAddress } = require('@solana/addresses');
const { getMetadataAccountDataSerializer } = require('@metaplex-foundation/mpl-token-metadata');
const decode = getAddressDecoder();
const makeAddress = byte => decode.decode(new Uint8Array(32).fill(byte));
const keys = {
  wallet: makeAddress(1), failedWallet: makeAddress(2), unknown: makeAddress(3),
  dust: makeAddress(4), nft: makeAddress(5), collection: makeAddress(6), whole: makeAddress(7),
  usdc: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  sol: 'So11111111111111111111111111111111111111112',
  metadataProgram: 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
};
const none = () => ({ __option: 'None' });
const some = value => ({ __option: 'Some', value });
async function fixtures() {
  const encoder = getAddressEncoder();
  const mints = new Map();
  const accounts = new Map();
  const descriptions = [
    [keys.usdc, 'USD Coin', 'USDC', 6, 2],
    [keys.unknown, 'Example unpriced token', 'EX', 6, 2],
    [keys.dust, 'Small balance token', 'DUST', 6, 2],
    [keys.whole, 'Whole-unit fungible token', 'WHOLE', 0, 2],
    [keys.nft, 'Example NFT', 'NFT', 0, 0],
    [keys.collection, 'Example collection', 'COLL', 0, 0],
  ];
  for (const [mint, name, symbol, decimals, standard] of descriptions) {
    const [metadataAddress] = await getProgramDerivedAddress({programAddress: keys.metadataProgram, seeds:[new TextEncoder().encode('metadata'),encoder.encode(keys.metadataProgram),encoder.encode(mint)]});
    const supply = standard === 0 ? '1' : '1000000000000';
    mints.set(mint, { decimals, supply, metadataAddress });
    const mintBytes = new Uint8Array(82);
    new DataView(mintBytes.buffer).setBigUint64(36, BigInt(supply), true);
    mintBytes[44] = decimals; mintBytes[45] = 1;
    accounts.set(mint, {owner:mint === keys.whole ? 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' : 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',data:[Buffer.from(mintBytes).toString('base64'),'base64'],executable:false,lamports:1,rentEpoch:0});
    const bytes = getMetadataAccountDataSerializer().serialize({
      updateAuthority: keys.wallet, mint, name, symbol, uri: 'https://metadata.invalid/never-fetch-this.json',
      sellerFeeBasisPoints: 0, creators: none(), primarySaleHappened: false, isMutable: true,
      editionNonce: none(), tokenStandard: some(standard),
      collection: mint === keys.nft ? some({ verified:true, key:keys.collection }) : none(),
      uses:none(), collectionDetails:none(), programmableConfig:none(),
    });
    accounts.set(metadataAddress, {owner:keys.metadataProgram,data:[Buffer.from(bytes).toString('base64'),'base64'],executable:false,lamports:1,rentEpoch:0});
  }
  return {keys,mints,accounts};
}
module.exports = {fixtures,keys};

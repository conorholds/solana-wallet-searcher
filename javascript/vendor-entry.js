import { address, getAddressEncoder, getProgramDerivedAddress } from '@solana/addresses';
import { getMetadataAccountDataSerializer } from '@metaplex-foundation/mpl-token-metadata';

class PublicKey {
  constructor(value) { this.value = address(String(value)); }
  toString() { return this.value; }
}
const program = address('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
const encoder = getAddressEncoder();
const unwrap = value => value?.__option === 'Some' ? value.value : null;
window.solanaWeb3 = { PublicKey };
window.assetMetadata = {
  async address(mint) {
    const [key] = await getProgramDerivedAddress({ programAddress: program, seeds: [new TextEncoder().encode('metadata'), encoder.encode(program), encoder.encode(address(String(mint)))] });
    return new PublicKey(key);
  },
  decode(bytes) {
    const [data] = getMetadataAccountDataSerializer().deserialize(bytes);
    const collection = unwrap(data.collection);
    return {
      name: data.name.replace(/\0/g, '').trim(), symbol: data.symbol.replace(/\0/g, '').trim(),
      tokenStandard: unwrap(data.tokenStandard),
      collection: collection ? { address: String(collection.key), verified: collection.verified } : null,
    };
  },
  program,
};

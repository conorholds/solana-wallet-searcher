const NFTService = (() => {
  async function getCollectionName(connection, collection, signal) {
    if (!collection) return 'Uncollected';
    const metadata = await TokenService.getTokenMetadata(connection, collection.address, signal);
    return metadata.metadataUnavailable ? 'Unknown collection' : metadata.name;
  }
  return { getCollectionName };
})();

// javascript/nft.js
// Handles fetching and processing NFT data from Solana

const NFTService = (() => {
  // Collection name cache to avoid duplicate requests
  const collectionNameCache = {};

  // Main function to search for NFTs
  async function searchNFTs() {
    if (window.isProcessing) return;
    window.isProcessing = true;

    window.nftResults = [];
    document.getElementById("nfts-result").style.display = "none";
    document.getElementById("nfts-result-container").innerHTML = "";
    document.getElementById("nft-error-message").style.display = "none";
    document.getElementById("nft-success-message").style.display = "none";

    document.getElementById("nft-loader").style.display = "block";

    try {
      window.walletAddresses = await window.getWalletAddresses();
      if (window.walletAddresses.length === 0) {
        throw new Error("Please enter at least one wallet address");
      }

      // Check if we need to show RPC prompt
      if (!window.settings.promptShown) {
        window.showRPCPrompt();
        window.isProcessing = false;
        document.getElementById("nft-loader").style.display = "none";
        return;
      }

      // Show progress bar
      document.getElementById("nft-progress-container").style.display = "block";
      document.getElementById(
        "nft-progress-text"
      ).textContent = `0/${window.walletAddresses.length}`;
      document.getElementById("nft-progress-bar").style.width = "0%";

      // Get search parameters
      const showAllNFTs = document.getElementById("showAllNFTs").checked;
      let specificCollections = [];

      if (!showAllNFTs) {
        const nftCollectionAddresses = document.getElementById(
          "nftCollectionAddresses"
        ).value;
        specificCollections = nftCollectionAddresses
          .split(/[\r\n]+/)
          .filter((address) => address.trim() !== "");

        if (specificCollections.length === 0) {
          throw new Error(
            "Please enter at least one NFT collection address or select 'Show all NFTs'"
          );
        }
      }

      // Create UMI instance for Metaplex
      const createUmi = window.mplUmiBundleDefaults.createUmi;
      const metaplexUmi = createUmi(window.settings.rpcUrl);

      // Process each wallet
      for (let i = 0; i < window.walletAddresses.length; i++) {
        const walletAddress = window.walletAddresses[i].trim();

        try {
          // Get NFTs for this wallet
          const publicKey = window.mplUmi.publicKey;
          const ownerPublicKey = publicKey(walletAddress);

          // Fetch NFTs
          const fetchNFTs =
            window.mplTokenMetadata.fetchAllDigitalAssetWithTokenByOwner;
          const allNFTs = await fetchNFTs(metaplexUmi, ownerPublicKey);

          // Filter by collection if needed
          let filteredNFTs = allNFTs;
          if (!showAllNFTs && specificCollections.length > 0) {
            filteredNFTs = allNFTs.filter((nft) => {
              const collectionKey = nft.metadata.collection?.key?.toString();
              return (
                collectionKey && specificCollections.includes(collectionKey)
              );
            });
          }

          // Process NFTs
          for (const nft of filteredNFTs) {
            // Get collection name if available
            let collectionName = "Unknown Collection";
            const collectionKey = nft.metadata.collection?.key?.toString();

            if (collectionKey) {
              try {
                // Check cache first
                if (collectionNameCache[collectionKey]) {
                  collectionName = collectionNameCache[collectionKey];
                } else {
                  // Find metadata PDA for the collection
                  const findMetadataPda =
                    window.mplTokenMetadata.findMetadataPda;
                  const metadataPDA = findMetadataPda(metaplexUmi, {
                    mint: publicKey(collectionKey),
                  })[0];

                  // Get metadata account
                  const account = await metaplexUmi.rpc.getAccount(metadataPDA);

                  if (account.exists) {
                    const Metadata = window.mplTokenMetadata.Metadata;
                    const deserializeMetadata =
                      window.mplTokenMetadata.deserializeMetadata;
                    const metadata = deserializeMetadata(
                      Metadata.deserialize(account.data)[0]
                    );

                    collectionName = metadata.name || "Unknown Collection";
                    collectionNameCache[collectionKey] = collectionName;
                  }
                }
              } catch (err) {
                console.warn(
                  `Failed to get collection name for ${collectionKey}:`,
                  err
                );
              }
            }

            // Add to results
            window.nftResults.push({
              walletAddress,
              nftAddress: nft.publicKey.toString(),
              nftName:
                nft.metadata.name || `NFT #${window.nftResults.length + 1}`,
              collectionAddress: collectionKey || null,
              collectionName,
            });
          }
        } catch (err) {
          console.error(`Error processing wallet ${walletAddress}:`, err);
          // Add error result
          window.nftResults.push({
            walletAddress,
            error: err.message,
          });
        }

        // Update progress
        document.getElementById("nft-progress-text").textContent = `${i + 1}/${
          window.walletAddresses.length
        }`;
        document.getElementById("nft-progress-bar").style.width = `${
          ((i + 1) / window.walletAddresses.length) * 100
        }%`;

        // Add delay between requests if using public RPC
        if (
          window.settings.rpcUrl === window.DEFAULT_RPC_URL &&
          i < window.walletAddresses.length - 1
        ) {
          await new Promise((resolve) =>
            setTimeout(resolve, window.RPC_DELAY_MS)
          );
        }
      }

      // Display results
      window.displayNFTResults();

      // Show success message
      const successMessage =
        window.walletAddresses.length === 1
          ? "Successfully processed 1 wallet address."
          : `Successfully processed ${window.walletAddresses.length} wallet addresses.`;
      document.getElementById("nft-success-message").textContent =
        successMessage;
      document.getElementById("nft-success-message").style.display = "block";
    } catch (error) {
      console.error("Error searching NFTs:", error);
      document.getElementById("nft-error-message").textContent = error.message;
      document.getElementById("nft-error-message").style.display = "block";
    } finally {
      // Hide loader and progress
      document.getElementById("nft-loader").style.display = "none";
      document.getElementById("nft-progress-container").style.display = "none";
      window.isProcessing = false;
    }
  }

  // Fetch collection name from collection address
  async function getCollectionName(metaplexUmi, collectionAddress) {
    if (!collectionAddress) {
      return "Unknown Collection";
    }

    // Check cache first
    if (collectionNameCache[collectionAddress]) {
      return collectionNameCache[collectionAddress];
    }

    try {
      // Find metadata PDA for the collection
      const findMetadataPda = window.mplTokenMetadata.findMetadataPda;
      const publicKey = window.mplUmi.publicKey;

      const metadataPDA = findMetadataPda(metaplexUmi, {
        mint: publicKey(collectionAddress),
      })[0];

      // Get metadata account
      const account = await metaplexUmi.rpc.getAccount(metadataPDA);

      if (account.exists) {
        const Metadata = window.mplTokenMetadata.Metadata;
        const deserializeMetadata = window.mplTokenMetadata.deserializeMetadata;

        const metadata = deserializeMetadata(
          Metadata.deserialize(account.data)[0]
        );

        const name = metadata.name || "Unknown Collection";
        collectionNameCache[collectionAddress] = name;
        return name;
      }
    } catch (err) {
      console.warn(
        `Failed to get collection name for ${collectionAddress}:`,
        err
      );
    }

    return "Unknown Collection";
  }

  // Return public methods and properties
  return {
    searchNFTs,
    getCollectionName,
    // verifyMetaplexLibraries,
  };
})();

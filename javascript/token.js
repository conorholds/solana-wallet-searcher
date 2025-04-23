// javascript/token.js
// Handles fetching and processing token data from Solana

const TokenService = (() => {
  // Constants
  const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
  const ASSOCIATED_TOKEN_PROGRAM_ID =
    "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
  const METADATA_PROGRAM_ID = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";

  const tokenMetadataCache = {};

  async function getTokenMetadata(connection, tokenMint) {
    // Check cache first
    if (tokenMetadataCache[tokenMint]) {
      return tokenMetadataCache[tokenMint];
    }

    try {
      const mintPubkey = new solanaWeb3.PublicKey(tokenMint);

      // Initialize defaults
      let tokenName = "Unknown";
      let tokenSymbol = "Unknown";
      let tokenLogo = null;
      let decimals = null;

      // Get mint info first for decimals
      try {
        const mintInfo = await connection.getParsedAccountInfo(mintPubkey);
        if (mintInfo?.value?.data?.parsed?.info?.decimals) {
          decimals = mintInfo.value.data.parsed.info.decimals;
        }
      } catch (err) {
        console.warn(`Error getting mint info for ${tokenMint}:`, err);
      }

      // Try using the Metaplex JS SDK approach
      try {
        // Check if Metaplex JS SDK is available
        if (
          window.metaplex &&
          window.metaplex.Metaplex &&
          typeof window.metaplex.Metaplex.make === "function"
        ) {
          // Create Metaplex instance
          const metaplexInstance = window.metaplex.Metaplex.make(connection);

          // Get metadata PDA
          const metadataAddress = metaplexInstance
            .nfts()
            .pdas()
            .metadata({ mint: mintPubkey });

          // Check if metadata account exists
          const metadataAccountInfo = await connection.getAccountInfo(
            metadataAddress
          );

          if (metadataAccountInfo) {
            // Get token details
            const nft = await metaplexInstance
              .nfts()
              .findByMint({ mintAddress: mintPubkey });

            if (nft) {
              tokenName = nft.name;
              tokenSymbol = nft.symbol;
              tokenLogo = nft.json?.image;
            }
          } else {
            console.warn("No metadata account found for token: ", tokenMint);
          }
        } else {
          console.warn("Metaplex JS SDK not available");
        }
      } catch (metaplexJsError) {
        console.warn(
          `Metaplex JS lookup failed for ${tokenMint}:`,
          metaplexJsError
        );
      }

      // Create and cache metadata object
      const metadata = {
        name: tokenName,
        symbol: tokenSymbol,
        logo: tokenLogo,
        decimals,
      };

      tokenMetadataCache[tokenMint] = metadata;
      return metadata;
    } catch (error) {
      console.error(`Failed to get token metadata for ${tokenMint}:`, error);
      const defaultMetadata = { name: "Unknown", symbol: "Unknown", decimals };
      tokenMetadataCache[tokenMint] = defaultMetadata;
      return defaultMetadata;
    }
  }

  async function searchTokens() {
    if (window.isProcessing) {
      return;
    }
    window.isProcessing = true;

    // Clear previous results
    window.tokenResults = [];
    document.getElementById("tokens-result").style.display = "none";
    document.getElementById("tokens-result-container").innerHTML = "";
    document.getElementById("error-message").style.display = "none";
    document.getElementById("success-message").style.display = "none";

    // Show loader
    document.getElementById("loader").style.display = "block";

    try {
      // Get wallet addresses
      window.walletAddresses = await window.getWalletAddresses();
      if (window.walletAddresses.length === 0) {
        throw new Error("Please enter at least one wallet address");
      }

      // Force reload settings from localStorage
      const savedSettings = localStorage.getItem(
        "solanaWalletSearcherSettings"
      );
      if (savedSettings) {
        try {
          const parsedSettings = JSON.parse(savedSettings);

          // Directly update the settings object to ensure it has the latest values
          if (parsedSettings.rpcUrl) {
            window.settings.rpcUrl = parsedSettings.rpcUrl;
          }

          if (parsedSettings.promptShown !== undefined) {
            window.settings.promptShown = parsedSettings.promptShown === true;
          }
        } catch (error) {
          console.error("Error parsing localStorage settings:", error);
        }
      }

      // Create Solana connection with explicit RPC URL
      const rpcUrl = window.settings.rpcUrl;
      // Create connection with explicit URL parameter
      const connection = new solanaWeb3.Connection(rpcUrl, "confirmed");

      // Show progress bar
      document.getElementById("progress-container").style.display = "block";
      document.getElementById(
        "progress-text"
      ).textContent = `0/${window.walletAddresses.length}`;
      document.getElementById("progress-bar").style.width = "0%";

      // Get search parameters
      const showAllTokens = document.getElementById("showAllTokens").checked;

      // Process each wallet address
      for (let i = 0; i < window.walletAddresses.length; i++) {
        try {
          const walletAddress = window.walletAddresses[i].trim();

          // Create wallet public key
          const walletPublicKey = new solanaWeb3.PublicKey(walletAddress);

          // Get all tokens using TOKEN_PROGRAM_ID
          const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
            walletPublicKey,
            { programId: new solanaWeb3.PublicKey(TOKEN_PROGRAM_ID) }
          );

          // Process each token account
          for (const account of tokenAccounts.value) {
            try {
              // Extract data using the expected structure
              const parsedInfo = account.account.data.parsed.info;
              const mintAddress = parsedInfo.mint;
              const tokenAmount = parsedInfo.tokenAmount;

              // Skip zero balances if showing all tokens
              if (showAllTokens && tokenAmount.amount === "0") {
                continue;
              }

              // Get token metadata
              const metadata = await getTokenMetadata(connection, mintAddress);

              // Add to token results
              window.tokenResults.push({
                walletAddress,
                tokenAddress: mintAddress,
                tokenName: metadata.name || "Unknown",
                symbol: metadata.symbol || "Unknown",
                logo: metadata.logo,
                balance: tokenAmount.amount,
                decimals: tokenAmount.decimals,
              });
            } catch (parseError) {
              console.error("Error parsing token account:", parseError);
            }
          }

          // Also try to get Token 2022 tokens
          try {
            const token2022Accounts =
              await connection.getParsedTokenAccountsByOwner(walletPublicKey, {
                programId: new solanaWeb3.PublicKey(TOKEN_2022_PROGRAM_ID),
              });

            // Process Token-2022 accounts
            for (const account of token2022Accounts.value) {
              try {
                // Extract data using the expected structure
                const parsedInfo = account.account.data.parsed.info;
                const mintAddress = parsedInfo.mint;
                const tokenAmount = parsedInfo.tokenAmount;

                // Skip zero balances if showing all tokens
                if (showAllTokens && tokenAmount.amount === "0") {
                  continue;
                }

                // Get token metadata
                const metadata = await getTokenMetadata(
                  connection,
                  mintAddress
                );

                // Add to token results
                window.tokenResults.push({
                  walletAddress,
                  tokenAddress: mintAddress,
                  tokenName: metadata.name || "Unknown",
                  symbol: metadata.symbol || "Unknown",
                  logo: metadata.logo,
                  balance: tokenAmount.amount,
                  decimals: tokenAmount.decimals,
                });
              } catch (parseError) {
                console.error("Error parsing Token-2022 account:", parseError);
              }
            }
          } catch (token2022Error) {
            console.warn("Error fetching Token-2022 accounts:", token2022Error);
          }
        } catch (walletError) {
          console.error(`Error processing wallet:`, walletError);
          // Add error result
          window.tokenResults.push({
            walletAddress: window.walletAddresses[i],
            error: walletError.message,
          });
        }

        // Update progress
        document.getElementById("progress-text").textContent = `${i + 1}/${
          window.walletAddresses.length
        }`;
        document.getElementById("progress-bar").style.width = `${
          ((i + 1) / window.walletAddresses.length) * 100
        }%`;
      }

      // Display results
      window.displayTokenResults();

      // Show success message
      const successMessage =
        window.walletAddresses.length === 1
          ? "Successfully processed 1 wallet address."
          : `Successfully processed ${window.walletAddresses.length} wallet addresses.`;
      document.getElementById("success-message").textContent = successMessage;
      document.getElementById("success-message").style.display = "block";
    } catch (error) {
      console.error("Error searching tokens:", error);
      document.getElementById("error-message").textContent = error.message;
      document.getElementById("error-message").style.display = "block";
    } finally {
      // Hide loader and progress
      document.getElementById("loader").style.display = "none";
      document.getElementById("progress-container").style.display = "none";
      window.isProcessing = false;
    }
  }

  async function deriveATAAddress(walletAddress, tokenMintAddress) {
    try {
      const wallet = new solanaWeb3.PublicKey(walletAddress);
      const mint = new solanaWeb3.PublicKey(tokenMintAddress);
      const tokenProgram = new solanaWeb3.PublicKey(TOKEN_PROGRAM_ID);
      const associatedTokenProgram = new solanaWeb3.PublicKey(
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      const [ataAddress] = await solanaWeb3.PublicKey.findProgramAddress(
        [wallet.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
        associatedTokenProgram
      );

      return ataAddress.toString();
    } catch (error) {
      console.error("Error deriving ATA address:", error);
      return null;
    }
  }

  async function viewTokenOnSolscan(walletAddress, tokenMintAddress) {
    try {
      // Derive the ATA address
      const ataAddress = await deriveATAAddress(
        walletAddress,
        tokenMintAddress
      );

      if (ataAddress) {
        // Open Solscan to the specific ATA
        window.open(`https://solscan.io/account/${ataAddress}`, "_blank");
      } else {
        // Fallback to token mint page if ATA derivation fails
        window.open(`https://solscan.io/token/${tokenMintAddress}`, "_blank");
      }
    } catch (error) {
      console.error("Error viewing token on Solscan:", error);
      // Fallback to token mint page
      window.open(`https://solscan.io/token/${tokenMintAddress}`, "_blank");
    }
  }

  // Return public methods and properties
  return {
    searchTokens,
    viewTokenOnSolscan,
    getTokenMetadata,
  };
})();

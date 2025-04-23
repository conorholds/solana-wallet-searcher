// javascript/main.js
// Handles the main functionality of the Solana Wallet Searcher

const DEFAULT_RPC_URL = "";
const RPC_DELAY_MS = 500;
const DEFAULT_RPC_REQUIRED = true;

let settings = {
  rpcUrl: DEFAULT_RPC_URL,
  promptShown: false,
};

let tokenResults = [];
let nftResults = [];
let walletAddresses = [];
let isProcessing = false;
let tokenMetadataCache = {}; // Cache for token metadata

document.addEventListener("DOMContentLoaded", function () {
  loadSettings();

  BigInt.prototype.toJSON = function () {
    return this.toString();
  };

  document
    .getElementById("showAllTokens")
    .addEventListener("change", function () {
      document.getElementById("specificTokensGroup").style.display = this
        .checked
        ? "none"
        : "block";
    });

  document
    .getElementById("showAllNFTs")
    .addEventListener("change", function () {
      document.getElementById("specificNFTsGroup").style.display = this.checked
        ? "none"
        : "block";
    });

  setupEventHandlers();
});

// Set up event handlers
function setupEventHandlers() {
  // Tab switching
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", function () {
      const tabId = this.getAttribute("data-tab");
      switchTab(tabId);
    });
  });

  // File upload
  document
    .getElementById("walletFile")
    .addEventListener("change", handleFileUpload);

  // Settings modal
  document
    .querySelector(".settings-icon")
    .addEventListener("click", openSettingsModal);

  // Close modals
  document.querySelectorAll(".close-btn").forEach((btn) => {
    btn.addEventListener("click", function () {
      const modalId = this.getAttribute("data-modal");
      closeModal(modalId);
    });
  });

  // Save settings
  document
    .getElementById("saveSettingsBtn")
    .addEventListener("click", saveSettings);

  // RPC modal buttons
  document
    .getElementById("saveCustomRPCBtn")
    .addEventListener("click", saveCustomRPC);

  // Add input validation event listener
  document
    .getElementById("promptRpcUrl")
    .addEventListener("input", function () {
      // Hide error message when user starts typing
      document.getElementById("rpc-error").style.display = "none";
    });

  // Search buttons
  document
    .getElementById("searchTokensBtn")
    .addEventListener("click", () => searchTokens());
  document
    .getElementById("searchNFTsBtn")
    .addEventListener("click", () => searchNFTs());

  // Download CSV buttons
  document.querySelectorAll(".download-button").forEach((btn) => {
    btn.addEventListener("click", function () {
      const type = this.getAttribute("data-type");
      downloadCSV(type);
    });
  });

  // Set up modal outside click handler
  document.querySelectorAll(".modal").forEach((modal) => {
    modal.addEventListener("click", function (event) {
      if (event.target === this) {
        this.style.display = "none";
      }
    });
  });
}

// Switch between tabs
function switchTab(tabId) {
  // Hide all tab contents
  document.querySelectorAll(".tab-content").forEach((content) => {
    content.classList.remove("active");
  });

  // Deactivate all tabs
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.remove("active");
  });

  // Activate selected tab
  document.getElementById(tabId).classList.add("active");

  // Find and activate the tab button
  document.querySelector(`.tab[data-tab="${tabId}"]`).classList.add("active");

  // Hide results
  document.querySelectorAll(".result").forEach((result) => {
    result.style.display = "none";
  });

  // Hide errors
  document.querySelectorAll(".error").forEach((error) => {
    error.style.display = "none";
  });

  // Hide success messages
  document.querySelectorAll(".success-message").forEach((success) => {
    success.style.display = "none";
  });
}

// Handle file upload
function handleFileUpload() {
  const fileInput = document.getElementById("walletFile");
  const fileName = document.getElementById("fileName");

  if (fileInput.files.length > 0) {
    const file = fileInput.files[0];
    fileName.textContent = `${file.name} (processing...)`;

    const reader = new FileReader();
    reader.onload = function (e) {
      const contents = e.target.result;
      const addresses = contents
        .split(/[\r\n]+/)
        .filter((address) => address.trim() !== "");

      fileName.textContent = `${file.name} (${addresses.length} addresses)`;
    };

    reader.readAsText(file);
  } else {
    fileName.textContent = "";
  }
}

// Get wallet addresses from input or file
function getWalletAddresses() {
  // From textarea
  const addressesTextarea = document.getElementById("walletAddresses");
  let addresses = addressesTextarea.value
    .split(/[\r\n]+/)
    .filter((address) => address.trim() !== "");

  // From file
  const fileInput = document.getElementById("walletFile");
  if (fileInput.files.length > 0) {
    const reader = new FileReader();

    return new Promise((resolve, reject) => {
      reader.onload = function (e) {
        const contents = e.target.result;
        const fileAddresses = contents
          .split(/[\r\n]+/)
          .filter((address) => address.trim() !== "");

        // Combine with textarea addresses
        const allAddresses = [...addresses, ...fileAddresses];

        // Remove duplicates
        const uniqueAddresses = [...new Set(allAddresses)];
        resolve(uniqueAddresses);
      };

      reader.onerror = function () {
        reject(new Error("Failed to read file"));
      };

      reader.readAsText(fileInput.files[0]);
    });
  } else {
    return Promise.resolve(addresses);
  }
}

// Replace the displayTokenResults function in main.js with this version
function displayTokenResults() {
  const container = document.getElementById("tokens-result-container");
  const groupByWallet = document.getElementById("groupByWalletTokens").checked;

  if (!window.tokenResults || window.tokenResults.length === 0) {
    console.warn("No tokens found to display");
    container.innerHTML = "<p>No tokens found.</p>";
    document.getElementById("tokens-result").style.display = "block";
    return;
  }

  container.innerHTML = "";

  if (groupByWallet) {
    // Group results by wallet
    const walletGroups = {};

    window.tokenResults.forEach((result) => {
      if (!walletGroups[result.walletAddress]) {
        walletGroups[result.walletAddress] = [];
      }
      walletGroups[result.walletAddress].push(result);
    });

    // Get wallet total values
    const walletTotalValues = window.walletTotalValues || {};

    // Create a section for each wallet - now sorted by total value
    const sortedWalletAddresses = Object.keys(walletGroups).sort((a, b) => {
      const valueA = walletTotalValues[a] || 0;
      const valueB = walletTotalValues[b] || 0;
      return valueB - valueA;
    });

    for (const walletAddress of sortedWalletAddresses) {
      const results = walletGroups[walletAddress];
      const hasError = results.some((r) => r.error);

      // Create wallet section
      const walletSection = document.createElement("div");
      walletSection.className = "wallet-group";

      // Create wallet header
      const walletHeader = document.createElement("div");
      walletHeader.className = "wallet-header";

      // Count tokens
      const tokenCount = hasError ? 0 : results.length;

      // Get total wallet value
      const totalWalletValue = walletTotalValues[walletAddress] || 0;
      const totalValueDisplay =
        totalWalletValue > 0 ? ` (~$${totalWalletValue.toFixed(2)})` : "";

      walletHeader.innerHTML = `
        <div class="wallet-address" title="${walletAddress}">${walletAddress}</div>
        <div class="wallet-count">${tokenCount} token${
        tokenCount !== 1 ? "s" : ""
      }${totalValueDisplay}</div>
      `;

      walletSection.appendChild(walletHeader);

      if (hasError) {
        // Display error message
        const errorResult = results.find((r) => r.error);
        const errorMessage = document.createElement("div");
        errorMessage.style.padding = "12px";
        errorMessage.style.color = "var(--error)";
        errorMessage.textContent = `Error: ${errorResult.error}`;
        walletSection.appendChild(errorMessage);
      } else {
        // Create token table
        const table = document.createElement("table");
        table.className = "results-table";

        // Create header
        const headerRow = document.createElement("tr");
        headerRow.innerHTML = `
          <th>Symbol</th>
          <th>Token Name</th>
          <th>Token Address</th>
          <th>Balance</th>
          <th>USDC Value</th>
          <th>Actions</th>
        `;
        table.appendChild(headerRow);

        // Create rows for each token
        results.forEach((result) => {
          const row = createTokenTableRow(result);
          table.appendChild(row);
        });

        walletSection.appendChild(table);
      }

      container.appendChild(walletSection);
    }
  } else {
    // Create single table with all results
    const table = document.createElement("table");
    table.className = "results-table";

    // Create header
    const headerRow = document.createElement("tr");
    headerRow.innerHTML = `
      <th>Wallet Address</th>
      <th>Symbol</th>
      <th>Token Name</th>
      <th>Token Address</th>
      <th>Balance</th>
      <th>USDC Value</th>
      <th>Actions</th>
    `;
    table.appendChild(headerRow);

    // Create rows
    window.tokenResults.forEach((result) => {
      const row = document.createElement("tr");

      if (result.error) {
        // Error result
        row.innerHTML = `
          <td>${abbreviateAddress(result.walletAddress)}</td>
          <td colspan="6" style="color: var(--error)">Error: ${
            result.error
          }</td>
        `;
      } else {
        // Format the balance with decimals
        const formattedBalance = formatTokenBalance(
          result.balance,
          result.decimals
        );

        // Format USDC value
        const formattedValue =
          result.usdcValue !== null ? `$${result.usdcValue.toFixed(2)}` : "N/A";

        // Abbreviated addresses
        const abbreviatedWallet = abbreviateAddress(result.walletAddress);
        const abbreviatedToken = abbreviateAddress(result.tokenAddress);

        // Highlight SOL row
        if (result.isNativeSol) {
          row.classList.add("sol-row");
        }

        // Normal result
        row.innerHTML = `
          <td>${abbreviatedWallet}</td>
          <td>${result.symbol || "Unknown"}</td>
          <td>${result.tokenName || "Unknown"}</td>
          <td>${abbreviatedToken}</td>
          <td>${formattedBalance}</td>
          <td>${formattedValue}</td>
          <td class="actions-cell"></td>
        `;

        // Add action buttons
        const actionsCell = row.querySelector(".actions-cell");

        // Copy button
        const copyBtn = document.createElement("button");
        copyBtn.className = "icon-button";
        copyBtn.title = "Copy token address";
        copyBtn.innerHTML =
          '<svg viewBox="0 0 24 24"><path d="M19,21H8V7H19M19,5H8A2,2 0 0,0 6,7V21A2,2 0 0,0 8,23H19A2,2 0 0,0 21,21V7A2,2 0 0,0 19,5M16,1H4A2,2 0 0,0 2,3V17H4V3H16V1Z"/></svg>';
        copyBtn.addEventListener("click", () =>
          copyToClipboard(result.tokenAddress)
        );
        actionsCell.appendChild(copyBtn);

        // View on Solscan button
        const viewBtn = document.createElement("button");
        viewBtn.className = "icon-button";
        viewBtn.title = "View on Solscan";
        viewBtn.innerHTML =
          '<svg viewBox="0 0 24 24"><path d="M12,9A3,3 0 0,0 9,12A3,3 0 0,0 12,15A3,3 0 0,0 15,12A3,3 0 0,0 12,9M12,17A5,5 0 0,1 7,12A5,5 0 0,1 12,7A5,5 0 0,1 17,12A5,5 0 0,1 12,17M12,4.5C7,4.5 2.73,7.61 1,12C2.73,16.39 7,19.5 12,19.5C17,19.5 21.27,16.39 23,12C21.27,7.61 17,4.5 12,4.5Z"/></svg>';
        viewBtn.addEventListener("click", () =>
          viewTokenOnSolscan(result.walletAddress, result.tokenAddress)
        );
        actionsCell.appendChild(viewBtn);
      }

      table.appendChild(row);
    });

    container.appendChild(table);
  }

  // Add some styling for the SOL row
  const style = document.createElement("style");
  style.textContent = `
    .sol-row {
      background-color: rgba(20, 130, 255, 0.1);
      font-weight: bold;
    }
  `;
  document.head.appendChild(style);
  document.getElementById("tokens-result").style.display = "block";
}

// Helper to create token table row
function createTokenTableRow(result) {
  const row = document.createElement("tr");

  // Format the balance with decimals
  const formattedBalance = formatTokenBalance(result.balance, result.decimals);

  // Format USDC value
  const formattedValue =
    result.usdcValue !== null ? `$${result.usdcValue.toFixed(2)}` : "N/A";

  // Abbreviated token address
  const abbreviatedToken = abbreviateAddress(result.tokenAddress);

  // Highlight SOL row
  if (result.isNativeSol) {
    row.classList.add("sol-row");
  }

  // Set the basic row content
  row.innerHTML = `
    <td>${result.symbol || "Unknown"}</td>
    <td>${result.tokenName || "Unknown"}</td>
    <td>${abbreviatedToken}</td>
    <td>${formattedBalance}</td>
    <td>${formattedValue}</td>
    <td class="actions-cell"></td>
  `;

  // Add action buttons
  const actionsCell = row.querySelector(".actions-cell");

  // Copy button
  const copyBtn = document.createElement("button");
  copyBtn.className = "icon-button";
  copyBtn.title = "Copy token address";
  copyBtn.innerHTML =
    '<svg viewBox="0 0 24 24"><path d="M19,21H8V7H19M19,5H8A2,2 0 0,0 6,7V21A2,2 0 0,0 8,23H19A2,2 0 0,0 21,21V7A2,2 0 0,0 19,5M16,1H4A2,2 0 0,0 2,3V17H4V3H16V1Z"/></svg>';
  copyBtn.addEventListener("click", () => copyToClipboard(result.tokenAddress));
  actionsCell.appendChild(copyBtn);

  // View on Solscan button
  const viewBtn = document.createElement("button");
  viewBtn.className = "icon-button";
  viewBtn.title = "View on Solscan";
  viewBtn.innerHTML =
    '<svg viewBox="0 0 24 24"><path d="M12,9A3,3 0 0,0 9,12A3,3 0 0,0 12,15A3,3 0 0,0 15,12A3,3 0 0,0 12,9M12,17A5,5 0 0,1 7,12A5,5 0 0,1 12,7A5,5 0 0,1 17,12A5,5 0 0,1 12,17M12,4.5C7,4.5 2.73,7.61 1,12C2.73,16.39 7,19.5 12,19.5C17,19.5 21.27,16.39 23,12C21.27,7.61 17,4.5 12,4.5Z"/></svg>';
  viewBtn.addEventListener("click", () =>
    viewTokenOnSolscan(result.walletAddress, result.tokenAddress)
  );
  actionsCell.appendChild(viewBtn);

  return row;
}

// Similar helper for NFT row creation
function createNFTTableRow(result, includeWallet = false) {
  const row = document.createElement("tr");

  // Abbreviated addresses
  const abbreviatedNFT = abbreviateAddress(result.nftAddress);
  const abbreviatedCollection = result.collectionAddress
    ? abbreviateAddress(result.collectionAddress)
    : "N/A";

  // Base HTML structure
  let rowHTML = "";

  // Include wallet column if needed
  if (includeWallet) {
    const abbreviatedWallet = abbreviateAddress(result.walletAddress);
    rowHTML += `<td>${abbreviatedWallet}</td>`;
  }

  // Add the rest of the columns
  rowHTML += `
    <td>${abbreviatedCollection}</td>
    <td>${result.collectionName || "Unknown"}</td>
    <td>${result.nftName || "Unknown"}</td>
    <td>${abbreviatedNFT}</td>
    <td class="actions-cell"></td>
  `;

  row.innerHTML = rowHTML;

  // Add action buttons
  const actionsCell = row.querySelector(".actions-cell");

  // Copy button
  const copyBtn = document.createElement("button");
  copyBtn.className = "icon-button";
  copyBtn.title = "Copy NFT address";
  copyBtn.innerHTML =
    '<svg viewBox="0 0 24 24"><path d="M19,21H8V7H19M19,5H8A2,2 0 0,0 6,7V21A2,2 0 0,0 8,23H19A2,2 0 0,0 21,21V7A2,2 0 0,0 19,5M16,1H4A2,2 0 0,0 2,3V17H4V3H16V1Z"/></svg>';
  copyBtn.addEventListener("click", () => copyToClipboard(result.nftAddress));
  actionsCell.appendChild(copyBtn);

  // View on Solscan button
  const nftSolscanLink = `https://solscan.io/token/${result.nftAddress}`;
  const viewBtn = document.createElement("button");
  viewBtn.className = "icon-button";
  viewBtn.title = "View on Solscan";
  viewBtn.innerHTML =
    '<svg viewBox="0 0 24 24"><path d="M12,9A3,3 0 0,0 9,12A3,3 0 0,0 12,15A3,3 0 0,0 15,12A3,3 0 0,0 12,9M12,17A5,5 0 0,1 7,12A5,5 0 0,1 12,7A5,5 0 0,1 17,12A5,5 0 0,1 12,17M12,4.5C7,4.5 2.73,7.61 1,12C2.73,16.39 7,19.5 12,19.5C17,19.5 21.27,16.39 23,12C21.27,7.61 17,4.5 12,4.5Z"/></svg>';
  viewBtn.addEventListener("click", () =>
    window.open(nftSolscanLink, "_blank")
  );
  actionsCell.appendChild(viewBtn);

  return row;
}

// Display NFT results
function displayNFTResults() {
  const container = document.getElementById("nfts-result-container");
  const groupByWallet = document.getElementById("groupByWalletNFTs").checked;

  if (!window.nftResults || window.nftResults.length === 0) {
    console.warn("No NFTs to display");
    container.innerHTML = "<p>No NFTs found.</p>";
    document.getElementById("nfts-result").style.display = "block";
    return;
  }

  container.innerHTML = "";

  if (groupByWallet) {
    // Group results by wallet
    const walletGroups = {};

    window.nftResults.forEach((result) => {
      if (!walletGroups[result.walletAddress]) {
        walletGroups[result.walletAddress] = [];
      }
      walletGroups[result.walletAddress].push(result);
    });

    // Get wallet NFT counts
    const walletNftCounts = window.walletNftCounts || {};

    // Create a section for each wallet - sorted by NFT count
    const sortedWalletAddresses = Object.keys(walletGroups).sort((a, b) => {
      const countA = walletNftCounts[a] || 0;
      const countB = walletNftCounts[b] || 0;
      return countB - countA; // Sort by descending NFT count
    });

    for (const walletAddress of sortedWalletAddresses) {
      const results = walletGroups[walletAddress];
      const hasError = results.some((r) => r.error);

      // Create wallet section
      const walletSection = document.createElement("div");
      walletSection.className = "wallet-group";

      // Create wallet header
      const walletHeader = document.createElement("div");
      walletHeader.className = "wallet-header";

      // Count NFTs
      const nftCount = hasError ? 0 : results.length;

      walletHeader.innerHTML = `
        <div class="wallet-address" title="${walletAddress}">${walletAddress}</div>
        <div class="wallet-count">${nftCount} NFT${
        nftCount !== 1 ? "s" : ""
      }</div>
      `;

      walletSection.appendChild(walletHeader);

      if (hasError) {
        // Display error message
        const errorResult = results.find((r) => r.error);
        const errorMessage = document.createElement("div");
        errorMessage.style.padding = "12px";
        errorMessage.style.color = "var(--error)";
        errorMessage.textContent = `Error: ${errorResult.error}`;
        walletSection.appendChild(errorMessage);
      } else {
        // Create NFT table
        const table = document.createElement("table");
        table.className = "results-table";

        // Create header
        const headerRow = document.createElement("tr");
        headerRow.innerHTML = `
          <th>Collection Address</th>
          <th>Collection Name</th>
          <th>NFT Name</th>
          <th>NFT Address</th>
          <th>Actions</th>
        `;
        table.appendChild(headerRow);

        // Create rows
        results.forEach((result) => {
          const row = createNFTTableRow(result, false);
          table.appendChild(row);
        });

        walletSection.appendChild(table);
      }

      container.appendChild(walletSection);
    }
  } else {
    // Create single table with all results
    const table = document.createElement("table");
    table.className = "results-table";

    // Create header
    const headerRow = document.createElement("tr");
    headerRow.innerHTML = `
      <th>Wallet Address</th>
      <th>Collection Address</th>
      <th>Collection Name</th>
      <th>NFT Name</th>
      <th>NFT Address</th>
      <th>Actions</th>
    `;
    table.appendChild(headerRow);

    // Create rows
    window.nftResults.forEach((result) => {
      if (result.error) {
        // Error result
        const row = document.createElement("tr");
        row.innerHTML = `
          <td>${abbreviateAddress(result.walletAddress)}</td>
          <td colspan="5" style="color: var(--error)">Error: ${
            result.error
          }</td>
        `;
        table.appendChild(row);
      } else {
        // Normal result
        const row = createNFTTableRow(result, true);
        table.appendChild(row);
      }
    });

    container.appendChild(table);
  }

  document.getElementById("nfts-result").style.display = "block";
}

// Format token balance with correct decimals
function formatTokenBalance(balance, decimals) {
  if (!balance || balance === "0") {
    return "0";
  }

  // Ensure decimals is a number
  const tokenDecimals = parseInt(decimals || 9, 10);

  try {
    // Convert string balance to BigInt if needed
    const balanceBigInt =
      typeof balance === "string"
        ? BigInt(balance)
        : BigInt(balance.toString());

    // Convert to string and pad with leading zeros if needed
    let balanceStr = balanceBigInt.toString();
    while (balanceStr.length <= tokenDecimals) {
      balanceStr = "0" + balanceStr;
    }

    // Split into integer and fractional parts
    const integerPart =
      balanceStr.slice(0, balanceStr.length - tokenDecimals) || "0";
    const fractionalPart = balanceStr.slice(balanceStr.length - tokenDecimals);

    // Format with commas for thousands separators
    const integerFormatted = parseInt(integerPart).toLocaleString("en-US");

    // Only show fractional part if non-zero
    if (parseInt(fractionalPart) === 0) {
      return integerFormatted;
    }

    // Trim trailing zeros from fractional part
    let trimmedFractional = fractionalPart;
    while (trimmedFractional.endsWith("0")) {
      trimmedFractional = trimmedFractional.slice(0, -1);
    }

    if (trimmedFractional.length === 0) {
      return integerFormatted;
    }

    return `${integerFormatted}.${trimmedFractional}`;
  } catch (error) {
    console.error(
      "Error formatting balance:",
      error,
      "for balance:",
      balance,
      "with decimals:",
      decimals
    );
    return balance.toString();
  }
}

// Create and download a file
function downloadFile(content, filename) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");

  if (navigator.msSaveBlob) {
    // IE 10+
    navigator.msSaveBlob(blob, filename);
  } else {
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 100);
  }
}

// Helper function to abbreviate addresses (first 6...last 6 chars)
function abbreviateAddress(address) {
  if (!address || address.length < 14) return address;
  return `${address.substring(0, 6)}...${address.substring(
    address.length - 6
  )}`;
}

// Copy text to clipboard
function copyToClipboard(text) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  document.body.appendChild(textArea);
  textArea.select();

  try {
    const successful = document.execCommand("copy");
    const msg = successful ? "Copied!" : "Failed to copy";
  } catch (err) {
    console.error("Copy failed:", err);
  }

  document.body.removeChild(textArea);
}

// Open settings modal
function openSettingsModal() {
  // Load current settings
  document.getElementById("rpcUrl").value =
    settings.rpcUrl === DEFAULT_RPC_URL ? "" : settings.rpcUrl;

  // Show modal
  document.getElementById("settings-modal").style.display = "block";
}

// Show RPC prompt modal
function showRPCPrompt() {
  const rpcModal = document.getElementById("rpc-prompt-modal");
  rpcModal.style.display = "block";

  // Remove the close button and disable clicking outside to close
  const closeBtn = rpcModal.querySelector(".close-btn");
  if (closeBtn) {
    closeBtn.style.display = "none";
  }

  // Prevent closing by clicking outside
  rpcModal.removeEventListener("click", closeModalOnOutsideClick);

  // Function to prevent closing when clicking outside
  function closeModalOnOutsideClick(event) {
    // This function is now empty - modal can't be closed by clicking outside
  }

  // Replace the existing event listener
  rpcModal.addEventListener("click", closeModalOnOutsideClick);
}

// Save settings
async function saveSettings() {
  const rpcUrlInput = document.getElementById("rpcUrl").value.trim();

  if (
    DEFAULT_RPC_REQUIRED &&
    (!rpcUrlInput || rpcUrlInput === DEFAULT_RPC_URL)
  ) {
    alert(
      "A custom RPC URL is required for this application to function properly."
    );
    return;
  }

  // Show validation message
  const saveButton = document.getElementById("saveSettingsBtn");
  const originalText = saveButton.textContent;
  saveButton.disabled = true;
  saveButton.textContent = "Validating...";

  try {
    // Validate the RPC URL
    const isValid = await validateRpcUrl(rpcUrlInput);

    if (!isValid) {
      alert(
        "Invalid RPC URL or connection failed. Please enter a valid RPC URL."
      );
      saveButton.disabled = false;
      saveButton.textContent = originalText;
      return;
    }

    settings.rpcUrl = rpcUrlInput;
    settings.promptShown = true;

    // Save to localStorage
    localStorage.setItem(
      "solanaWalletSearcherSettings",
      JSON.stringify(settings)
    );

    // Close modal
    closeModal("settings-modal");

    // Show success message
    alert("Settings saved successfully!");
  } catch (error) {
    console.error("Error validating RPC URL:", error);
    alert("Error validating RPC URL: " + (error.message || "Unknown error"));
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = originalText;
  }
}

// Save custom RPC from prompt
async function saveCustomRPC() {
  const rpcUrlInput = document.getElementById("promptRpcUrl").value.trim();
  const rpcError = document.getElementById("rpc-error");
  const saveButton = document.getElementById("saveCustomRPCBtn");

  if (rpcUrlInput === "") {
    rpcError.textContent = "Please enter a valid RPC URL";
    rpcError.style.display = "block";
    return; // Don't proceed without a valid RPC URL
  }

  // Show loading state
  saveButton.disabled = true;
  saveButton.textContent = "Validating...";

  try {
    // Validate the RPC URL
    const isValid = await validateRpcUrl(rpcUrlInput);

    if (!isValid) {
      rpcError.textContent = "Invalid RPC URL or connection failed";
      rpcError.style.display = "block";
      saveButton.disabled = false;
      saveButton.textContent = "Use Custom RPC";
      return;
    }

    // Hide error if it was shown
    rpcError.style.display = "none";

    // Update settings
    settings.rpcUrl = rpcUrlInput;
    settings.promptShown = true;

    // Save to localStorage
    localStorage.setItem(
      "solanaWalletSearcherSettings",
      JSON.stringify(settings)
    );

    // Close modal
    closeModal("rpc-prompt-modal");

    // Store which tab was active when the RPC prompt was shown
    const activeTab = document.querySelector(".tab.active");
    const activeTabId = activeTab ? activeTab.getAttribute("data-tab") : null;

    // Restart the search based on the active tab
    if (activeTabId === "tokens-tab") {
      setTimeout(() => searchTokens(), 100); // Small delay to ensure UI updates first
    } else if (activeTabId === "nft-tab") {
      setTimeout(() => searchNFTs(), 100); // Small delay to ensure UI updates first
    }
  } catch (error) {
    console.error("Error validating RPC URL:", error);
    rpcError.textContent =
      "Error: " + (error.message || "Failed to validate RPC");
    rpcError.style.display = "block";
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Use Custom RPC";
  }
}

// Dismiss RPC prompt
function dismissRPCPrompt() {
  settings.promptShown = true;

  // Save to localStorage
  localStorage.setItem(
    "solanaWalletSearcherSettings",
    JSON.stringify(settings)
  );

  // Close modal
  closeModal("rpc-prompt-modal");

  // Restart the search
  if (document.getElementById("tokens-tab").classList.contains("active")) {
    searchTokens();
  } else {
    searchNFTs();
  }
}

// Close modal
function closeModal(modalId) {
  document.getElementById(modalId).style.display = "none";
}

// Load settings from localStorage
function loadSettings() {
  const savedSettings = localStorage.getItem("solanaWalletSearcherSettings");

  if (savedSettings) {
    try {
      // Parse saved settings
      const parsedSettings = JSON.parse(savedSettings);

      // Check if a custom RPC is set when required
      if (
        DEFAULT_RPC_REQUIRED &&
        (!parsedSettings.rpcUrl || parsedSettings.rpcUrl === DEFAULT_RPC_URL)
      ) {
        // No valid custom RPC, reset promptShown to false to force the prompt
        settings = {
          rpcUrl: DEFAULT_RPC_URL,
          promptShown: false,
        };
      } else {
        // Make sure we have all expected properties
        settings = {
          rpcUrl: parsedSettings.rpcUrl || DEFAULT_RPC_URL,
          promptShown: parsedSettings.promptShown === true, // Ensure boolean value
        };
      }
    } catch (error) {
      console.error("Error parsing settings from localStorage:", error);

      // Reset to defaults if there's an error
      settings = {
        rpcUrl: DEFAULT_RPC_URL,
        promptShown: false,
      };
    }
  } else {
    settings = {
      rpcUrl: DEFAULT_RPC_URL,
      promptShown: false,
    };
  }
}

// Main function to search for tokens
async function searchTokens() {
  if (window.isProcessing) return;
  window.isProcessing = true;

  // Clear previous results
  window.tokenResults = [];
  document.getElementById("tokens-result").style.display = "none";
  document.getElementById("tokens-result-container").innerHTML = "";
  document.getElementById("error-message").style.display = "none";
  document.getElementById("success-message").style.display = "none";

  // Show loader
  document.getElementById("loader").style.display = "block";

  // SIMPLE CHECK: See if we have a valid custom RPC in localStorage
  let hasCustomRpc = false;
  const savedSettings = localStorage.getItem("solanaWalletSearcherSettings");

  if (savedSettings) {
    try {
      const parsedSettings = JSON.parse(savedSettings);
      if (
        parsedSettings &&
        parsedSettings.rpcUrl &&
        parsedSettings.rpcUrl.trim() !== ""
      ) {
        // Found a non-empty RPC URL in settings
        if (parsedSettings.rpcUrl.startsWith("http")) {
          hasCustomRpc = true;
          window.settings.rpcUrl = parsedSettings.rpcUrl;
        }
      }
    } catch (error) {
      console.error("Error parsing settings:", error);
    }
  }

  // If custom RPC is required but not found, show prompt and exit
  if (DEFAULT_RPC_REQUIRED && !hasCustomRpc) {
    window.showRPCPrompt();
    document.getElementById("loader").style.display = "none";
    window.isProcessing = false;
    return;
  }

  // Constants
  const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // USDC token address
  const MIN_TOKEN_AMOUNT = 0.000001; // Minimum amount to show
  const MIN_USDC_VALUE = 0.01; // Minimum USDC value to show
  const JUPITER_API_BASE_URL = "https://lite-api.jup.ag/swap/v1"; // Jupiter API
  const API_REQUEST_DELAY = 500; // Delay between API requests in ms
  const WALLET_PROCESSING_DELAY = 500; // Delay between processing wallets (0.5 seconds)

  // Check if we should display small balances
  const displaySmallBalances = document.getElementById("displaySmallBalances")
    ? document.getElementById("displaySmallBalances").checked
    : false;

  try {
    // Get wallet addresses
    window.walletAddresses = await window.getWalletAddresses();

    if (window.walletAddresses.length === 0) {
      throw new Error("Please enter at least one wallet address");
    }

    // Get specific token addresses (if applicable)
    const showAllTokens = document.getElementById("showAllTokens").checked;
    let specificTokens = [];

    if (!showAllTokens) {
      const tokenAddressesInput =
        document.getElementById("tokenAddresses").value;
      specificTokens = tokenAddressesInput
        .split(/[\r\n]+/)
        .filter((address) => address.trim() !== "")
        .map((address) => address.trim());

      if (specificTokens.length === 0) {
        throw new Error(
          "Please enter at least one token address or select 'Show all non-zero token balances'"
        );
      }
    }

    // Create Solana connection with explicit RPC URL
    const rpcUrl = window.settings.rpcUrl;
    // Create connection with explicit URL parameter
    const connection = new solanaWeb3.Connection(rpcUrl, "confirmed");

    // Test the connection to verify it's working with the correct RPC
    try {
      const slot = await connection.getSlot();
    } catch (connError) {
      console.error("Connection test failed:", connError);
      throw new Error(`Failed to connect to RPC: ${connError.message}`);
    }

    // Show progress bar
    document.getElementById("progress-container").style.display = "block";
    document.getElementById(
      "progress-text"
    ).textContent = `0/${window.walletAddresses.length}`;
    document.getElementById("progress-bar").style.width = "0%";

    // Create a map to track wallet balances for sorting later
    const walletTotalUsdValues = {};

    // Process each wallet address
    for (let i = 0; i < window.walletAddresses.length; i++) {
      try {
        const walletAddress = window.walletAddresses[i].trim();

        // Initialize wallet's total USDC value
        walletTotalUsdValues[walletAddress] = 0;

        // Create wallet public key
        const walletPublicKey = new solanaWeb3.PublicKey(walletAddress);

        // Get SOL balance
        try {
          const solBalance = await connection.getBalance(walletPublicKey);
          const solBalanceInSol = solBalance / 1000000000; // Convert lamports to SOL

          // Add SOL balance to results
          window.tokenResults.push({
            walletAddress,
            tokenAddress: "So11111111111111111111111111111111111111112", // Native SOL wrapped address
            tokenName: "Solana",
            symbol: "SOL",
            logo: null,
            balance: solBalance.toString(),
            decimals: 9,
            amountFloat: solBalanceInSol,
            usdcValue: null, // Will be populated later
            isNativeSol: true,
          });

          // Get SOL price in USDC
          try {
            // Add small delay before API call
            await new Promise((resolve) =>
              setTimeout(resolve, API_REQUEST_DELAY)
            );

            const solUsdcValue = await getTokenUsdcValue(
              "So11111111111111111111111111111111111111112",
              "1000000000", // 1 SOL in lamports
              9
            );

            if (solUsdcValue) {
              // Calculate total SOL value
              const totalSolValue = solBalanceInSol * solUsdcValue;

              // Update the SOL entry in results
              const solEntry = window.tokenResults.find(
                (t) => t.walletAddress === walletAddress && t.isNativeSol
              );

              if (solEntry) {
                solEntry.usdcValue = totalSolValue;
                // Add to wallet's total USDC value
                walletTotalUsdValues[walletAddress] += totalSolValue;
              }
            }
          } catch (solPriceError) {
            console.warn("Failed to get SOL price:", solPriceError);
          }
        } catch (solBalanceError) {
          console.error("Error getting SOL balance:", solBalanceError);
        }

        // If specific tokens are provided and not showing all tokens
        if (!showAllTokens && specificTokens.length > 0) {
          // Process each specific token
          for (const specificToken of specificTokens) {
            try {
              const tokenMintPubkey = new solanaWeb3.PublicKey(specificToken);
              // Using mint parameter to filter by specific token mint
              const tokenAccounts =
                await connection.getParsedTokenAccountsByOwner(
                  walletPublicKey,
                  { mint: tokenMintPubkey }
                );

              // Process each token account
              for (const account of tokenAccounts.value) {
                try {
                  // Extract data using the expected structure
                  const parsedInfo = account.account.data.parsed.info;
                  const mintAddress = parsedInfo.mint;
                  const tokenAmount = parsedInfo.tokenAmount;
                  const decimals = parseInt(tokenAmount.decimals);

                  // Skip tokens with 0 decimals (likely NFTs)
                  if (decimals === 0) {
                    continue;
                  }

                  // Convert token amount to a readable format
                  const amountBigInt = BigInt(tokenAmount.amount);
                  const amountFloat =
                    Number(amountBigInt) / Math.pow(10, decimals);

                  // Skip tokens with very small balances unless displaySmallBalances is enabled
                  if (!displaySmallBalances && amountFloat < MIN_TOKEN_AMOUNT) {
                    continue;
                  }

                  // Get token metadata using our service
                  const metadata = await TokenService.getTokenMetadata(
                    connection,
                    mintAddress
                  );

                  // Add small delay before price API call
                  await new Promise((resolve) =>
                    setTimeout(resolve, API_REQUEST_DELAY)
                  );

                  // Get token price data if not USDC
                  let usdcValue = null;
                  if (mintAddress !== USDC_MINT && amountFloat > 0) {
                    try {
                      // Get price quote from Jupiter
                      usdcValue = await getTokenUsdcValue(
                        mintAddress,
                        amountBigInt.toString(),
                        decimals
                      );

                      // Skip tokens with value less than $0.01 USDC unless displaySmallBalances is enabled
                      if (!displaySmallBalances && usdcValue < MIN_USDC_VALUE) {
                        continue;
                      }

                      // Add to wallet's total USDC value
                      if (usdcValue) {
                        walletTotalUsdValues[walletAddress] += usdcValue;
                      }
                    } catch (priceError) {
                      console.warn(
                        `Failed to get price for token ${mintAddress}:`,
                        priceError
                      );
                      // If we can't get price and displaySmallBalances is not enabled, skip this token
                      if (!displaySmallBalances) {
                        continue;
                      }
                    }
                  } else if (mintAddress === USDC_MINT) {
                    // If this is USDC, value is just the amount
                    usdcValue = amountFloat;

                    // Skip USDC with value less than $0.01 unless displaySmallBalances is enabled
                    if (!displaySmallBalances && usdcValue < MIN_USDC_VALUE) {
                      continue;
                    }

                    // Add to wallet's total USDC value
                    if (usdcValue) {
                      walletTotalUsdValues[walletAddress] += usdcValue;
                    }
                  }

                  // Add to token results
                  window.tokenResults.push({
                    walletAddress,
                    tokenAddress: mintAddress,
                    tokenName: metadata.name || "Unknown",
                    symbol: metadata.symbol || "Unknown",
                    logo: metadata.logo,
                    balance: tokenAmount.amount,
                    decimals: tokenAmount.decimals,
                    amountFloat: amountFloat,
                    usdcValue: usdcValue,
                  });
                } catch (parseError) {
                  console.error("Error parsing token account:", parseError);
                }
              }
            } catch (tokenError) {
              console.error(
                `Error processing specific token ${specificToken}:`,
                tokenError
              );
            }
          }
        } else {
          // Show all tokens logic (original code)
          const TOKEN_PROGRAM_ID =
            "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
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
              const decimals = parseInt(tokenAmount.decimals);

              // Skip zero balances if showing all tokens
              if (showAllTokens && tokenAmount.amount === "0") {
                continue;
              }

              // Skip tokens with 0 decimals (likely NFTs)
              if (decimals === 0) {
                continue;
              }

              // Convert token amount to a readable format
              const amountBigInt = BigInt(tokenAmount.amount);
              const amountFloat = Number(amountBigInt) / Math.pow(10, decimals);

              // Skip tokens with very small balances unless displaySmallBalances is enabled
              if (!displaySmallBalances && amountFloat < MIN_TOKEN_AMOUNT) {
                continue;
              }

              // Get token metadata using our service
              const metadata = await TokenService.getTokenMetadata(
                connection,
                mintAddress
              );

              // Add small delay before price API call
              await new Promise((resolve) =>
                setTimeout(resolve, API_REQUEST_DELAY)
              );

              // Get token price data if not USDC
              let usdcValue = null;
              if (mintAddress !== USDC_MINT && amountFloat > 0) {
                try {
                  // Get price quote from Jupiter
                  usdcValue = await getTokenUsdcValue(
                    mintAddress,
                    amountBigInt.toString(),
                    decimals
                  );

                  // Skip tokens with value less than $0.01 USDC unless displaySmallBalances is enabled
                  if (!displaySmallBalances && usdcValue < MIN_USDC_VALUE) {
                    continue;
                  }

                  // Add to wallet's total USDC value
                  if (usdcValue) {
                    walletTotalUsdValues[walletAddress] += usdcValue;
                  }
                } catch (priceError) {
                  console.warn(
                    `Failed to get price for token ${mintAddress}:`,
                    priceError
                  );
                  // If we can't get price and displaySmallBalances is not enabled, skip this token
                  if (!displaySmallBalances) {
                    continue;
                  }
                }
              } else if (mintAddress === USDC_MINT) {
                // If this is USDC, value is just the amount
                usdcValue = amountFloat;

                // Skip USDC with value less than $0.01 unless displaySmallBalances is enabled
                if (!displaySmallBalances && usdcValue < MIN_USDC_VALUE) {
                  continue;
                }

                // Add to wallet's total USDC value
                if (usdcValue) {
                  walletTotalUsdValues[walletAddress] += usdcValue;
                }
              }

              // Add to token results
              window.tokenResults.push({
                walletAddress,
                tokenAddress: mintAddress,
                tokenName: metadata.name || "Unknown",
                symbol: metadata.symbol || "Unknown",
                logo: metadata.logo,
                balance: tokenAmount.amount,
                decimals: tokenAmount.decimals,
                amountFloat: amountFloat,
                usdcValue: usdcValue,
              });
            } catch (parseError) {
              console.error("Error parsing token account:", parseError);
            }
          }
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

      // Add delay between processing wallets to avoid rate limits
      if (i < window.walletAddresses.length - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, WALLET_PROCESSING_DELAY)
        );
      }
    }

    // Calculate total USDC value for each wallet (for display)
    window.walletTotalValues = walletTotalUsdValues;

    // Sort results by USDC value (if available)
    window.tokenResults.sort((a, b) => {
      // Handle error entries (always at the bottom)
      if (a.error) return 1;
      if (b.error) return -1;

      // Sort by wallet address and total value
      const walletA = a.walletAddress;
      const walletB = b.walletAddress;

      // Compare total wallet values
      const totalValueA = walletTotalUsdValues[walletA] || 0;
      const totalValueB = walletTotalUsdValues[walletB] || 0;

      // Sort wallets by total value, then by tokens within the same wallet
      if (walletA !== walletB) {
        return totalValueB - totalValueA; // Sort wallets by descending total value
      }

      // For tokens in the same wallet, keep SOL at the top, then sort by value
      if (a.isNativeSol) return -1;
      if (b.isNativeSol) return 1;

      // Handle missing USDC values
      const aValue = a.usdcValue !== null ? a.usdcValue : 0;
      const bValue = b.usdcValue !== null ? b.usdcValue : 0;

      // Sort descending (highest value first)
      return bValue - aValue;
    });

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

/**
 * Get token value in USDC
 * @param {string} inputMint - Token mint address
 * @param {string} amount - Token amount in smallest units (lamports)
 * @param {number} decimals - Token decimals
 * @returns {Promise<number>} - USDC value of the token amount
 */
async function getTokenUsdcValue(inputMint, amount, decimals) {
  const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const JUPITER_API_BASE_URL = "https://lite-api.jup.ag/swap/v1";

  try {
    // Build query parameters
    const params = new URLSearchParams({
      inputMint: inputMint,
      outputMint: USDC_MINT,
      amount: amount,
      slippageBps: 50, // 0.5% slippage tolerance
    });

    const url = `${JUPITER_API_BASE_URL}/quote?${params.toString()}`;
    console.log(`Requesting Jupiter quote from: ${url}`);

    // Set timeout to prevent long-hanging requests
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`Jupiter API returned status: ${response.status}`);
      throw new Error(`Jupiter API error: ${response.status}`);
    }

    const quoteResponse = await response.json();

    // Check if the response has the expected properties
    if (!quoteResponse.outAmount) {
      console.warn(
        "Jupiter API response missing outAmount property:",
        quoteResponse
      );
      return null;
    }

    // Calculate USDC value (convert from smallest units to USDC)
    const outAmount = BigInt(quoteResponse.outAmount);
    const usdcValue = Number(outAmount) / Math.pow(10, 6); // USDC has 6 decimals

    console.log(`Token USDC value calculated: ${usdcValue}`);
    return usdcValue;
  } catch (error) {
    console.warn(`Error getting Jupiter quote: ${error.message}`);
    return null; // Return null instead of throwing
  }
}

if (typeof TokenService !== "undefined") {
  TokenService.searchTokens = searchTokens;
} else {
  window.TokenService = {
    searchTokens: searchTokens,
  };
}

// Download CSV functionality
function downloadCSV(type) {
  let data, filename;

  if (type === "tokens") {
    // Access the window.tokenResults directly to ensure we have the data
    data = window.tokenResults;
    filename = "solana_token_results.csv";

    if (!data || data.length === 0) {
      alert("No token data to download");
      return;
    }

    // Create CSV content - match the display order in the table
    let csvContent =
      "Wallet Address,Symbol,Token Name,Token Address,Balance,USDC Value\n";

    data.forEach((result) => {
      if (result.error) {
        csvContent += `${result.walletAddress},"Error: ${result.error}",,,,\n`;
      } else {
        const formattedBalance = formatTokenBalance(
          result.balance,
          result.decimals
        );
        const formattedValue =
          result.usdcValue !== null ? result.usdcValue.toFixed(2) : "N/A";
        csvContent += `${result.walletAddress},${result.symbol || "Unknown"},"${
          result.tokenName || "Unknown"
        }",${result.tokenAddress},${formattedBalance},${formattedValue}\n`;
      }
    });

    // Create and download the file
    downloadFile(csvContent, filename);
  } else if (type === "nfts") {
    // Access the window.nftResults directly to ensure we have the data
    data = window.nftResults;
    filename = "solana_nft_results.csv";

    if (!data || data.length === 0) {
      alert("No NFT data to download");
      return;
    }

    // Create CSV content - match the display order in the table
    let csvContent =
      "Wallet Address,Collection Address,Collection Name,NFT Name,NFT Address\n";

    data.forEach((result) => {
      if (result.error) {
        csvContent += `${result.walletAddress},"Error: ${result.error}",,,,\n`;
      } else {
        csvContent += `${result.walletAddress},${
          result.collectionAddress || "N/A"
        },"${result.collectionName || "Unknown"}","${
          result.nftName || "Unknown"
        }",${result.nftAddress}\n`;
      }
    });

    // Create and download the file
    downloadFile(csvContent, filename);
  }
}

async function searchNFTs() {
  // Use a specific flag to prevent infinite recursion
  if (window.isNFTProcessing) {
    return;
  }

  window.isNFTProcessing = true;

  // Clear previous results
  window.nftResults = []; // Make sure we're using window.nftResults
  document.getElementById("nfts-result").style.display = "none";
  document.getElementById("nfts-result-container").innerHTML = "";
  document.getElementById("nft-error-message").style.display = "none";
  document.getElementById("nft-success-message").style.display = "none";

  // Show loader
  document.getElementById("nft-loader").style.display = "block";

  // SIMPLE CHECK: See if we have a valid custom RPC in localStorage
  let hasCustomRpc = false;
  const savedSettings = localStorage.getItem("solanaWalletSearcherSettings");

  if (savedSettings) {
    try {
      const parsedSettings = JSON.parse(savedSettings);
      if (
        parsedSettings &&
        parsedSettings.rpcUrl &&
        parsedSettings.rpcUrl.trim() !== ""
      ) {
        // Found a non-empty RPC URL in settings
        if (parsedSettings.rpcUrl.startsWith("http")) {
          hasCustomRpc = true;
          window.settings.rpcUrl = parsedSettings.rpcUrl;
        }
      }
    } catch (error) {
      console.error("Error parsing settings:", error);
    }
  }

  // If custom RPC is required but not found, show prompt and exit
  if (DEFAULT_RPC_REQUIRED && !hasCustomRpc) {
    window.showRPCPrompt();
    document.getElementById("nft-loader").style.display = "none";
    window.isNFTProcessing = false;
    return;
  }

  try {
    // Constants
    const WALLET_PROCESSING_DELAY = 1500; // Delay between processing wallets (1.5 seconds)

    // Get wallet addresses
    window.walletAddresses = await window.getWalletAddresses();
    if (window.walletAddresses.length === 0) {
      throw new Error("Please enter at least one wallet address");
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

    // Check if Metaplex libraries are available
    if (!window.metaplex || !window.metaplex.Metaplex) {
      throw new Error(
        "Metaplex libraries not found. Please refresh the page and try again."
      );
    }

    // Create a map to track wallet NFT counts for sorting
    const walletNftCounts = {};

    // Create a Metaplex instance with our validated RPC URL
    const metaplex = window.metaplex.Metaplex.make(
      new solanaWeb3.Connection(window.settings.rpcUrl, "confirmed")
    );

    // Process each wallet address
    for (let i = 0; i < window.walletAddresses.length; i++) {
      try {
        const walletAddress = window.walletAddresses[i].trim();
        // Initialize wallet's NFT count
        walletNftCounts[walletAddress] = 0;
        // Create wallet public key
        const walletPublicKey = new solanaWeb3.PublicKey(walletAddress);

        // Fetch NFTs using Metaplex JS SDK
        const nfts = await metaplex
          .nfts()
          .findAllByOwner({ owner: walletPublicKey });

        // Filter by collection if needed
        let filteredNfts = nfts;
        if (!showAllNFTs && specificCollections.length > 0) {
          filteredNfts = nfts.filter((nft) => {
            const collectionAddress = nft.collection?.address?.toString();
            return (
              collectionAddress &&
              specificCollections.includes(collectionAddress)
            );
          });
        }

        // Update NFT count for wallet (for sorting)
        walletNftCounts[walletAddress] = filteredNfts.length;

        // Process each NFT
        for (const nft of filteredNfts) {
          try {
            // Get collection info if available
            let collectionName = "Unknown Collection";
            let collectionAddress = null;

            if (nft.collection?.address) {
              collectionAddress = nft.collection.address.toString();
              try {
                // Try to get collection NFT details
                const collectionNft = await metaplex.nfts().findByMint({
                  mintAddress: nft.collection.address,
                });
                if (collectionNft) {
                  collectionName = collectionNft.name || "Unknown Collection";
                }
              } catch (collErr) {
                console.warn(
                  `Error fetching collection details: ${collErr.message}`
                );
              }
            }

            // Add to results
            window.nftResults.push({
              walletAddress,
              nftAddress: nft.mintAddress.toString(),
              nftName: nft.name || `NFT #${window.nftResults.length + 1}`,
              collectionAddress,
              collectionName,
            });
          } catch (nftError) {
            console.error(`Error processing NFT: ${nftError.message}`);
          }
        }
      } catch (walletError) {
        console.error(`Error processing wallet:`, walletError);
        // Add error result
        window.nftResults.push({
          walletAddress: window.walletAddresses[i],
          error: walletError.message,
        });
      }

      // Update progress
      document.getElementById("nft-progress-text").textContent = `${i + 1}/${
        window.walletAddresses.length
      }`;
      document.getElementById("nft-progress-bar").style.width = `${
        ((i + 1) / window.walletAddresses.length) * 100
      }%`;

      // Add delay between processing wallets to avoid rate limits
      if (i < window.walletAddresses.length - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, WALLET_PROCESSING_DELAY)
        );
      }
    }

    // Store NFT counts for display
    window.walletNftCounts = walletNftCounts;

    // Sort NFT results by wallet with most NFTs
    window.nftResults.sort((a, b) => {
      // Handle error entries (always at the bottom)
      if (a.error) return 1;
      if (b.error) return -1;

      // Sort by wallet address and NFT count
      const walletA = a.walletAddress;
      const walletB = b.walletAddress;

      // Compare wallet NFT counts
      const countA = walletNftCounts[walletA] || 0;
      const countB = walletNftCounts[walletB] || 0;

      // Sort wallets by NFT count, then alphabetically for NFTs within the same wallet
      if (walletA !== walletB) {
        return countB - countA; // Sort wallets by descending NFT count
      }

      // For NFTs in the same wallet, sort by collection name then NFT name
      if (a.collectionName !== b.collectionName) {
        return a.collectionName.localeCompare(b.collectionName);
      }

      return a.nftName.localeCompare(b.nftName);
    });

    // Make sure we're calling the correct display function with the right array
    if (window.nftResults.length > 0) {
      window.displayNFTResults();
    } else {
      console.warn("No NFTs found to display");
      document.getElementById("nfts-result-container").innerHTML =
        "<p>No NFTs found.</p>";
      document.getElementById("nfts-result").style.display = "block";
    }

    // Show success message
    const successMessage =
      window.walletAddresses.length === 1
        ? "Successfully processed 1 wallet address."
        : `Successfully processed ${window.walletAddresses.length} wallet addresses.`;
    document.getElementById("nft-success-message").textContent = successMessage;
    document.getElementById("nft-success-message").style.display = "block";
  } catch (error) {
    console.error("Error searching NFTs:", error);
    document.getElementById("nft-error-message").textContent = error.message;
    document.getElementById("nft-error-message").style.display = "block";
  } finally {
    // Hide loader and progress
    document.getElementById("nft-loader").style.display = "none";
    document.getElementById("nft-progress-container").style.display = "none";
    window.isNFTProcessing = false;
  }
}

if (typeof NFTService !== "undefined") {
  NFTService.searchNFTs = searchNFTs;
} else {
  window.NFTService = {
    searchNFTs: searchNFTs,
  };
}

// Function to view token on Solscan
function viewTokenOnSolscan(walletAddress, tokenMintAddress) {
  if (typeof TokenService !== "undefined" && TokenService.viewTokenOnSolscan) {
    TokenService.viewTokenOnSolscan(walletAddress, tokenMintAddress);
  } else {
    // Fallback to direct link if service is not available
    window.open(`https://solscan.io/token/${tokenMintAddress}`, "_blank");
  }
}

async function validateRpcUrl(url) {
  try {
    // Create a connection with the URL
    const connection = new solanaWeb3.Connection(url, "confirmed");
    // Try to get the current slot as a basic test
    const slot = await connection.getSlot();
    return true;
  } catch (error) {
    console.error("RPC validation failed:", error);
    return false;
  }
}

// Make variables and functions available to other scripts
window.displayTokenResults = displayTokenResults;
window.displayNFTResults = displayNFTResults;
window.getWalletAddresses = getWalletAddresses;
window.showRPCPrompt = showRPCPrompt;
window.settings = settings;
window.tokenResults = tokenResults;
window.nftResults = nftResults;
window.walletAddresses = walletAddresses;
window.isProcessing = isProcessing;
window.DEFAULT_RPC_URL = DEFAULT_RPC_URL;
window.RPC_DELAY_MS = RPC_DELAY_MS;
window.searchTokens = searchTokens;
window.getTokenUsdcValue = getTokenUsdcValue;
window.downloadCSV = downloadCSV;
window.searchNFTs = searchNFTs;
window.createTokenTableRow = createTokenTableRow;
window.createNFTTableRow = createNFTTableRow;

# Solana Wallet Searcher

A single-page web application for searching Solana wallet token balances and NFT collections.

## Overview

Solana Wallet Searcher allows users to quickly search for token and NFT holdings across multiple Solana wallet addresses. The tool provides a simple, intuitive interface for exploring wallet contents with features for filtering, organizing, and exporting results.

## Features

### Token Search

- View all non-zero token balances in a wallet
- Filter for specific token addresses
- Show or hide small balances (less than $0.01)
- View token values in USDC
- Group results by wallet or view all tokens in a single table

### NFT Search

- View all NFTs owned by a wallet
- Filter for specific NFT collections
- Group results by wallet or view all NFTs in a single table

### Additional Features

- Process multiple wallet addresses simultaneously
- Bulk upload wallet addresses from TXT or CSV files
- Download search results as CSV
- View tokens/NFTs on Solscan with a single click
- Copy token/NFT addresses with a single click
- Customizable RPC endpoint for improved performance

## Getting Started

### Prerequisites

- Modern web browser (Chrome, Firefox, Safari, Edge)
- **Required**: A custom Solana RPC URL (the public Solana RPC does not support the necessary methods)

### Usage

1. **Enter Wallet Addresses**:

   - Type or paste Solana wallet addresses (one per line) in the input field
   - Or upload a TXT/CSV file containing wallet addresses (one per line)

2. **Select Search Type**:

   - Choose the "Tokens" tab to search for token balances
   - Choose the "NFTs" tab to search for NFT holdings

3. **Configure Search Options**:

   - Token search: Toggle options to show all non-zero balances, show small balances, and group by wallet
   - NFT search: Toggle options to show all NFTs and group by wallet

4. **Set Custom RPC** (Recommended):

   - Click the settings gear icon in the top right
   - Enter a custom RPC URL for faster performance
   - Free RPC URLs are available from services like Helius, QuickNode, or Alchemy

5. **Perform Search**:

   - Click "Search Tokens" or "Search NFTs" to begin the search
   - Progress bar will display search status

6. **Explore Results**:

   - View token balances with USDC values
   - View NFT collections and individual NFTs
   - Click the eye icon to view on Solscan
   - Click the copy icon to copy addresses to clipboard

7. **Export Results**:
   - Click "Download CSV" to export search results to a CSV file

## Implementation Details

### Performance Considerations

- Caching system for token metadata to minimize redundant API calls
- Progress tracking for multiple wallet operations

## Customization

### Custom RPC Endpoints

The application requires a custom RPC endpoint as the public Solana RPC does not support the necessary methods for token and NFT queries. Users must provide their own RPC endpoint from providers like:

- [Helius](https://www.helius.dev/)
- [QuickNode](https://www.quicknode.com/)
- [Alchemy](https://www.alchemy.com/solana)

## Limitations

- NFT metadata retrieval depends on proper on-chain metadata standards
- Token price data may not be available for all tokens
- Performance depends on the quality and rate limits of your custom RPC provider

## License

This project is licensed under the MIT License. See the LICENSE file for details.

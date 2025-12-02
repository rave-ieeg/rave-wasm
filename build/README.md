# Code Signing and Notarization for macOS

## Prerequisites

1. **Apple Developer Account** ($99/year): https://developer.apple.com
2. **Developer ID Certificate**: Download from Apple Developer portal
3. **App-Specific Password**: Generate at appleid.apple.com

## Setup

1. Install the notarization dependency:
   ```bash
   npm install
   ```

2. Set environment variables (add to `~/.zshrc` or export before building):
   ```bash
   export APPLE_ID="your-apple-id@email.com"
   export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
   export APPLE_TEAM_ID="YOUR_TEAM_ID"
   ```

3. Build the app:
   ```bash
   npm run build:mac
   ```

## Without Signing

If you don't have an Apple Developer account, the current build will work but:
- Users must right-click → Open to bypass Gatekeeper
- Not recommended for public distribution
- Good for internal testing

The notarization will be automatically skipped if environment variables are not set.

## Files

- `build/entitlements.mac.plist` - Required for hardened runtime
- `build/notarize.js` - Notarization script (auto-runs after signing)

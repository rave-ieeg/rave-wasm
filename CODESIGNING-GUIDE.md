# Complete Code Signing and Notarization Guide for macOS

## Prerequisites
- Active Apple Developer Account ($99/year)
- macOS computer
- Xcode or Xcode Command Line Tools installed

## Part 1: Get Your Developer ID Certificate

### Step 1: Check if You Already Have a Certificate

Open Terminal and run:
```bash
security find-identity -v -p codesigning
```

Look for a line that says **"Developer ID Application: Your Name (TEAM_ID)"**. If you see this, skip to **Part 2**.

### Step 2: Request a Certificate from Apple

#### Option A: Using Xcode (Recommended)

1. Open **Xcode**
2. Go to **Xcode** → **Settings** (or Preferences in older versions)
3. Click the **Accounts** tab
4. Click the **+** button to add your Apple ID if not already added
5. Select your Apple ID and click **Manage Certificates...**
6. Click the **+** button in the bottom left
7. Select **Developer ID Application**
8. Xcode will automatically request and install the certificate

#### Option B: Using Keychain Access (Manual Method)

1. Open **Keychain Access** (Applications → Utilities → Keychain Access)
2. Go to **Keychain Access** → **Certificate Assistant** → **Request a Certificate from a Certificate Authority**
3. Fill in the form:
   - **User Email Address**: Your email (must match your Apple Developer account email)
   - **Common Name**: Your name or company name
   - **CA Email Address**: Leave blank
   - Select **"Saved to disk"**
   - Check **"Let me specify key pair information"**
4. Click **Continue**
5. Save the file (e.g., `CertificateSigningRequest.certSigningRequest`)
6. In the next screen, choose:
   - **Key Size**: 2048 bits
   - **Algorithm**: RSA
7. Click **Continue**

### Step 3: Create Certificate on Apple Developer Portal

1. Go to https://developer.apple.com/account/resources/certificates/list
2. Click the **+** button to create a new certificate
3. Under **Software**, select **Developer ID Application**
4. Click **Continue**
5. Upload the `.certSigningRequest` file you created in Step 2
6. Click **Continue**
7. Download the certificate file (e.g., `developerID_application.cer`)

### Step 4: Install the Certificate

1. Double-click the downloaded `.cer` file
2. **Keychain Access** will open
3. The certificate will be added to your **login** keychain
4. Verify it's installed:
   ```bash
   security find-identity -v -p codesigning
   ```
   You should see: **"Developer ID Application: Your Name (TEAM_ID)"**

### Step 5: Get Your Team ID

1. Go to https://developer.apple.com/account
2. Click **Membership** in the sidebar
3. Note your **Team ID** (10-character alphanumeric code)
4. Save this - you'll need it for notarization

## Part 2: Generate App-Specific Password for Notarization

### Step 1: Create App-Specific Password

1. Go to https://appleid.apple.com
2. Sign in with your Apple ID
3. In the **Security** section, find **App-Specific Passwords**
4. Click **Generate Password** (or the **+** button)
5. Enter a label like "Electron Notarization"
6. Click **Create**
7. **IMPORTANT**: Copy the password immediately (format: `xxxx-xxxx-xxxx-xxxx`)
8. Save it securely - you won't be able to see it again

## Part 3: Configure Your Environment

### Step 1: Create Environment Variables File

Create a file to store your credentials (don't commit this to git):

```bash
# Create .env file in your project root
cat > .env << 'EOF'
export APPLE_ID="your-apple-id@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="YOUR10DIGITTEAMID"
EOF
```

Replace the placeholder values with your actual credentials.

### Step 2: Add .env to .gitignore

```bash
echo ".env" >> .gitignore
```

### Step 3: Source the Environment Variables

Before building, load the credentials:
```bash
source .env
```

Or export them directly in your terminal:
```bash
export APPLE_ID="your-apple-id@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="YOUR10DIGITTEAMID"
```

## Part 4: Build, Sign, and Notarize

### Step 1: Build Your App

```bash
# Source your environment variables first
source .env

# Build for Mac (both Intel and Apple Silicon)
npm run build:mac

# Or build for specific architecture:
npm run build:mac:arm64  # Apple Silicon only
npm run build:mac:x64    # Intel only
```

### Step 2: What Happens During Build

The build process will automatically:
1. **Compile** your Electron app
2. **Sign** the app with your Developer ID certificate (from Keychain)
3. **Notarize** the app with Apple (uploads to Apple, waits for approval)
4. **Staple** the notarization ticket to the app

This can take 5-15 minutes depending on Apple's server load.

### Step 3: Monitor the Process

You'll see output like:
```
  • signing         file=dist/mac-arm64/RAVE Widgets.app
  • notarizing      file=dist/mac-arm64/RAVE Widgets.app
  • notarization successful
  • stapling        file=dist/mac-arm64/RAVE Widgets.app
```

## Part 5: Verify Your Signed App

### Verify Code Signature

```bash
# Check if the app is signed
codesign --verify --deep --strict --verbose=2 "dist/mac-arm64/RAVE Widgets.app"

# Should output:
# dist/mac-arm64/RAVE Widgets.app: valid on disk
# dist/mac-arm64/RAVE Widgets.app: satisfies its Designated Requirement
```

### Verify Notarization

```bash
# Check if notarization is stapled
stapler validate "dist/mac-arm64/RAVE Widgets.app"

# Should output:
# The validate action worked!
```

### Verify Gatekeeper Approval

```bash
# Check if macOS will allow the app to run
spctl -a -vvv -t install "dist/mac-arm64/RAVE Widgets.app"

# Should output:
# dist/mac-arm64/RAVE Widgets.app: accepted
# source=Notarized Developer ID
```

## Part 6: Distribute Your App

Your signed and notarized app is in the `dist` folder:
- **DMG**: `dist/RAVE Widgets-1.0.0-arm64.dmg` (or x64)
- **ZIP**: `dist/RAVE Widgets-1.0.0-arm64-mac.zip`

Users can now download and run your app without Gatekeeper warnings!

## Troubleshooting

### "No identity found" Error

**Problem**: `security find-identity` doesn't show your certificate

**Solution**:
1. Make sure you installed the certificate by double-clicking the `.cer` file
2. Check it's in your login keychain (open Keychain Access, select "login" on left)
3. The certificate should show as "Developer ID Application: Your Name"

### "Authentication failed" During Notarization

**Problem**: Notarization fails with authentication error

**Solution**:
1. Verify your APPLE_ID is correct
2. Regenerate your app-specific password
3. Make sure you're using app-specific password, NOT your Apple ID password
4. Check your APPLE_TEAM_ID matches the one in your developer account

### Certificate "Not Trusted"

**Problem**: Certificate shows as not trusted in Keychain

**Solution**:
1. Make sure you have the Apple intermediate certificates
2. Download from: https://www.apple.com/certificateauthority/
3. Install "Developer ID - G1" and "Apple Worldwide Developer Relations" certificates

### Build Succeeds but Notarization is Skipped

**Problem**: App builds but notarization is skipped

**Solution**:
1. Check that environment variables are set: `echo $APPLE_ID`
2. Make sure you sourced the .env file: `source .env`
3. The notarize.js script will skip if variables aren't set

### "resource fork, Finder information, or similar detritus not allowed"

**Problem**: Notarization fails with this error

**Solution**:
```bash
# Clean extended attributes from your files
xattr -cr site/
```

## Testing Locally

To test your signed app locally before distribution:

```bash
# Remove quarantine attribute to simulate downloaded app
xattr -d com.apple.quarantine "dist/mac-arm64/RAVE Widgets.app"

# Or test with quarantine to see what users will experience
# Just double-click the app in Finder
```

## Security Best Practices

1. **Never commit** your app-specific password to version control
2. **Use environment variables** for CI/CD pipelines
3. **Rotate passwords** periodically
4. **Revoke unused** app-specific passwords from appleid.apple.com
5. **Keep certificates** backed up securely

## Additional Resources

- [Apple Code Signing Guide](https://developer.apple.com/support/code-signing/)
- [Notarization Documentation](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
- [electron-builder Code Signing](https://www.electron.build/code-signing)

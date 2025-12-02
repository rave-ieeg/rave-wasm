# RAVE WASM Electron App

This is an Electron desktop application that hosts the RAVE WASM site.

## Prerequisites

- Node.js (v16 or higher)
- npm (comes with Node.js)

## Installation

Install the required dependencies:

```bash
npm install
```

## Running the App

To run the app in development mode:

```bash
npm start
```

## Building the App

To build distributable packages for your current platform:

```bash
npm run build
```

To build for specific platforms:

```bash
# macOS
npm run build:mac

# Windows
npm run build:win

# Linux
npm run build:linux
```

The built applications will be available in the `dist/` folder.

## Project Structure

- `main.js` - Main Electron process, creates the browser window
- `preload.js` - Preload script for secure context bridging
- `site/` - Web application files to be hosted
- `package.json` - Project configuration and dependencies

## Notes

- The app loads `site/index.html` as the entry point
- Web security is enabled for safety
- External links will open in the default system browser
- The app window is set to 1200x800 pixels by default (can be customized in `main.js`)

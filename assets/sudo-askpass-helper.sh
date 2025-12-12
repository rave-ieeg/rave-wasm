#!/bin/bash
# SUDO_ASKPASS helper script
# This script prompts for password using native macOS dialog
# Used by sudo with SUDO_ASKPASS environment variable when elevated privileges needed

/usr/bin/osascript <<'APPLESCRIPT'
tell application "System Events"
    activate
    set dialogResult to display dialog "Administrator privileges required for installation. Please enter your password:" default answer "" with hidden answer buttons {"Cancel", "Continue"} default button 2 cancel button 1
    set the answer to text returned of dialogResult
end tell
APPLESCRIPT

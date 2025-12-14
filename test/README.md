# RAVE R Detection Tests

This directory contains test scripts for validating R installation detection across different platforms and methods.

## Test Files

### 1. `test-r-detector.js`

**Purpose**: Comprehensive test suite for the R detector module

**Tests**:
- Windows Registry detection (HKCU/HKLM priority)
- Common path discovery
- R version validation
- RAVE package detection

**Usage**:
```bash
node test/test-r-detector.js
```

**Expected Output**:
- Registry paths found
- List of paths to check
- Detection status (✓/✗)
- R version if found
- RAVE package versions if installed

---

### 2. `test-r-stdout-stderr.js`

**Purpose**: Verify which output stream R uses for `--version` command

**Background**: On Windows, R sends version information to `stderr` instead of `stdout`, which is different from Unix-like systems. This test helps validate that the detector properly captures both streams.

**Usage**:
```bash
# Use default R path
node test/test-r-stdout-stderr.js

# Or specify custom R path
node test/test-r-stdout-stderr.js "C:\Program Files\R\R-4.5.0\bin\x64\R.exe"
```

**Expected Output**:
- Shows which stream(s) contain version info
- Confirms Windows vs Unix behavior

---

### 3. `test-registry-detection.bat`

**Purpose**: Test Windows Registry-based R detection using native batch script

**Tests**:
- `RSTUDIO_WHICH_R` environment variable
- Registry keys: `HKCU\Software\R-core\R` and `HKCU\Software\R-core\R64`
- Registry keys: `HKLM\Software\R-core\R` and `HKLM\Software\R-core\R64`
- Common installation directories

**Usage**:
```cmd
test\test-registry-detection.bat
```

**Priority Order**:
1. `RSTUDIO_WHICH_R` environment variable
2. `HKCU\Software\R-core\R` (user install, modern)
3. `HKCU\Software\R-core\R64` (user install, legacy)
4. `HKLM\Software\R-core\R` (system install, modern)
5. `HKLM\Software\R-core\R64` (system install, legacy)
6. Common directories: `%LOCALAPPDATA%\Programs\R`, `%ProgramFiles%\R`, etc.

**Expected Output**:
- Step-by-step detection progress
- First found R installation path
- Exit code 0 (success) or 1 (failure)

---

## Detection Logic

### Windows Registry Structure (R 4.3.0+)

R stores installation information in the Windows Registry:

```
HKEY_CURRENT_USER\Software\R-core\R\<version>
    InstallPath = "C:\Users\...\R\R-4.5.0"

HKEY_LOCAL_MACHINE\Software\R-core\R\<version>
    InstallPath = "C:\Program Files\R\R-4.5.0"
```

### Priority Rationale

1. **HKCU before HKLM**: User-level installations are prioritized because they suggest the user may have limited admin access
2. **R before R64**: Modern R (4.3.0+) uses `R-core\R` for all installations; `R64` is legacy
3. **Registry before filesystem**: Registry entries are the official, reliable method on Windows
4. **x64 before i386**: 64-bit is standard since R 4.2.0; 32-bit is legacy

### Binary Path Priority

For each installation found, check in order:
1. `bin\x64\R.exe` - Standard 64-bit (R 4.2+)
2. `bin\R.exe` - Default binary (some installations)
3. `bin\i386\R.exe` - Legacy 32-bit (R < 4.2)

---

## Common Issues

### Issue: R not detected despite being installed

**Causes**:
- R not registered in Windows Registry (manual installation)
- R path not in system PATH
- Portable R installation

**Solution**: Set `RSTUDIO_WHICH_R` environment variable to point to R.exe

### Issue: Wrong R version detected

**Cause**: Multiple R installations, incorrect priority

**Solution**: 
- Uninstall older versions
- Or explicitly set `RSTUDIO_WHICH_R` to desired version

### Issue: Version detection fails but R exists

**Cause**: Detector only checking stdout, not stderr (Windows issue)

**Solution**: Fixed in latest version - both streams now captured

---

## Development Notes

### Testing Changes

After modifying R detection logic:

1. Run all test scripts to verify detection still works
2. Test with and without R in PATH
3. Test with registry entries vs manual installations
4. Test on clean Windows installation if possible

### Adding New Tests

New tests should:
- Follow the naming convention `test-*.js` or `test-*.bat`
- Include clear documentation in file header
- Provide actionable output (not just pass/fail)
- Exit with appropriate codes (0 = success, 1 = failure)

---

## References

- [R for Windows FAQ - Registry](https://cran.r-project.org/bin/windows/base/rw-FAQ.html#Does-R-use-the-Registry_003f)
- [R Installation and Administration](https://cran.r-project.org/doc/manuals/r-release/R-admin.html)
- Related files:
  - `src/plugins/r-plugin/r-detector.js` - Main detector implementation
  - `assets/installer-checklists/installer-windows.yml` - Installation checklist
  - `src/plugins/r-plugin/rave-installer.js` - Installation orchestrator

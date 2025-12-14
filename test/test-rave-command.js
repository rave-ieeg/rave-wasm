/**
 * Print the actual command being used to detect RAVE packages
 */

const RDetector = require('../src/plugins/r-plugin/r-detector.js');
const fs = require('fs');

const mockConfigManager = {
  get: () => null,
  set: () => {},
  save: async () => {}
};

async function printCommand() {
  const detector = new RDetector(mockConfigManager);
  
  // Detect R
  const rResult = await detector.detectR();
  
  if (!rResult.detected) {
    console.log('R not detected');
    return;
  }
  
  const rPath = rResult.path;
  console.log('R Path:', rPath);
  console.log();
  
  // Determine which executable and args will be used
  let rExecutable = rPath;
  const rCode = `
if(require('rave', quietly=TRUE)) {
  cat('RAVE:', as.character(packageVersion('rave')), '\\n')
}
if(require('ravemanager', quietly=TRUE)) {
  cat('RAVEMANAGER:', as.character(packageVersion('ravemanager')), '\\n')
}
`;
  
  let args = ['-e', rCode];
  
  if (process.platform === 'win32' && rPath.match(/R\.exe$/i)) {
    const rscriptPath = rPath.replace(/R\.exe$/i, 'Rscript.exe');
    if (fs.existsSync(rscriptPath)) {
      rExecutable = rscriptPath;
      console.log('Using Rscript.exe (preferred for Windows)');
    } else {
      args = ['-q', '--vanilla', '--slave', '-e', rCode];
      console.log('Rscript.exe not found, falling back to R.exe with flags');
    }
  } else if (process.platform !== 'win32' && rPath.match(/\/R$/)) {
    const rscriptPath = rPath.replace(/\/R$/, '/Rscript');
    if (fs.existsSync(rscriptPath)) {
      rExecutable = rscriptPath;
      console.log('Using Rscript (preferred for Unix)');
    } else {
      args = ['-q', '--vanilla', '--slave', '-e', rCode];
      console.log('Rscript not found, falling back to R with flags');
    }
  }
  
  console.log();
  console.log('='.repeat(70));
  console.log('COMMAND TO RUN:');
  console.log('='.repeat(70));
  console.log();
  
  // Print the command in a format you can copy/paste
  if (process.platform === 'win32') {
    // PowerShell format
    console.log('PowerShell:');
    console.log('& "' + rExecutable + '" ' + args.map(a => {
      if (a.includes('\n') || a.includes(' ') || a.includes('(') || a.includes(')')) {
        return '"' + a.replace(/"/g, '`"').replace(/\$/g, '`$') + '"';
      }
      return a;
    }).join(' '));
    console.log();
    
    // CMD format
    console.log('CMD:');
    console.log('"' + rExecutable + '" ' + args.map(a => {
      if (a.includes('\n') || a.includes(' ') || a.includes('(') || a.includes(')')) {
        return '"' + a.replace(/"/g, '\\"') + '"';
      }
      return a;
    }).join(' '));
  } else {
    // Bash format
    console.log('Bash:');
    console.log(rExecutable + ' ' + args.map(a => {
      if (a.includes('\n') || a.includes(' ') || a.includes('(') || a.includes(')')) {
        return "'" + a.replace(/'/g, "'\\''") + "'";
      }
      return a;
    }).join(' '));
  }
  
  console.log();
  console.log('='.repeat(70));
  console.log();
  console.log('R Code being executed:');
  console.log(rCode);
  console.log('='.repeat(70));
}

printCommand().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

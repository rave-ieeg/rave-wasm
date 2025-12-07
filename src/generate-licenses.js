const fs = require('fs');
const path = require('path');

// Paths
const packageLockPath = path.resolve(__dirname, '../package-lock.json');
const outputPath = path.resolve(__dirname, '../site/THIRD-PARTY-NOTICES.md');
const rPackagesNote = `# R Packages\n\nThis project uses R packages. For details about their licenses, please visit [CRAN](https://cran.r-project.org).`;

// Helper to parse package-lock.json
function parseNpmDependencies() {
  const packageLock = JSON.parse(fs.readFileSync(packageLockPath, 'utf-8'));
  const dependencies = packageLock.dependencies || {};

  const notices = Object.entries(dependencies).map(([name, info]) => {
    return `- **${name}**@${info.version} (${info.license || 'Unknown License'})\n  Repository: ${info.resolved || 'N/A'}`;
  });

  return `# NPM Dependencies\n\n${notices.join('\n')}`;
}

// Generate THIRD-PARTY-NOTICES.md
function generateNotices() {
  const npmNotices = parseNpmDependencies();

  const content = [
    '# THIRD-PARTY NOTICES',
    '',
    npmNotices,
    '',
    rPackagesNote,
    '',
    '## Additional Attributions',
    '- R Project',
    '- Python',
    '- WebAssembly',
  ].join('\n');

  fs.writeFileSync(outputPath, content, 'utf-8');
  console.log('THIRD-PARTY-NOTICES.md generated successfully.');
}

generateNotices();
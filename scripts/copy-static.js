const fs = require('fs');
const path = require('path');

const source = path.join(__dirname, '..', '.next', 'static');
const dest = path.join(__dirname, '..', 'public', '_next', 'static');

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.log(`Source directory ${src} does not exist. Skipping copy.`);
    return;
  }
  
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

console.log('Copying Next.js static assets to the public folder for static serving...');
copyDir(source, dest);
console.log('Successfully copied .next/static to public/_next/static');

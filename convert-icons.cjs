const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');
const pngToIco = require('png-to-ico');

async function run() {
  const sourceImage = process.argv[2];
  if (!sourceImage || !fs.existsSync(sourceImage)) {
    console.error('Source image not found:', sourceImage);
    process.exit(1);
  }

  const buildDir = path.join(__dirname, 'build');
  const assetsDir = path.join(__dirname, 'electron', 'assets');
  
  if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir, { recursive: true });
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

  console.log('Reading image with Jimp...');
  const img = await Jimp.read(sourceImage);
  
  // Resize to 512x512 for standard PNG icon
  img.resize(512, 512);
  
  const pngPathBuild = path.join(buildDir, 'icon.png');
  const pngPathAssets = path.join(assetsDir, 'icon.png');
  
  await img.writeAsync(pngPathBuild);
  fs.copyFileSync(pngPathBuild, pngPathAssets);
  console.log('Saved 512x512 PNG to build/icon.png and electron/assets/icon.png');

  // Generate ICO (png-to-ico handles multi-res automatically from 512x512)
  console.log('Generating ICO...');
  const icoBuffer = await pngToIco(pngPathBuild);
  const icoPathBuild = path.join(buildDir, 'icon.ico');
  const icoPathAssets = path.join(assetsDir, 'icon.ico');
  fs.writeFileSync(icoPathBuild, icoBuffer);
  fs.copyFileSync(icoPathBuild, icoPathAssets);
  console.log('Saved multi-res ICO to build/icon.ico and electron/assets/icon.ico');
  
  console.log('Done!');
}

run().catch(console.error);

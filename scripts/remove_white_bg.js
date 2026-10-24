import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';

function makeTransparent(inputPath, outputPath, options = {}) {
    const {
        whiteThreshold = 240,
        softEdge = true,
        edgeMin = 210
    } = options;

    const data = fs.readFileSync(inputPath);
    const png = PNG.sync.read(data);

    const { width, height } = png;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (width * y + x) << 2;
            const r = png.data[idx];
            const g = png.data[idx + 1];
            const b = png.data[idx + 2];
            const a = png.data[idx + 3];

            if (a === 0) continue;

            // Check if pixel is white or near-white
            const minC = Math.min(r, g, b);
            const maxC = Math.max(r, g, b);
            const isNeutral = (maxC - minC) < 25; // near grayscale / white

            if (minC >= whiteThreshold && isNeutral) {
                png.data[idx + 3] = 0; // Fully transparent
            } else if (softEdge && minC >= edgeMin && isNeutral) {
                // Soft alpha blending for anti-aliasing
                const factor = (minC - edgeMin) / (whiteThreshold - edgeMin);
                const newAlpha = Math.round(255 * (1 - factor));
                png.data[idx + 3] = Math.min(png.data[idx + 3], newAlpha);
            }
        }
    }

    const buffer = PNG.sync.write(png);
    fs.writeFileSync(outputPath, buffer);
    console.log(`✅ Processed: ${outputPath} (${width}x${height})`);
}

// 1. Process Logo 1 (Full Logo)
const img1 = 'C:/Users/Irfan/.gemini/antigravity/brain/5c23cfb1-1738-495a-b922-699ba03e34eb/.user_uploaded/media_1787335235432.png';
const img2 = 'C:/Users/Irfan/.gemini/antigravity/brain/5c23cfb1-1738-495a-b922-699ba03e34eb/.user_uploaded/media_1787335243810.png';

const targets = [
    'public/logo.png',
    'public/logo-full.png',
    'src/assets/logo.png',
    'src/assets/logo-full.png',
    'electron/assets/logo.png',
    'build/icon.png',
    'electron/assets/icon.png',
    'public/favicon.ico'
];

targets.forEach(target => {
    makeTransparent(img1, target, { whiteThreshold: 242, softEdge: true, edgeMin: 215 });
});

// 2. Process Logo 2 (Horizontal / Icon)
const targets2 = [
    'public/logo-horizontal.png',
    'src/assets/logo-horizontal.png',
    'public/logo-icon.png',
    'src/assets/logo-icon.png'
];

targets2.forEach(target => {
    makeTransparent(img2, target, { whiteThreshold: 242, softEdge: true, edgeMin: 215 });
});

console.log('🎉 All logo files updated with transparent backgrounds!');

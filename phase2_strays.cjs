const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'src', 'components');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsx'));

const strayColorMap = {
  // Orange -> Amber
  'bg-orange-100': 'bg-amber/5',
  'hover:bg-orange-200': 'hover:bg-amber/10',
  'text-orange-800': 'text-amber',
  'border-orange-300': 'border-amber/20',
  'hover:border-orange-400': 'hover:border-amber/40',
  'text-orange-500': 'text-amber',
  
  // Green -> Emerald
  'bg-green-400': 'bg-emerald',
  'text-green-600': 'text-emerald',
  'bg-green-50': 'bg-emerald/5',
  'border-green-200': 'border-emerald/20',
  'text-green-700': 'text-emerald/90',
  'bg-green-100': 'bg-emerald/10',
  'text-green-800': 'text-emerald/90',
  'text-green-500': 'text-emerald',

  // Yellow -> Amber
  'bg-yellow-400': 'bg-amber',

  // Blue -> Emerald
  'text-blue-600': 'text-emerald',

  // Purple -> Ink
  'bg-purple-100': 'bg-ink/5',
  'text-purple-800': 'text-ink/80'
};

const pattern = new RegExp('\\b(' + Object.keys(strayColorMap).join('|') + ')\\b', 'g');

files.forEach(filename => {
  if (filename === 'LoginScreen.jsx') return;

  const filepath = path.join(dir, filename);
  let content = fs.readFileSync(filepath, 'utf8');

  let updated = content.replace(pattern, match => strayColorMap[match]);

  if (content !== updated) {
    fs.writeFileSync(filepath, updated);
    console.log('Updated stray colors in', filename);
  }
});

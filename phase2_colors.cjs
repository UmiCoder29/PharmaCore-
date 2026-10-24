const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'src', 'components');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsx'));

const colorMap = {
  // Pharmacy -> Emerald
  'bg-pharmacy-50': 'bg-emerald/5',
  'bg-pharmacy-100': 'bg-emerald/10',
  'bg-pharmacy-200': 'bg-emerald/20',
  'bg-pharmacy-300': 'bg-emerald/40',
  'bg-pharmacy-400': 'bg-emerald',
  'bg-pharmacy-500': 'bg-emerald',
  'bg-pharmacy-600': 'bg-emerald',
  'bg-pharmacy-700': 'bg-emerald/90',
  'bg-pharmacy-800': 'bg-emerald/80',
  'bg-pharmacy-900': 'bg-emerald/70',
  
  'text-pharmacy-50': 'text-emerald/5',
  'text-pharmacy-100': 'text-emerald/10',
  'text-pharmacy-200': 'text-emerald/20',
  'text-pharmacy-300': 'text-emerald/40',
  'text-pharmacy-400': 'text-emerald',
  'text-pharmacy-500': 'text-emerald',
  'text-pharmacy-600': 'text-emerald',
  'text-pharmacy-700': 'text-emerald/90',
  'text-pharmacy-800': 'text-emerald/80',
  
  'border-pharmacy-50': 'border-emerald/5',
  'border-pharmacy-100': 'border-emerald/10',
  'border-pharmacy-200': 'border-emerald/20',
  'border-pharmacy-300': 'border-emerald/40',
  'border-pharmacy-400': 'border-emerald',
  'border-pharmacy-500': 'border-emerald',
  'border-pharmacy-600': 'border-emerald',

  'hover:bg-pharmacy-50': 'hover:bg-emerald/5',
  'hover:bg-pharmacy-100': 'hover:bg-emerald/10',
  'hover:bg-pharmacy-500': 'hover:bg-emerald/90',
  'hover:bg-pharmacy-600': 'hover:bg-emerald/90',
  'hover:bg-pharmacy-700': 'hover:bg-emerald/80',
  
  'hover:text-pharmacy-600': 'hover:text-emerald',
  'hover:text-pharmacy-700': 'hover:text-emerald/80',

  'focus:border-pharmacy-400': 'focus:border-emerald',
  'focus:ring-pharmacy-400/20': 'focus:ring-emerald/20',

  // Charcoal -> Ink
  'bg-charcoal-50': 'bg-ink/5',
  'bg-charcoal-100': 'bg-ink/5',
  'bg-charcoal-200': 'bg-ink/10',
  'bg-charcoal-300': 'bg-ink/20',
  'bg-charcoal-400': 'bg-ink/40',
  'bg-charcoal-500': 'bg-ink/60',
  'bg-charcoal-600': 'bg-ink/70',
  'bg-charcoal-700': 'bg-ink/80',
  'bg-charcoal-800': 'bg-ink/90',
  'bg-charcoal-900': 'bg-ink',

  'text-charcoal-50': 'text-ink/5',
  'text-charcoal-100': 'text-ink/5',
  'text-charcoal-200': 'text-ink/10',
  'text-charcoal-300': 'text-ink/20',
  'text-charcoal-400': 'text-ink/40',
  'text-charcoal-500': 'text-ink/60',
  'text-charcoal-600': 'text-ink/70',
  'text-charcoal-700': 'text-ink/80',
  'text-charcoal-800': 'text-ink/90',
  'text-charcoal-900': 'text-ink',
  
  'placeholder-charcoal-400': 'placeholder-ink/40',
  'placeholder-charcoal-500': 'placeholder-ink/60',

  'border-charcoal-100': 'border-ink/5',
  'border-charcoal-200': 'border-ink/10',
  'border-charcoal-300': 'border-ink/20',
  'border-charcoal-400': 'border-ink/40',
  'border-charcoal-500': 'border-ink/60',

  'hover:bg-charcoal-50': 'hover:bg-ink/5',
  'hover:bg-charcoal-100': 'hover:bg-ink/10',
  'hover:bg-charcoal-200': 'hover:bg-ink/20',
  'hover:text-charcoal-700': 'hover:text-ink/80',
  'hover:text-charcoal-900': 'hover:text-ink',

  // Cream -> Clinical or Ink opacity
  'bg-cream-50': 'bg-clinical',
  'bg-cream-100': 'bg-clinical',
  'bg-cream-200': 'bg-ink/5',
  'bg-cream-300': 'bg-ink/10',
  
  'border-cream-50': 'border-ink/5',
  'border-cream-100': 'border-ink/10',
  'border-cream-200': 'border-ink/10',
  'border-cream-300': 'border-ink/20',
  
  'divide-cream-100': 'divide-ink/5',
  'divide-cream-200': 'divide-ink/10',
  
  'hover:bg-cream-50': 'hover:bg-ink/5',
  'hover:bg-cream-100': 'hover:bg-ink/10',

  // Red -> Terracotta
  'bg-red-50': 'bg-terracotta/5',
  'bg-red-100': 'bg-terracotta/10',
  'bg-red-200': 'bg-terracotta/20',
  'bg-red-400': 'bg-terracotta',
  'bg-red-500': 'bg-terracotta',
  'bg-red-600': 'bg-terracotta/90',
  
  'text-red-400': 'text-terracotta',
  'text-red-500': 'text-terracotta',
  'text-red-600': 'text-terracotta/90',
  'text-red-700': 'text-terracotta/80',
  'text-red-800': 'text-terracotta',
  
  'hover:bg-red-50': 'hover:bg-terracotta/10',
  'hover:text-red-800': 'hover:text-terracotta/90',

  // Amber -> Amber
  'bg-amber-50': 'bg-amber/5',
  'bg-amber-100': 'bg-amber/10',
  'bg-amber-200': 'bg-amber/20',
  'text-amber-700': 'text-amber',
  'text-amber-800': 'text-amber',
};

// Create a regex to match any of the keys as a word boundary
const pattern = new RegExp('\\b(' + Object.keys(colorMap).join('|') + ')\\b', 'g');

files.forEach(filename => {
  // Skip Login/Signup
  if (filename === 'LoginScreen.jsx' || filename === 'OnboardingScreen.jsx') return;

  const filepath = path.join(dir, filename);
  let content = fs.readFileSync(filepath, 'utf8');

  let updated = content.replace(pattern, match => colorMap[match]);

  // General structural replacements
  // Remove rounded-2xl, rounded-3xl, rounded-xl etc.
  updated = updated.replace(/\brounded-(xl|2xl|3xl)\b/g, 'rounded-none');
  // Remove shadow-sm, shadow-md, shadow-lg, shadow-xl
  updated = updated.replace(/\bshadow-(sm|md|lg|xl)\b/g, '');

  if (content !== updated) {
    fs.writeFileSync(filepath, updated);
    console.log('Updated colors in', filename);
  }
});

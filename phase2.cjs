const fs = require('fs');
const path = require('path');

const files = [
  'POSScreen.jsx',
  'SalesHistoryScreen.jsx',
  'SuppliersScreen.jsx',
  'TaxDashboard.jsx',
  'BranchesScreen.jsx',
  'UsersScreen.jsx',
  'CategoriesScreen.jsx',
  'ReturnsScreen.jsx',
  'ExpiryAlertsScreen.jsx',
  'ActivityLogScreen.jsx'
];

function processFile(filename) {
  const filepath = path.join('src', 'components', filename);
  if (!fs.existsSync(filepath)) return;
  
  let content = fs.readFileSync(filepath, 'utf8');

  // Headers
  content = content.replace(/<h[23] className="text-2xl font-bold text-charcoal-900(?: mb-0\.5)?">([^<]+)<\/h[23]>/g, '<h3 className="text-3xl font-title font-medium text-ink mb-1">$1</h3>');
  content = content.replace(/<p className="text-sm text-charcoal-500">/g, '<p className="text-sm text-ink/60 font-medium">');
  
  // Containers
  content = content.replace(/bg-white border border-cream-300 rounded-xl shadow-sm overflow-hidden/g, 'bg-clinical border border-ink/10 overflow-hidden');
  content = content.replace(/bg-white border border-cream-300 rounded-xl shadow-sm/g, 'bg-clinical border border-ink/10');
  content = content.replace(/p-4 border-b border-cream-200 flex items-center justify-between bg-cream-50\/50/g, 'p-4 border-b border-ink/10 flex items-center justify-between bg-white');
  
  // Tables
  content = content.replace(/<thead className="bg-cream-100 text-charcoal-700 border-b border-cream-200">/g, '<thead className="bg-white text-ink/70 border-b border-ink/20">');
  content = content.replace(/<tbody className="divide-y divide-cream-100">/g, '<tbody className="divide-y divide-ink/10 bg-white">');
  content = content.replace(/<th className="px-4 py-3 font-semibold([^"]*)">/g, '<th className="px-4 py-3 font-semibold uppercase tracking-wider text-[11px]$1">');
  content = content.replace(/<th className="px-3 py-2\.5 font-semibold([^"]*)">/g, '<th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-[10px]$1">');

  // Rows
  content = content.replace(/className="hover:bg-cream-50\/70 transition-colors(?: cursor-pointer group)?"/g, 'className="hover:bg-ink/[0.02] transition-colors cursor-pointer group animate-slide-up opacity-0"');
  content = content.replace(/className="hover:bg-cream-50 transition-colors"/g, 'className="hover:bg-ink/[0.02] transition-colors animate-slide-up opacity-0"');

  // Buttons
  content = content.replace(/bg-pharmacy-600 hover:bg-pharmacy-700 text-white/g, 'bg-emerald hover:bg-emerald/90 text-white');
  content = content.replace(/bg-cream-100 hover:bg-cream-200 text-charcoal-700/g, 'bg-ink/5 hover:bg-ink/10 text-ink');
  
  // Text colors
  content = content.replace(/text-charcoal-900/g, 'text-ink');
  content = content.replace(/text-charcoal-700/g, 'text-ink/80');
  content = content.replace(/text-charcoal-600/g, 'text-ink/70');
  content = content.replace(/text-charcoal-500/g, 'text-ink/60');
  content = content.replace(/text-charcoal-400/g, 'text-ink/40');
  content = content.replace(/border-cream-200/g, 'border-ink/10');
  content = content.replace(/border-cream-300/g, 'border-ink/20');
  content = content.replace(/bg-cream-50/g, 'bg-clinical');
  content = content.replace(/bg-cream-100/g, 'bg-ink/5');

  // Action buttons
  content = content.replace(/text-ink\/40 hover:text-ink\/80 hover:bg-clinical p-1\.5 rounded-lg transition-colors/g, 'text-ink/40 hover:text-ink/80 hover:bg-ink/10 p-1.5 transition-colors');
  content = content.replace(/text-red-400 hover:text-red-800 hover:bg-red-50 p-1\.5 rounded-lg transition-colors/g, 'text-terracotta hover:text-white hover:bg-terracotta p-1.5 transition-colors');

  fs.writeFileSync(filepath, content);
  console.log('Processed', filename);
}

files.forEach(processFile);

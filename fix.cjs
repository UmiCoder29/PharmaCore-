const fs = require('fs');
let content = fs.readFileSync('src/components/MedicinesScreen.jsx', 'utf8');

// 1. Imports
content = content.replace(
  "import ExportImportModal from './ExportImportModal.jsx';",
  "import ExportImportModal from './ExportImportModal.jsx';\nimport BatchStamp from './BatchStamp.jsx';"
);

// 2. Title and Header
content = content.replace(
  /<h3 className="text-2xl font-bold text-charcoal-900 mb-0\.5">Inventory Manager<\/h3>/,
  '<h3 className="text-3xl font-title font-medium text-ink mb-1">Inventory Manager</h3>'
);
content = content.replace(
  /<p className="text-sm text-charcoal-500">/,
  '<p className="text-sm text-ink/60 font-medium">'
);

// 3. New Medicine Button
content = content.replace(
  /className="flex items-center gap-2 bg-pharmacy-600 hover:bg-pharmacy-700 text-white font-bold py-2 px-4 rounded-lg text-sm transition-colors shadow-sm"/g,
  'className="flex items-center gap-2 bg-emerald hover:bg-emerald/90 text-white font-bold py-2 px-4 text-sm transition-colors"'
);

// 4. Hint Box
content = content.replace(
  /<div className="bg-pharmacy-50 border border-pharmacy-200 rounded-xl p-5 flex gap-4 items-start">/,
  '<div className="bg-clinical border border-emerald/20 p-5 flex gap-4 items-start">'
);
content = content.replace(
  /<div className="text-pharmacy-500 mt-0\.5">/,
  '<div className="text-emerald mt-0.5">'
);
content = content.replace(
  /<p className="font-semibold text-pharmacy-800 text-sm">/,
  '<p className="font-semibold text-ink text-sm">'
);
content = content.replace(
  /<p className="text-pharmacy-700 text-xs mt-1">/,
  '<p className="text-ink/70 text-xs mt-1">'
);

// 5. Table Container
content = content.replace(
  /<div className="bg-white border border-cream-300 rounded-xl shadow-sm overflow-hidden">/,
  '<div className="bg-clinical border border-ink/10 overflow-hidden">'
);
content = content.replace(
  /<div className="p-4 border-b border-cream-200 flex items-center justify-between bg-cream-50\/50">/,
  '<div className="p-4 border-b border-ink/10 flex items-center justify-between bg-white">'
);
content = content.replace(
  /<table className="w-full text-left text-sm">\s*<thead className="bg-cream-100 text-charcoal-700 border-b border-cream-200">\s*<tr>\s*<th className="w-10 px-4 py-3"><\/th>\s*<th className="px-4 py-3 font-semibold">Product<\/th>\s*<th className="px-4 py-3 font-semibold">Generic Name<\/th>\s*<th className="px-4 py-3 font-semibold">Category<\/th>\s*<th className="px-4 py-3 font-semibold">Barcode<\/th>\s*<th className="px-4 py-3 font-semibold text-right">Total Stock<\/th>\s*<th className="px-4 py-3 font-semibold text-center">Batches<\/th>\s*\{isAdmin && <th className="px-4 py-3 font-semibold text-right">Actions<\/th>\}\s*<\/tr>\s*<\/thead>\s*<tbody className="divide-y divide-cream-100">/,
  `<table className="w-full text-left text-sm">
            <thead className="bg-white text-ink/70 border-b border-ink/20">
              <tr>
                <th className="w-10 px-4 py-3"></th>
                <th className="px-4 py-3 font-semibold uppercase tracking-wider text-[11px]">Product</th>
                <th className="px-4 py-3 font-semibold uppercase tracking-wider text-[11px]">Generic</th>
                <th className="px-4 py-3 font-semibold uppercase tracking-wider text-[11px]">Category</th>
                <th className="px-4 py-3 font-semibold uppercase tracking-wider text-[11px]">Barcode</th>
                <th className="px-4 py-3 font-semibold uppercase tracking-wider text-[11px] text-right">Total Stock</th>
                <th className="px-4 py-3 font-semibold uppercase tracking-wider text-[11px] text-center">Status</th>
                <th className="px-4 py-3 font-semibold uppercase tracking-wider text-[11px] text-center">Batches</th>
                {isAdmin && <th className="px-4 py-3 font-semibold uppercase tracking-wider text-[11px] text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/10 bg-white">`
);

// 6. Loading & Empty State
content = content.replace(
  /<td colSpan=\{isAdmin \? 8 : 7\}/g,
  '<td colSpan={isAdmin ? 9 : 8}'
);
content = content.replace(
  /<div className="flex flex-col items-center gap-3 text-charcoal-400">/,
  '<div className="flex flex-col items-center gap-3 text-ink/40">'
);
content = content.replace(
  /className="text-pharmacy-600 hover:text-pharmacy-700 text-xs font-semibold underline underline-offset-2"/g,
  'className="text-emerald hover:text-emerald/80 text-xs font-semibold underline underline-offset-2"'
);

// 7. Medicine Row
content = content.replace(
  /filteredMedicines\.map\(m => \(/g,
  'filteredMedicines.map((m, idx) => ('
);
content = content.replace(
  /<tr\n\s*className="hover:bg-cream-50\/70 transition-colors cursor-pointer group"\n\s*onClick=\{\(\) => toggleExpand\(m\.id\)\}\n\s*>/g,
  '<tr\n                      className="hover:bg-ink/[0.02] transition-colors cursor-pointer group"\n                      style={{ animationDelay: `${idx * 30}ms` }}\n                      onClick={() => toggleExpand(m.id)}\n                    >'
);

// 8. Row Columns
content = content.replace(
  /<td className="px-4 py-3 text-charcoal-400 group-hover:text-pharmacy-600 transition-colors">/g,
  '<td className="px-4 py-3 text-ink/40 group-hover:text-emerald transition-colors">'
);
content = content.replace(
  /<span className="font-semibold text-charcoal-900 text-sm">\{m\.name\}<\/span>/g,
  '<span className="font-semibold text-ink text-sm">{m.name}</span>'
);
content = content.replace(
  /<td className="px-4 py-3 text-charcoal-500 text-xs">\{m\.genericName \|\| '—'\}<\/td>/g,
  '<td className="px-4 py-3 text-ink/60 text-xs">{m.genericName || \'—\'}</td>'
);
content = content.replace(
  /<span className="bg-pharmacy-50 text-pharmacy-700 border border-pharmacy-200 px-2 py-0\.5 rounded-full text-\[11px\] font-medium">/g,
  '<span className="text-ink/70 font-medium">'
);
content = content.replace(
  /<span className="text-charcoal-400">—<\/span>/g,
  '<span className="text-ink/40">—</span>'
);
content = content.replace(
  /<td className="px-4 py-3 text-charcoal-500 text-xs font-mono">\{m\.barcode \|\| '—'\}<\/td>/g,
  '<td className="px-4 py-3 text-ink/60 text-xs font-mono">{m.barcode || \'—\'}</td>'
);

// Quantity badge replacement
const oldQty = /<span className=\{\`px-2\.5 py-1 rounded-full text-xs font-bold \$\{\n\s*m\.quantityInStock <= 0\s*\? 'bg-red-100 text-red-800' :\n\s*m\.quantityInStock <= 10 \? 'bg-amber-100 text-amber-800' :\n\s*'bg-emerald-50 text-emerald-800'\n\s*\}\`\}>\n\s*\{m\.quantityInStock\}\n\s*<\/span>/;
content = content.replace(
  oldQty,
  `<span className="font-mono text-ink font-semibold">{m.quantityInStock}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {m.quantityInStock <= 0 ? (
                          <BatchStamp variant="critical" text="OUT OF STOCK" />
                        ) : m.quantityInStock <= 10 ? (
                          <BatchStamp variant="warning" text="LOW STOCK" />
                        ) : (
                          <BatchStamp variant="positive" text="IN STOCK" />
                        )}`
);

// Batches icon
content = content.replace(
  /<span className="inline-flex items-center gap-1 text-charcoal-500 text-xs">/g,
  '<span className="inline-flex items-center gap-1 text-ink/50 text-xs font-mono">'
);

// Actions
content = content.replace(
  /className="inline-flex items-center gap-1 bg-pharmacy-50 hover:bg-pharmacy-100 text-pharmacy-700 border border-pharmacy-200 font-semibold px-2\.5 py-1 rounded-lg text-xs transition-colors"/g,
  'className="inline-flex items-center gap-1 bg-emerald/5 hover:bg-emerald/10 text-emerald border border-emerald/20 font-semibold px-2.5 py-1 text-xs transition-colors"'
);
content = content.replace(
  /className="text-charcoal-400 hover:text-charcoal-700 hover:bg-cream-100 p-1\.5 rounded-lg transition-colors"/g,
  'className="text-ink/40 hover:text-ink/80 hover:bg-ink/10 p-1.5 transition-colors"'
);
content = content.replace(
  /className="text-red-400 hover:text-red-800 hover:bg-red-50 p-1\.5 rounded-lg transition-colors"/g,
  'className="text-terracotta hover:text-white hover:bg-terracotta p-1.5 transition-colors"'
);

// 9. Expanded Batches
content = content.replace(
  /<tr className="bg-cream-50\/40">/g,
  '<tr className="bg-clinical">'
);
content = content.replace(
  /<div className="pl-10 pr-5 py-4 border-l-4 border-pharmacy-400 ml-4 my-1 rounded animate-slide-down">/g,
  '<div className="pl-10 pr-5 py-4 border-l-2 border-emerald ml-4 my-1 animate-slide-down">'
);
content = content.replace(
  /<table className="w-full text-left text-xs bg-white rounded-lg shadow-sm overflow-hidden border border-cream-200">/,
  '<table className="w-full text-left text-xs bg-white border border-ink/10">'
);
content = content.replace(
  /<thead className="bg-cream-100 text-charcoal-600 border-b border-cream-200">/,
  '<thead className="bg-clinical text-ink/70 border-b border-ink/10">'
);

// Batch header columns
const oldBatchHeader = /<tr>\n\s*<th className="px-3 py-2\.5 font-semibold">Batch #<\/th>\n\s*<th className="px-3 py-2\.5 font-semibold">Expiry<\/th>\n\s*<th className="px-3 py-2\.5 font-semibold">Supplier<\/th>\n\s*\{isAdmin && <th className="px-3 py-2\.5 font-semibold text-right">Cost<\/th>\}\n\s*<th className="px-3 py-2\.5 font-semibold text-right">Sell Price<\/th>\n\s*<th className="px-3 py-2\.5 font-semibold text-right">Stock<\/th>\n\s*\{isAdmin && <th className="px-3 py-2\.5 font-semibold text-right">Actions<\/th>\}\n\s*<\/tr>/;
content = content.replace(
  oldBatchHeader,
  `<tr>
                                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-[10px]">Batch #</th>
                                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-[10px]">Expiry</th>
                                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-[10px]">Supplier</th>
                                    {isAdmin && <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-[10px] text-right">Cost</th>}
                                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-[10px] text-right">Sell Price</th>
                                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-[10px] text-right">Stock</th>
                                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-[10px] text-center">Status</th>
                                    {isAdmin && <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-[10px] text-right">Actions</th>}
                                  </tr>`
);

content = content.replace(
  /<tbody className="divide-y divide-cream-100">/g,
  '<tbody className="divide-y divide-ink/5">'
);
content = content.replace(
  /className=\{batch\.isExpired \? 'bg-red-50' : 'hover:bg-cream-50'\}/g,
  'className={batch.isExpired ? \'bg-terracotta/5\' : \'hover:bg-ink/5\'}'
);
content = content.replace(
  /<td className="px-3 py-2\.5 font-mono text-charcoal-700 font-medium">\n\s*\{batch\.batchNumber\}\n\s*\{batch\.isExpired && \(\n\s*<span className="ml-2 bg-red-200 text-red-800 text-\[10px\] px-1\.5 py-0\.5 rounded-full font-semibold">\n\s*EXPIRED\n\s*<\/span>\n\s*\)\}\n\s*<\/td>/,
  '<td className="px-3 py-2.5 font-mono text-ink font-medium">\n                                        {batch.batchNumber}\n                                      </td>'
);
content = content.replace(
  /<td className="px-3 py-2\.5 text-charcoal-600">/g,
  '<td className="px-3 py-2.5 text-ink/70 font-mono">'
);
content = content.replace(
  /<td className="px-3 py-2\.5 text-charcoal-500 truncate max-w-\[130px\]">/g,
  '<td className="px-3 py-2.5 text-ink/60 truncate max-w-[130px]">'
);
content = content.replace(
  /<td className="px-3 py-2\.5 text-right text-charcoal-500">/g,
  '<td className="px-3 py-2.5 text-right text-ink/60 font-mono">'
);
content = content.replace(
  /<td className="px-3 py-2\.5 text-right text-pharmacy-700 font-semibold">/g,
  '<td className="px-3 py-2.5 text-right text-emerald font-semibold font-mono">'
);
content = content.replace(
  /<td className="px-3 py-2\.5 text-right font-bold text-charcoal-700">/g,
  '<td className="px-3 py-2.5 text-right font-bold text-ink font-mono">'
);

// Batch Status column
content = content.replace(
  /\{batch\.quantityInStock\}\n\s*<\/td>\n\s*\{isAdmin && \(/g,
  `{batch.quantityInStock}
                                      </td>
                                      <td className="px-3 py-2.5 text-center">
                                        {batch.isExpired ? (
                                          <BatchStamp variant="critical" text="EXPIRED" />
                                        ) : batch.quantityInStock <= 0 ? (
                                          <BatchStamp variant="critical" text="OUT OF STOCK" />
                                        ) : batch.quantityInStock <= 10 ? (
                                          <BatchStamp variant="warning" text="LOW STOCK" />
                                        ) : (
                                          <BatchStamp variant="positive" text="IN STOCK" />
                                        )}
                                      </td>
                                      {isAdmin && (`
);

content = content.replace(
  /className="text-charcoal-400 hover:text-charcoal-700 hover:bg-cream-100 p-1 rounded-md transition-colors"/g,
  'className="text-ink/40 hover:text-ink/80 hover:bg-ink/10 p-1 transition-colors"'
);
content = content.replace(
  /className="text-red-400 hover:text-red-800 hover:bg-red-50 p-1 rounded-md transition-colors"/g,
  'className="text-terracotta hover:text-white hover:bg-terracotta p-1 transition-colors"'
);

fs.writeFileSync('src/components/MedicinesScreen.jsx', content);
console.log('Successfully updated MedicinesScreen.jsx');

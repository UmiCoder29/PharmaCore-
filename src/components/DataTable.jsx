import React, { useState, useMemo } from 'react';
import { 
  ChevronLeft, 
  ChevronRight, 
  ChevronsLeft, 
  ChevronsRight, 
  ArrowUpDown, 
  ArrowUp, 
  ArrowDown, 
  X, 
  Download, 
  Layers
} from 'lucide-react';

/**
 * Reusable, High-Performance DataTable Component
 * 
 * Props:
 * - columns: Array of {
 *     header: string | ReactNode,
 *     accessor: string | function(row),
 *     sortable?: boolean,
 *     sortKey?: string,
 *     align?: 'left' | 'center' | 'right',
 *     className?: string,
 *     cell?: function(row, index)
 *   }
 * - data: Array of objects
 * - searchKeys?: Array of strings (fields to search)
 * - searchPlaceholder?: string
 * - filters?: ReactNode (Custom filter controls toolbar)
 * - initialSort?: { key: string, direction: 'asc' | 'desc' }
 * - initialPageSize?: number (default: 10)
 * - pageSizeOptions?: number[] (default: [10, 25, 50, 100])
 * - exportFileName?: string
 * - actions?: ReactNode (Action buttons on top right, e.g. Add, Refresh)
 * - expandableRow?: function(row) => ReactNode (Expanded row renderer)
 * - rowClassName?: function(row, index) => string
 * - onRowClick?: function(row)
 * - loading?: boolean
 * - emptyMessage?: string
 * - emptyIcon?: ReactNode
 */
export default function DataTable({
  columns = [],
  data = [],
  searchKeys = [],
  searchPlaceholder = 'Search records...',
  filters = null,
  initialSort = { key: '', direction: 'asc' },
  initialPageSize = 10,
  pageSizeOptions = [10, 25, 50, 100],
  exportFileName = 'export-data',
  actions = null,
  expandableRow = null,
  rowClassName = null,
  onRowClick = null,
  loading = false,
  emptyMessage = 'No records found',
  emptyIcon = null
}) {
  const [search, setSearch] = useState('');
  const [sortConfig, setSortConfig] = useState(initialSort);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [expandedRows, setExpandedRows] = useState(new Set());

  const toggleRowExpand = (id) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 1. Multi-Field Filter & Search
  const filteredData = useMemo(() => {
    if (!data || !Array.isArray(data)) return [];
    if (!search.trim()) return data;

    const query = search.toLowerCase().trim();
    return data.filter(item => {
      if (!item) return false;

      if (searchKeys && searchKeys.length > 0) {
        return searchKeys.some(key => {
          const val = typeof key === 'function' ? key(item) : item[key];
          if (val === null || val === undefined) return false;
          return String(val).toLowerCase().includes(query);
        });
      }

      return Object.values(item).some(val => {
        if (val === null || val === undefined) return false;
        if (typeof val === 'object') return false;
        return String(val).toLowerCase().includes(query);
      });
    });
  }, [data, search, searchKeys]);

  // 2. Multi-Type Sorting
  const sortedData = useMemo(() => {
    if (!sortConfig.key) return filteredData;

    return [...filteredData].sort((a, b) => {
      const col = columns.find(c => (c.sortKey || c.accessor) === sortConfig.key);
      let aVal = col && typeof col.accessor === 'function' ? col.accessor(a) : a[sortConfig.key];
      let bVal = col && typeof col.accessor === 'function' ? col.accessor(b) : b[sortConfig.key];

      if (aVal === null || aVal === undefined) aVal = '';
      if (bVal === null || bVal === undefined) bVal = '';

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
      }

      const aDate = Date.parse(aVal);
      const bDate = Date.parse(bVal);
      if (!isNaN(aDate) && !isNaN(bDate) && typeof aVal === 'string' && (aVal.includes('-') || aVal.includes('/'))) {
        return sortConfig.direction === 'asc' ? aDate - bDate : bDate - aDate;
      }

      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      if (aStr < bStr) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aStr > bStr) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredData, sortConfig, columns]);

  // 3. Pagination calculation
  const totalRecords = sortedData.length;
  const isAll = pageSize === -1 || pageSize >= totalRecords;
  const totalPages = isAll ? 1 : Math.max(1, Math.ceil(totalRecords / pageSize));
  const activePage = Math.min(currentPage, totalPages);

  const paginatedData = useMemo(() => {
    if (isAll) return sortedData;
    const startIndex = (activePage - 1) * pageSize;
    return sortedData.slice(startIndex, startIndex + pageSize);
  }, [sortedData, activePage, pageSize, isAll]);

  const handleSort = (key) => {
    setSortConfig(prev => {
      if (prev.key === key) {
        if (prev.direction === 'asc') return { key, direction: 'desc' };
        return { key: '', direction: 'asc' };
      }
      return { key, direction: 'asc' };
    });
    setCurrentPage(1);
  };

  const exportToCSV = () => {
    if (!sortedData || sortedData.length === 0) return;

    const exportCols = columns.filter(c => c.header && typeof c.header === 'string' && c.header.trim() !== '' && c.header !== 'Actions');
    const headers = exportCols.map(c => `"${c.header.replace(/"/g, '""')}"`).join(',');

    const rows = sortedData.map(row => {
      return exportCols.map(c => {
        let val = typeof c.accessor === 'function' ? c.accessor(row) : row[c.accessor || c.sortKey];
        if (val === null || val === undefined) val = '';
        if (typeof val === 'object') val = JSON.stringify(val);
        return `"${String(val).replace(/"/g, '""')}"`;
      }).join(',');
    });

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers, ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${exportFileName}-${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getPageNumbers = () => {
    const pages = [];
    const delta = 2;
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= activePage - delta && i <= activePage + delta)) {
        pages.push(i);
      } else if (pages[pages.length - 1] !== '...') {
        pages.push('...');
      }
    }
    return pages;
  };

  return (
    <div className="w-full bg-white border-2 border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col font-sans">
      
      {/* ── Top Toolbar: Live Search, Custom Filters & Actions ── */}
      <div className="p-4 bg-slate-50/80 border-b border-slate-200 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        
        {/* Left: Global Instant Search Field */}
        <div className="flex-1 flex items-center gap-2 max-w-md">
          <div className="relative w-full">
            <input
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setCurrentPage(1); }}
              placeholder={searchPlaceholder}
              className="w-full rounded-xl border border-slate-300 bg-white py-2 pl-3.5 pr-8 text-xs font-bold text-slate-900 placeholder:text-slate-400 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 transition-all shadow-sm"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Center / Custom Filters Slot */}
        {filters && (
          <div className="flex items-center gap-2 flex-wrap">
            {filters}
          </div>
        )}

        {/* Right: Actions & Export Button */}
        <div className="flex items-center gap-2 shrink-0 justify-end">
          {actions}
          <button
            type="button"
            onClick={exportToCSV}
            disabled={sortedData.length === 0}
            title="Export filtered records to CSV"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-extrabold shadow-sm transition-all disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5 text-emerald-600" />
            <span className="hidden sm:inline">Export CSV</span>
          </button>
        </div>
      </div>

      {/* ── Filter Counter & Active Query Pill ── */}
      {search && (
        <div className="px-4 py-2 bg-emerald-50 border-b border-emerald-100 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="font-bold text-emerald-900">Search results for: <strong className="text-emerald-700">"{search}"</strong></span>
            <span className="bg-emerald-200 text-emerald-800 font-extrabold px-2 py-0.5 rounded-full font-mono text-[10px]">
              {totalRecords} matches
            </span>
          </div>
          <button 
            type="button" 
            onClick={() => setSearch('')} 
            className="text-emerald-700 hover:underline font-bold text-[11px]"
          >
            Clear search
          </button>
        </div>
      )}

      {/* ── Table Element ── */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-900 text-white text-[11px] font-black uppercase tracking-wider select-none">
              {expandableRow && <th className="px-3 py-3 w-8"></th>}
              {columns.map((col, idx) => {
                const sortKey = col.sortKey || (typeof col.accessor === 'string' ? col.accessor : null);
                const isSortable = col.sortable !== false && !!sortKey;
                const isSorted = sortConfig.key === sortKey;
                const alignCls = col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left';

                return (
                  <th
                    key={idx}
                    onClick={() => isSortable && handleSort(sortKey)}
                    className={`px-4 py-3.5 ${alignCls} ${col.className || ''} ${isSortable ? 'cursor-pointer hover:bg-slate-800 transition-colors' : ''}`}
                  >
                    <div className={`inline-flex items-center gap-1.5 ${col.align === 'right' ? 'justify-end' : col.align === 'center' ? 'justify-center' : 'justify-start'}`}>
                      <span>{col.header}</span>
                      {isSortable && (
                        <span className="text-slate-400">
                          {isSorted ? (
                            sortConfig.direction === 'asc' ? (
                              <ArrowUp className="w-3.5 h-3.5 text-emerald-400 stroke-[3]" />
                            ) : (
                              <ArrowDown className="w-3.5 h-3.5 text-emerald-400 stroke-[3]" />
                            )
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-40 hover:opacity-100" />
                          )}
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100 bg-white">
            {loading ? (
              <tr>
                <td colSpan={columns.length + (expandableRow ? 1 : 0)} className="px-6 py-16 text-center text-slate-500 font-bold text-sm">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-7 h-7 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                    <span>Loading data records...</span>
                  </div>
                </td>
              </tr>
            ) : paginatedData.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (expandableRow ? 1 : 0)} className="px-6 py-16 text-center text-slate-400">
                  <div className="flex flex-col items-center gap-3">
                    {emptyIcon || <Layers className="w-10 h-10 text-slate-300 stroke-[1.5]" />}
                    <p className="text-sm font-bold text-slate-600">{emptyMessage}</p>
                    {search && (
                      <button
                        type="button"
                        onClick={() => setSearch('')}
                        className="text-xs font-extrabold text-emerald-600 hover:underline"
                      >
                        Reset search filter
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              paginatedData.map((row, rowIdx) => {
                const isExpanded = expandedRows.has(row.id || rowIdx);
                const customCls = rowClassName ? rowClassName(row, rowIdx) : '';

                return (
                  <React.Fragment key={row.id || rowIdx}>
                    <tr
                      onClick={() => onRowClick && onRowClick(row)}
                      className={`hover:bg-emerald-50/50 transition-colors group ${rowIdx % 2 === 1 ? 'bg-slate-50/40' : 'bg-white'} ${onRowClick ? 'cursor-pointer' : ''} ${customCls}`}
                    >
                      {expandableRow && (
                        <td className="px-3 py-3 text-slate-400 group-hover:text-emerald-700">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); toggleRowExpand(row.id || rowIdx); }}
                            className="p-1 rounded-md hover:bg-slate-200 transition-colors"
                          >
                            <ChevronRight className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? 'rotate-90 text-emerald-600' : ''}`} />
                          </button>
                        </td>
                      )}
                      {columns.map((col, colIdx) => {
                        const alignCls = col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left';
                        const cellValue = typeof col.accessor === 'function' ? col.accessor(row) : row[col.accessor || col.sortKey];

                        return (
                          <td key={colIdx} className={`px-4 py-3 text-xs font-semibold text-slate-800 ${alignCls} ${col.className || ''}`}>
                            {col.cell ? col.cell(row, rowIdx) : (cellValue !== null && cellValue !== undefined ? String(cellValue) : '—')}
                          </td>
                        );
                      })}
                    </tr>
                    
                    {/* Expandable Child Row */}
                    {expandableRow && isExpanded && (
                      <tr className="bg-slate-50/90 border-y border-slate-200">
                        <td colSpan={columns.length + 1} className="p-4">
                          {expandableRow(row)}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Bottom Pagination Toolbar ── */}
      <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-semibold text-slate-600">
        
        {/* Left: Entries Counter & Rows Per Page */}
        <div className="flex items-center gap-3">
          <span>
            Showing <strong className="text-slate-900">{totalRecords === 0 ? 0 : (activePage - 1) * (isAll ? totalRecords : pageSize) + 1}</strong> to <strong className="text-slate-900">{isAll ? totalRecords : Math.min(activePage * pageSize, totalRecords)}</strong> of <strong className="text-slate-900">{totalRecords}</strong> records
          </span>

          <div className="flex items-center gap-1.5 ml-2 border-l border-slate-200 pl-3">
            <span className="text-[11px] text-slate-500 font-bold">Rows:</span>
            <select
              value={pageSize}
              onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
              className="bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs font-extrabold text-slate-800 outline-none focus:border-emerald-600 shadow-sm"
            >
              {pageSizeOptions.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
              <option value={-1}>All</option>
            </select>
          </div>
        </div>

        {/* Right: Page Navigation */}
        {!isAll && totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={activePage === 1}
              onClick={() => setCurrentPage(1)}
              className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
              title="First Page"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              disabled={activePage === 1}
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
              title="Previous Page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            {/* Page Number Buttons */}
            <div className="flex items-center gap-1 mx-1">
              {getPageNumbers().map((num, i) => {
                if (num === '...') {
                  return <span key={i} className="px-2 py-1 text-slate-400 font-bold">...</span>;
                }
                const isActive = num === activePage;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setCurrentPage(num)}
                    className={`w-8 h-8 rounded-lg text-xs font-black transition-all ${
                      isActive 
                        ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/20' 
                        : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {num}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              disabled={activePage === totalPages}
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
              title="Next Page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              disabled={activePage === totalPages}
              onClick={() => setCurrentPage(totalPages)}
              className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
              title="Last Page"
            >
              <ChevronsRight className="w-4 h-4" />
            </button>
          </div>
        )}

      </div>

    </div>
  );
}

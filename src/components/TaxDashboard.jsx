import React, { useState, useEffect } from 'react';

export default function TaxDashboard({ user }) {
  const [sales, setSales] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Date filters defaulting to today
  const getTodayString = () => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  const [startDate, setStartDate] = useState(getTodayString());
  const [endDate, setEndDate] = useState(getTodayString());
  
  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const [salesData, categoriesData] = await Promise.all([
        window.pharmacoreAPI.getSales(),
        window.pharmacoreAPI.getCategories()
      ]);
      // Sort most recent first
      const sortedSales = (salesData || []).sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));
      setSales(sortedSales);
      setCategories(categoriesData || []);
    } catch (err) {
      console.error('Failed to load data', err);
      setError('Failed to load data.');
    } finally {
      setLoading(false);
    }
  };

  // Filter sales by date range
  const filteredSales = sales.filter(sale => {
    const saleDate = new Date(sale.dateTime);
    
    // Parse date boundaries in local time
    let matchesDate = true;
    if (startDate) {
      const start = new Date(`${startDate}T00:00:00`);
      matchesDate = matchesDate && saleDate >= start;
    }
    if (endDate) {
      const end = new Date(`${endDate}T23:59:59.999`);
      matchesDate = matchesDate && saleDate <= end;
    }
    return matchesDate;
  });

  // Calculate total tax collected
  const totalTaxCollected = filteredSales.reduce((sum, sale) => sum + (sale.totalTax ?? 0), 0);

  // Calculate tax breakdown by category
  const taxBreakdownByCategory = () => {
    const breakdown = {};
    filteredSales.forEach(sale => {
      const itemsToIterate = sale.items || sale.saleItems || [];
      itemsToIterate.forEach(item => {
        let categoryName = 'Uncategorized';
        if (item.medicineId) {
          // We don't have medicine details, but we can try to use categoryId from the item if present?
          // Wait, we don't store categoryId on sale items. So we can group by tax rate?
          // Or just keep track of per-item tax?
          // For now, let's just group by tax rate since we don't have categoryId on sale items
          const taxRateKey = item.taxRateAtSale ?? 'Unknown';
          const key = `${taxRateKey}%`;
          if (!breakdown[key]) {
            breakdown[key] = 0;
          }
          breakdown[key] += item.taxAmount ?? 0;
        }
      });
    });
    return breakdown;
  };

  const taxBreakdown = taxBreakdownByCategory();

  // Helper to format date
  const formatDateTime = (isoString) => {
    const d = new Date(isoString);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      
      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <h3 className="text-2xl font-bold text-ink mb-1">Tax Dashboard</h3>
          <p className="text-sm text-ink/60 font-medium">View tax collection history and breakdown.</p>
        </div>
      </div>

      {/* Filters and Summary */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 bg-white border border-ink/20 rounded-lg p-6 ">
        {/* Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 flex-1">
          <div>
            <label className="block text-xs font-semibold text-ink/80 uppercase tracking-wider mb-2">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="w-full bg-clinical border border-ink/20 focus:border-emerald focus:ring-1 focus:ring-emerald/20 rounded px-4 py-2.5 text-ink text-sm outline-none transition-all duration-200"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink/80 uppercase tracking-wider mb-2">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="w-full bg-clinical border border-ink/20 focus:border-emerald focus:ring-1 focus:ring-emerald/20 rounded px-4 py-2.5 text-ink text-sm outline-none transition-all duration-200"
            />
          </div>
        </div>

        {/* Total Tax Collected Summary */}
        <div className="bg-clinical border border-ink/20 p-4 rounded flex flex-col justify-center items-end min-w-[200px]">
          <span className="text-xs font-semibold text-ink/80 uppercase tracking-wider">Total Tax Collected</span>
          <span className="text-2xl font-black text-emerald font-mono">Rs {totalTaxCollected.toFixed(2)}</span>
          <span className="text-[10px] text-ink/60 mt-1">{filteredSales.length} Transactions</span>
        </div>
      </div>

      {/* Tax Breakdown */}
      {Object.keys(taxBreakdown).length > 0 && (
        <div className="bg-white border border-ink/20 rounded-lg p-6 ">
          <div className="relative mb-4">
            <h4 className="text-lg font-bold text-ink">Tax Breakdown by Rate</h4>
            <div className="absolute bottom-0 left-0 w-12 h-0.5 bg-emerald"></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(taxBreakdown).map(([rate, amount]) => (
              <div key={rate} className="bg-clinical border border-ink/10 rounded p-4">
                <div className="text-sm text-ink/70 mb-1">Rate: {rate}</div>
                <div className="text-xl font-black text-emerald">Rs {amount.toFixed(2)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sales List Table */}
      <div className="bg-white border border-ink/20 rounded-lg  overflow-hidden">
        {error && (
          <div className="p-4 bg-terracotta/5 border-b border-red-200 text-terracotta text-sm text-center">
            {error}
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-clinical text-ink/80 text-xs uppercase tracking-wider">
                <th className="px-6 py-4 font-semibold">Date / Time</th>
                <th className="px-6 py-4 font-semibold text-right">Subtotal</th>
                <th className="px-6 py-4 font-semibold text-right">Tax</th>
                <th className="px-6 py-4 font-semibold text-right">Total</th>
                <th className="px-6 py-4 font-semibold">Cashier</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/10">
              {loading ? (
                <tr>
                  <td colSpan="5" className="px-6 py-12 text-center text-ink/40 text-sm">
                    Loading tax history...
                  </td>
                </tr>
              ) : filteredSales.length === 0 ? (
                <tr>
                  <td colSpan="5" className="px-6 py-12 text-center text-ink/40 text-sm">
                    No transactions found for the selected date range.
                  </td>
                </tr>
              ) : (
                filteredSales.map(sale => (
                  <tr key={sale.id} className="hover:bg-ink/[0.02] transition-colors animate-slide-up opacity-0">
                    <td className="px-6 py-4 text-ink/70 font-mono text-sm">
                      {formatDateTime(sale.dateTime)}
                    </td>
                    <td className="px-6 py-4 text-right text-ink/70 font-mono text-sm">
                      Rs {(sale.subtotal ?? sale.totalAmount).toFixed(2)}
                    </td>
                    <td className="px-6 py-4 text-right text-emerald font-mono font-bold text-sm">
                      Rs {(sale.totalTax ?? 0).toFixed(2)}
                    </td>
                    <td className="px-6 py-4 text-right text-ink font-mono font-bold text-sm">
                      Rs {(sale.totalAmount ?? 0).toFixed(2)}
                    </td>
                    <td className="px-6 py-4 text-ink/70 text-sm">
                      {sale.cashierUserId || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
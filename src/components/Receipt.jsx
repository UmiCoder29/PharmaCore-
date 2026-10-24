import React from 'react';

/**
 * Receipt Component.
 * Styled using CSS @media print to render cleanly on paper.
 */
export default function Receipt({ sale }) {
  if (!sale) return null;

  const date = new Date(sale.dateTime);
  const dateStr = date.toLocaleDateString();
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Backward compatibility: if sale doesn't have subtotal or totalTax, use totalAmount
  const subtotal = sale.subtotal ?? sale.totalAmount;
  const totalTax = sale.totalTax ?? 0;
  const totalAmount = sale.totalAmount ?? subtotal + totalTax;
  const discountAmount = Number(sale.discountAmount ?? 0);

  return (
    <div className="bg-white text-black p-8 rounded-lg shadow-2xl w-[80mm] min-w-[320px] max-w-sm mx-auto receipt-container relative overflow-hidden">
      
      {/* Decorative top edge mimicking thermal paper */}
      <div className="absolute top-0 left-0 right-0 h-2 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPjxwb2x5Z29uIGZpbGw9IiNmMThmMTgiIHBvaW50cz0iMCwwIDgsMCA0LDgiLz48L3N2Zz4=')] bg-repeat-x opacity-20 no-print"></div>

      {/* Header */}
      <div className="text-center mb-6 border-b border-black/20 pb-4">
        <div className="flex justify-center mb-2">
          <img src={sale.pharmacyLogo || './logo.png'} alt="Pharmacy Logo" className="h-10 w-auto object-contain max-w-[140px]" />
        </div>
        <h2 className="text-2xl font-black tracking-tight mb-1">{sale.pharmacyName || 'PHARMACORE'}</h2>
        <p className="text-xs text-gray-600 font-medium">{sale.branchAddress || 'Karachi, Sindh, Pakistan'}</p>
        <p className="text-xs text-gray-600 font-medium mt-1">Computerized Pharmacy Receipt</p>
      </div>

      {/* Meta */}
      <div className="space-y-2 text-xs font-mono mb-4">
        <div className="flex justify-between items-start">
          <div>
            <p><span className="font-sans font-bold text-gray-500">Date:</span> {dateStr}</p>
            <p><span className="font-sans font-bold text-gray-500">Time:</span> {timeStr}</p>
          </div>
          <div className="text-right">
            <p><span className="font-sans font-bold text-gray-500">Invoice:</span> #{sale.invoiceNumber || sale.id?.slice(0, 8).toUpperCase()}</p>
            <p><span className="font-sans font-bold text-gray-500">Cashier:</span> {sale.cashierName || sale.cashierUserId || 'Staff'}</p>
          </div>
        </div>

        {/* Customer / Patient Line */}
        <div className="pt-1.5 border-t border-black/10 flex justify-between items-baseline">
          <span className="font-sans font-bold text-gray-500 uppercase tracking-wider text-[10px]">Customer:</span>
          <span className="font-sans font-black text-gray-900 text-xs text-right truncate max-w-[200px]">
            {sale.customerName || sale.customer?.fullName || (sale.customerId ? 'Registered Patient' : 'Walk-in Customer')}
          </span>
        </div>
        {(sale.customerPhone || sale.customer?.phone) && (
          <div className="flex justify-between items-baseline text-[10px]">
            <span className="font-sans font-bold text-gray-400">Phone:</span>
            <span className="font-mono font-bold text-gray-700">{sale.customerPhone || sale.customer?.phone}</span>
          </div>
        )}
      </div>

      <div className="border-t border-black/20 border-dashed my-2"></div>

      {/* Items */}
      <div className="my-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/20">
              <th className="text-left font-semibold py-1 w-1/2">Item</th>
              <th className="text-center font-semibold py-1">Qty</th>
              <th className="text-right font-semibold py-1">Amount</th>
            </tr>
          </thead>
          <tbody>
            {(sale.items || sale.saleItems || []).map((item, idx) => {
              const itemSubtotal = item.subtotalItem ?? item.priceAtSale * item.quantity;
              return (
                <tr key={idx} className="border-b border-gray-100 last:border-0">
                  <td className="py-2 text-xs font-medium leading-tight pr-2">
                    {item.name}
                    {item.taxRateAtSale !== undefined && (
                      <div className="text-[10px] text-gray-500">Tax: {item.taxRateAtSale}%</div>
                    )}
                  </td>
                  <td className="py-2 text-xs text-center">{item.quantity}</td>
                  <td className="py-2 text-xs text-right">Rs {itemSubtotal.toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="border-t border-black/20 border-dashed my-2"></div>

      {/* Totals */}
      <div className="mt-4 space-y-1 text-sm font-semibold">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>Rs {subtotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span>Tax</span>
          <span>Rs {totalTax.toFixed(2)}</span>
        </div>
        {discountAmount > 0 && <div className="flex justify-between"><span>Discount</span><span>− Rs {discountAmount.toFixed(2)}</span></div>}
        <div className="flex justify-between text-lg font-black mt-2 pt-2 border-t border-black">
          <span>TOTAL</span>
          <span>Rs {totalAmount.toFixed(2)}</span>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-8 text-center border-t border-black/20 pt-4">
        <p className="text-[10px] text-gray-600 mb-1">Payment: {(sale.paymentMethod || 'cash').replace('_', ' ')}</p>
        {Number(sale.changeAmount) > 0 && <p className="text-[10px] text-gray-600 mb-1">Change: Rs {Number(sale.changeAmount).toFixed(2)}</p>}
        <p className="text-xs font-bold mb-1">Thank you for your business!</p>
        <p className="text-[10px] text-gray-500">Keep receipt for returns (14 days).</p>
        
        {/* Barcode placeholder */}
        <div className="mt-4 flex justify-center opacity-60">
          <svg width="150" height="40">
            <rect x="0" y="0" width="150" height="40" fill="white"/>
            <path d="M10,5 v30 M15,5 v30 M25,5 v30 M30,5 v30 M32,5 v30 M45,5 v30 M55,5 v30 M60,5 v30 M70,5 v30 M72,5 v30 M75,5 v30 M85,5 v30 M90,5 v30 M95,5 v30 M105,5 v30 M110,5 v30 M120,5 v30 M130,5 v30 M135,5 v30" stroke="black" strokeWidth="2"/>
            <path d="M20,5 v30 M40,5 v30 M50,5 v30 M65,5 v30 M80,5 v30 M100,5 v30 M115,5 v30 M125,5 v30 M140,5 v30" stroke="black" strokeWidth="4"/>
          </svg>
        </div>
      </div>

      <style>{`
        @media print {
          @page {
            size: 80mm auto;
            margin: 0;
          }
          html, body {
            width: 80mm !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            color: #000000 !important;
            overflow: visible !important;
          }
          body * {
            visibility: hidden !important;
          }
          .receipt-container, .receipt-container * {
            visibility: visible !important;
          }
          .receipt-container {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 80mm !important;
            min-width: 80mm !important;
            max-width: 80mm !important;
            margin: 0 auto !important;
            padding: 4mm 4mm !important;
            box-shadow: none !important;
            border: none !important;
            border-radius: 0 !important;
            background: #ffffff !important;
            color: #000000 !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}

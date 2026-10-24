import React, { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { X } from 'lucide-react';

export default function LowStockPopup({ medicineName, quantity, onDismiss }) {
  const containerRef = useRef(null);
  const progressRef = useRef(null);
  
  const isZero = quantity === 0;
  // Use solid terracotta for 0 stock, solid amber for low stock
  const colors = isZero 
    ? 'text-white border-terracotta bg-terracotta'
    : 'text-white border-amber bg-amber';
    
  const barColor = isZero ? 'bg-black/20' : 'bg-black/20';
  const rotation = isZero ? 'rotate-1' : '-rotate-1';

  useEffect(() => {
    // Entrance animation (intentional slight bounce approved for this alert specifically)
    gsap.fromTo(
      containerRef.current,
      { x: 300, opacity: 0 },
      { x: 0, opacity: 1, duration: 0.6, ease: 'back.out(1.2)' }
    );

    // Progress bar animation (8 seconds)
    const tl = gsap.timeline({
      onComplete: () => {
        // Exit animation
        gsap.to(containerRef.current, { 
          x: 300, opacity: 0, duration: 0.4, ease: 'power2.in',
          onComplete: onDismiss 
        });
      }
    });

    tl.fromTo(progressRef.current, 
      { width: '100%' }, 
      { width: '0%', duration: 8, ease: 'none' }
    );

    return () => tl.kill();
  }, [onDismiss]);

  const handleManualDismiss = () => {
    gsap.to(containerRef.current, { 
      x: 300, opacity: 0, duration: 0.3, ease: 'power2.in',
      onComplete: onDismiss 
    });
  };

  return (
    <div 
      ref={containerRef}
      className={`relative inline-flex flex-col border ${colors} ${rotation} shadow-lg overflow-hidden transform origin-center max-w-sm w-full`}
    >
      {/* Stamped-ink edge texture overlays */}
      <div className="absolute inset-0 border-[0.5px] border-current opacity-20 transform rotate-[0.5deg] pointer-events-none"></div>
      <div className="absolute inset-0 border-[0.5px] border-current opacity-10 transform -rotate-[0.5deg] translate-x-[0.5px] pointer-events-none"></div>

      {/* Main Content */}
      <div className="p-4 relative">
        <button 
          onClick={handleManualDismiss}
          className="absolute top-2 right-2 p-1 hover:bg-black/5 rounded opacity-60 hover:opacity-100 transition-opacity"
        >
          <X size={14} strokeWidth={3} />
        </button>

        <span className="block font-mono text-xs font-bold uppercase tracking-widest mb-1 opacity-80" style={{ textShadow: '0 0 1px currentColor' }}>
          {isZero ? 'Out of Stock' : 'Low Stock Warning'}
        </span>
        
        <p className="font-title text-lg font-bold leading-tight mb-2">
          {medicineName}
        </p>
        
        <p className="font-mono text-sm opacity-90">
          <span className="font-bold text-lg">{quantity}</span> units remaining
        </p>
      </div>

      {/* Countdown Progress Bar */}
      <div className="h-1 w-full bg-black/5 mt-auto">
        <div ref={progressRef} className={`h-full ${barColor} origin-left`}></div>
      </div>
    </div>
  );
}

import React from 'react';

export default function BatchStamp({ variant = 'positive', text }) {
  // Variants: positive (emerald), warning (amber), critical (terracotta)
  const variants = {
    positive: 'text-emerald border-emerald/50 bg-emerald/5',
    warning: 'text-amber border-amber/50 bg-amber/5',
    critical: 'text-terracotta border-terracotta/50 bg-terracotta/5'
  };
  
  const rotation = variant === 'warning' ? '-rotate-1' : variant === 'critical' ? 'rotate-1' : '-rotate-1';

  return (
    <div className={`inline-flex items-center justify-center px-2 py-0.5 border ${variants[variant]} ${rotation} transform origin-center transition-transform hover:scale-105 duration-200`}>
      <span className="font-mono text-[10px] sm:text-xs font-bold uppercase tracking-widest leading-none" style={{ textShadow: '0 0 1px currentColor' }}>
        {text}
      </span>
      {/* Stamped-ink edge texture effect overlay */}
      <div className="absolute inset-0 border-[0.5px] border-current opacity-20 transform rotate-[0.5deg]"></div>
      <div className="absolute inset-0 border-[0.5px] border-current opacity-10 transform -rotate-[0.5deg] translate-x-[0.5px]"></div>
    </div>
  );
}

/**
 * ExportImportButton — Animated button for export/import actions.
 *
 * Props:
 *   onClick():  handler
 *   icon:       React element (lucide icon)
 *   label:      string
 *   variant:    'export' | 'import'
 *   success:    boolean — triggers the success pulse animation
 */
import React, { useRef, useEffect } from 'react';
import { gsap } from 'gsap';
import { CheckCircle } from 'lucide-react';

export default function ExportImportButton({ onClick, icon, label, variant = 'export', success = false, disabled = false }) {
  const btnRef  = useRef(null);
  const iconRef = useRef(null);

  // Hover animation — GPU-accelerated (transform + box-shadow via opacity overlay)
  const handleMouseEnter = () => {
    if (!btnRef.current || disabled) return;
    gsap.to(btnRef.current, {
      scale: 1.04,
      duration: 0.18,
      ease: 'power2.out',
    });
  };

  const handleMouseLeave = () => {
    if (!btnRef.current) return;
    gsap.to(btnRef.current, {
      scale: 1,
      duration: 0.15,
      ease: 'power2.inOut',
    });
  };

  const handleMouseDown = () => {
    if (!btnRef.current || disabled) return;
    gsap.to(btnRef.current, { scale: 0.97, duration: 0.08, ease: 'power1.in' });
  };

  const handleMouseUp = () => {
    if (!btnRef.current || disabled) return;
    gsap.to(btnRef.current, { scale: 1.04, duration: 0.1, ease: 'power1.out' });
  };

  // Success pulse — plays when `success` flips to true
  useEffect(() => {
    if (success && btnRef.current && iconRef.current) {
      const tl = gsap.timeline();
      tl.to(btnRef.current, { scale: 1.08, duration: 0.12, ease: 'power2.out' })
        .to(iconRef.current, { rotate: 360, duration: 0.4, ease: 'back.out(1.7)' }, '<')
        .to(btnRef.current, { scale: 1, duration: 0.2, ease: 'bounce.out' });
    }
  }, [success]);

  const baseClasses = `
    relative flex items-center gap-2 px-4 py-2.5 rounded-none font-semibold text-sm
    border transition-colors duration-150 select-none cursor-pointer
    will-change-transform
    ${variant === 'export'
      ? 'bg-slate-800/80 border-slate-700 text-slate-200 hover:border-emerald-500/40 hover:text-emerald-300'
      : 'bg-emerald-600/10 border-emerald-500/25 text-emerald-400 hover:bg-emerald-600/20 hover:border-emerald-500/50'}
    ${disabled ? 'opacity-40 pointer-events-none' : ''}
  `;

  return (
    <button
      ref={btnRef}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      className={baseClasses}
    >
      {/* Glow overlay — rendered as a fading pseudo-element substitute */}
      {!disabled && (
        <span
          className={`absolute inset-0 rounded-none opacity-0 transition-opacity duration-200 pointer-events-none
            ${variant === 'export'
              ? 'shadow-[0_0_18px_rgba(16,185,129,0.25)] hover:opacity-100'
              : 'shadow-[0_0_18px_rgba(52,211,153,0.35)] hover:opacity-100'
            }`}
        />
      )}

      <span ref={iconRef} className="flex items-center">
        {success ? <CheckCircle size={16} className="text-emerald-400" /> : icon}
      </span>

      <span>{success ? 'Done!' : label}</span>
    </button>
  );
}

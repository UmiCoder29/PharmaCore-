/**
 * ExportImportModal — Reusable password-prompt modal for Export/Import actions.
 *
 * Props:
 *   mode:     'export' | 'import'
 *   onConfirm(password): called when user submits a password
 *   onCancel():          called when user closes
 *   isLoading:           boolean
 *   error:               string | null
 *   title:               string
 *   description:         string
 */
import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Lock, Upload, Download, X } from 'lucide-react';
import { gsap } from 'gsap';

export default function ExportImportModal({ mode, onConfirm, onCancel, isLoading, error, title, description }) {
  const [password, setPassword] = useState('');
  const modalRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (modalRef.current) {
      gsap.fromTo(modalRef.current,
        { opacity: 0, scale: 0.94, y: 15 },
        { opacity: 1, scale: 1, y: 0, duration: 0.25, ease: 'power3.out' }
      );
    }
    if (inputRef.current) inputRef.current.focus();
  }, []);

  const handleClose = () => {
    if (modalRef.current) {
      gsap.to(modalRef.current, {
        opacity: 0, scale: 0.94, y: 15, duration: 0.18, ease: 'power2.in',
        onComplete: onCancel
      });
    } else {
      onCancel();
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!password.trim()) return;
    onConfirm(password);
  };

  const Icon = mode === 'export' ? Download : Upload;

  const modalElement = (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex animate-fade-in items-center justify-center p-4 z-[100] overflow-y-auto">
      <div
        ref={modalRef}
        className="bg-slate-900 border border-slate-700/80 rounded-2xl p-6 shadow-2xl w-full max-w-sm my-auto"
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
            <Icon size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-white font-black text-base leading-tight">{title}</h3>
            <p className="text-slate-400 text-xs mt-0.5 leading-snug">{description}</p>
          </div>
          <button
            onClick={handleClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Lock size={11} className="text-emerald-400" />
              {mode === 'export' ? 'Export Password' : 'File Decryption Password'}
            </label>
            <input
              ref={inputRef}
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={isLoading}
              placeholder="Enter password..."
              className="w-full bg-slate-800 border border-slate-700 focus:border-emerald-500 rounded-xl px-4 py-2.5 text-slate-100 placeholder-slate-500 text-xs font-bold outline-none transition-all disabled:opacity-50"
            />
          </div>

          {error && (
            <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 text-rose-300 text-xs font-bold leading-relaxed">
              {error}
            </div>
          )}

          <div className="flex gap-2.5 pt-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={isLoading}
              className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-2.5 rounded-xl transition-all text-xs border border-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !password.trim()}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-black py-2.5 rounded-xl transition-all text-xs shadow-md flex items-center justify-center gap-1.5"
            >
              {isLoading ? (
                <>
                  <svg className="w-4 h-4 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  {mode === 'export' ? 'Exporting…' : 'Decrypting…'}
                </>
              ) : (
                <>
                  <Icon size={14} />
                  {mode === 'export' ? 'Export File' : 'Import File'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalElement, document.body) : modalElement;
}

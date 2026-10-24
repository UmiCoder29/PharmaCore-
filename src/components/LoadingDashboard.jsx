import React, { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';

const stages = ['Securing your session', 'Reviewing pharmacy safeguards', 'Preparing inventory', 'Opening your workspace'];

export default function LoadingDashboard({ onComplete }) {
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState(0);
  const sceneRef = useRef(null);
  const barsRef = useRef([]);

  useEffect(() => {
    const context = gsap.context(() => {
      gsap.fromTo('[data-load-reveal]', { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.65, stagger: 0.12, ease: 'power3.out' });
      barsRef.current.filter(Boolean).forEach((bar, index) => gsap.to(bar, { scaleY: 0.35 + (index % 4) * 0.18, duration: 0.5 + index * 0.08, repeat: -1, yoyo: true, transformOrigin: 'bottom', ease: 'sine.inOut' }));
      const meter = { value: 0 };
      gsap.to(meter, { value: 100, duration: 4.5, ease: 'power2.inOut', onUpdate: () => setProgress(Math.round(meter.value)), onComplete });
    }, sceneRef);
    const timers = stages.map((_, index) => setTimeout(() => setStage(index), index * 1100));
    return () => { context.revert(); timers.forEach(clearTimeout); };
  }, [onComplete]);

  return <main ref={sceneRef} className="relative grid min-h-screen place-items-center overflow-hidden bg-[#071d1a] p-6 text-white">
    <div className="absolute inset-0 opacity-[.09] [background-image:radial-gradient(rgba(132,245,197,.9)_1px,transparent_1px)] [background-size:24px_24px]" />
    <div className="absolute -left-24 top-[-6rem] h-[30rem] w-[30rem] rounded-full bg-emerald/25 blur-[130px]" />
    <div className="absolute -bottom-36 right-[-4rem] h-[32rem] w-[32rem] rounded-full bg-lilac/25 blur-[145px]" />
    <section className="relative z-10 w-full max-w-xl">
      <div data-load-reveal className="mb-12 flex items-center justify-between"><img src="./logo-dark.png" alt="PharmaCore - The Unified Pharmacy Ecosystem" className="h-12 w-auto object-contain drop-shadow-[0_8px_24px_rgba(41,196,135,0.35)]" /><span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-[#83ebbd]">Starting</span></div>
      <div data-load-reveal className="rounded-[2rem] border border-white/10 bg-white/[.07] p-6 shadow-[0_30px_70px_rgba(0,0,0,.28)] backdrop-blur-xl sm:p-9">
        <div className="flex items-end justify-between"><div><p className="text-[10px] font-mono font-bold uppercase tracking-[.23em] text-[#83ebbd]">System signal</p><h1 className="mt-3 font-title text-4xl tracking-[-.04em] sm:text-5xl">Getting ready.</h1></div><p className="font-mono text-4xl font-bold text-[#f5bc63]">{progress}<span className="text-lg">%</span></p></div>
        <div className="mt-10 flex h-20 items-end gap-1.5 overflow-hidden rounded-2xl border border-white/10 bg-black/10 px-4 pb-4 pt-3">{Array.from({ length: 24 }).map((_, index) => <span key={index} ref={el => barsRef.current[index] = el} className={`block flex-1 rounded-full ${index % 5 === 0 ? 'bg-[#f5bc63]' : 'bg-[#6be5b4]'}`} style={{ height: `${28 + (index % 6) * 10}%` }} />)}</div>
        <div className="mt-7 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-[#61e1ac] via-[#3bb8ac] to-[#f5bc63] transition-[width] duration-200" style={{ width: `${progress}%` }} /></div>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">{stages.map((item, index) => <div key={item} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs transition-all duration-500 ${index <= stage ? 'bg-white/10 text-white' : 'text-white/30'}`}><span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${index < stage ? 'bg-[#6be5b4] text-[#062018]' : index === stage ? 'border border-[#f5bc63] text-[#f5bc63]' : 'border border-white/15'}`}>{index < stage ? '✓' : index + 1}</span>{item}</div>)}</div>
      </div>
      <p data-load-reveal className="mt-7 text-center text-[10px] font-mono uppercase tracking-[.2em] text-white/35">Secure dispensing · Karachi, Pakistan</p>
    </section>
  </main>;
}

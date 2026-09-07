'use client';
import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';

// Two-tone Web Audio siren, armed on first user interaction. No audio file needed.
export default function AlarmSiren({ active }) {
  const [armed, setArmed] = useState(false);
  const ctxRef = useRef(null);
  const oscRef = useRef(null);
  const gainRef = useRef(null);
  const toggleRef = useRef(null);

  // Arm audio on the first interaction anywhere.
  useEffect(() => {
    if (armed) return;
    const arm = () => {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        ctxRef.current = new Ctx();
        setArmed(true);
      } catch {}
      remove();
    };
    const remove = () => {
      ['pointerdown', 'pointerup', 'click', 'keydown', 'touchstart', 'touchend', 'mousedown'].forEach((ev) =>
        window.removeEventListener(ev, arm)
      );
    };
    ['pointerdown', 'pointerup', 'click', 'keydown', 'touchstart', 'touchend', 'mousedown'].forEach((ev) =>
      window.addEventListener(ev, arm, { once: false })
    );
    return remove;
  }, [armed]);

  // Start/stop siren with alarm state.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!armed || !ctx) return;

    function start() {
      if (oscRef.current) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 880;
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.05);
      let hi = true;
      const toggle = setInterval(() => {
        hi = !hi;
        try { osc.frequency.value = hi ? 880 : 540; } catch {}
      }, 450);
      oscRef.current = osc;
      gainRef.current = gain;
      toggleRef.current = toggle;
    }
    function stop() {
      clearInterval(toggleRef.current);
      const osc = oscRef.current;
      const gain = gainRef.current;
      if (gain) gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.08);
      if (osc) setTimeout(() => { try { osc.stop(); } catch {} }, 100);
      oscRef.current = null;
      gainRef.current = null;
    }

    if (active) start();
    else stop();
    return () => {};
  }, [active, armed]);

  // Big prompt if an alarm is firing but audio isn't armed yet.
  if (active && !armed) {
    return (
      <button
        onClick={() => {}}
        className="fixed inset-0 z-[100000] flex flex-col items-center justify-center gap-5 text-white"
        style={{ background: 'linear-gradient(180deg, rgba(127,29,29,0.97) 0%, #2a0707 100%)' }}
      >
        <span
          className="flex h-24 w-24 items-center justify-center rounded-full border"
          style={{ background: 'rgba(11,15,30,0.7)', borderColor: 'rgba(239,68,68,0.6)' }}
        >
          <Volume2 className="h-12 w-12 animate-alarm text-[#f87171]" />
        </span>
        <span className="text-xl font-semibold uppercase tracking-[0.2em] text-white md:text-2xl">Tap to enable alarm sound</span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-300">Browser audio needs one tap</span>
      </button>
    );
  }

  // Small unobtrusive arm button when idle and not yet armed.
  if (!armed) {
    return (
      <div className="fixed bottom-4 right-4 z-[100000] lg:bottom-2 lg:left-1/2 lg:right-auto lg:-translate-x-1/2">
        <div className="flex items-center gap-2 whitespace-nowrap rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-300 backdrop-blur-md">
          <VolumeX size={14} /> Sound muted · click anywhere to arm
        </div>
      </div>
    );
  }
  return null;
}

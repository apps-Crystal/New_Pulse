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
        className="fixed inset-0 z-[100000] flex flex-col items-center justify-center gap-4 bg-red-700/95 text-white"
      >
        <Volume2 className="h-24 w-24 animate-alarm" />
        <span className="font-mono text-3xl font-black uppercase tracking-widest">Tap to enable alarm sound</span>
      </button>
    );
  }

  // Small unobtrusive arm button when idle and not yet armed.
  if (!armed) {
    return (
      <div className="fixed bottom-4 right-4 z-[100000]">
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white/90 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 shadow-lg backdrop-blur-md dark:border-slate-700 dark:bg-slate-800/90 dark:text-slate-400">
          <VolumeX size={14} /> Sound muted — click anywhere to arm
        </div>
      </div>
    );
  }
  return null;
}

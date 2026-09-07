'use client';
import { useEffect, useRef, useState } from 'react';
import { Activity } from 'lucide-react';

// Tracks the `dark` class on <html> (toggled by Header / the layout bootstrap script).
function useDarkClass() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const read = () => setDark(el.classList.contains('dark'));
    read();
    const obs = new MutationObserver(read);
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

// Realistic ECG waveform with a heart rate that rises as zone health drops.
function generateECGWaveform(x, timeOffset, amplitude, status, percentage = 100) {
  if (status === 'offline') {
    // Flatline with minimal electrical noise
    return amplitude * 0.5 + (Math.random() - 0.5) * 0.5;
  }

  // Healthy (100%): 60 BPM; 50-99%: 60-100 BPM; <50%: 100-130 BPM
  let bpm;
  if (percentage === 100) bpm = 60;
  else if (percentage >= 50) bpm = 60 + (40 * (100 - percentage)) / 50;
  else bpm = 100 + (30 * (50 - percentage)) / 50;

  const secondsPerBeat = 60 / bpm;
  const time = (x + timeOffset) / 100; // 100 pixels per second
  const beatPhase = (time % secondsPerBeat) / secondsPerBeat;

  let y = 0;

  if (beatPhase < 0.12) {
    y = 0; // PR interval baseline
  } else if (beatPhase < 0.22) {
    const pPhase = (beatPhase - 0.12) / 0.1; // P wave
    y = 0.15 * Math.sin(pPhase * Math.PI);
  } else if (beatPhase < 0.26) {
    y = 0; // PR segment
  } else if (beatPhase < 0.34) {
    const qrsPhase = (beatPhase - 0.26) / 0.08; // QRS complex
    if (qrsPhase < 0.15) {
      y = -0.2 * Math.sin((qrsPhase * Math.PI) / 0.15);
    } else if (qrsPhase < 0.5) {
      const rPhase = (qrsPhase - 0.15) / 0.35;
      y = 1.4 * Math.sin(rPhase * Math.PI);
    } else {
      const sPhase = (qrsPhase - 0.5) / 0.5;
      y = -0.3 * Math.sin(sPhase * Math.PI);
    }
  } else if (beatPhase < 0.44) {
    y = status === 'critical' ? -0.1 + Math.random() * 0.05 : 0; // ST segment
  } else if (beatPhase < 0.6) {
    const tPhase = (beatPhase - 0.44) / 0.16; // T wave
    y = 0.3 * Math.sin(tPhase * Math.PI);
  } else {
    y = 0; // TP segment
  }

  // Heart-rate variability
  y += Math.sin(time * 0.15) * 0.02;

  if (status === 'warning') {
    y *= 0.85 + Math.random() * 0.15;
    if (beatPhase > 0.95 && Math.random() < 0.05) {
      y += 0.3 * Math.sin(beatPhase * Math.PI * 20);
    }
  } else if (status === 'critical') {
    y *= 0.6 + Math.random() * 0.4;
    if (Math.random() < 0.15) {
      y += (Math.random() - 0.5) * 0.4;
    }
  }

  // Baseline wander + high-frequency noise
  y += Math.sin(time * 0.3) * 0.03 + Math.sin(time * 0.7) * 0.02;
  y += (Math.random() - 0.5) * 0.015;

  return amplitude * 0.5 - y * amplitude * 0.32;
}

function ecgStatus(connected, healthPercentage) {
  if (!connected || healthPercentage === 0) return 'offline';
  if (healthPercentage < 50) return 'critical';
  if (healthPercentage < 100) return 'warning';
  return 'normal';
}

export default function SensorECG({ activeCount, totalCount, connected }) {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const timeOffsetRef = useRef(0);
  const darkMode = useDarkClass();

  const healthRaw = totalCount > 0 ? (activeCount / totalCount) * 100 : 0;
  const healthPercentage = Math.round(healthRaw);
  const status = ecgStatus(connected, healthRaw);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    const animate = () => {
      // Clear
      ctx.fillStyle = darkMode ? '#1e293b' : '#f8fafc';
      ctx.fillRect(0, 0, width, height);

      // ECG paper grid - major lines
      ctx.strokeStyle = darkMode ? '#334155' : '#e2e8f0';
      ctx.lineWidth = 0.5;
      for (let x = 0; x < width; x += 25) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += 25) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Minor lines
      ctx.strokeStyle = darkMode ? '#1e293b' : '#f1f5f9';
      for (let x = 0; x < width; x += 5) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += 5) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Waveform
      ctx.beginPath();
      ctx.strokeStyle =
        status === 'offline' ? '#ef4444' : status === 'critical' ? '#f59e0b' : status === 'warning' ? '#eab308' : '#10b981';
      ctx.lineWidth = 2;
      for (let x = 0; x < width; x++) {
        const y = generateECGWaveform(x, timeOffsetRef.current, height, status, healthRaw);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      timeOffsetRef.current += 2;
      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [status, healthRaw, darkMode]);

  const pill = !connected
    ? 'bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-300'
    : healthPercentage === 100
      ? 'bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300'
      : healthPercentage >= 50
        ? 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300'
        : 'bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-300';

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-colors duration-300 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 transition-colors duration-300 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center gap-2">
          <div className="rounded-lg border border-slate-200 bg-white p-1.5 shadow-sm transition-colors duration-300 dark:border-slate-700 dark:bg-slate-800">
            <Activity size={16} className="text-slate-600 transition-colors duration-300 dark:text-slate-400" />
          </div>
          <h2 className="text-xs font-bold uppercase tracking-widest text-slate-700 transition-colors duration-300 dark:text-slate-300">
            Sensor Activity Monitor
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide transition-colors duration-300 ${pill}`}>
            {activeCount}/{totalCount} ACTIVE
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide transition-colors duration-300 ${pill}`}>
            {healthPercentage}% HEALTH
          </span>
        </div>
      </div>
      <div className="p-3">
        <canvas ref={canvasRef} width={600} height={60} className="block h-auto w-full max-w-full" />
      </div>
    </div>
  );
}

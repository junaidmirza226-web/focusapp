/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Smartphone, Clock, ShieldCheck, Zap, CheckCircle2, ArrowRight,
  Lock, DollarSign, X, Settings, BarChart3, Plus, TrendingUp,
  Award, Loader
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// ── Android bridge type declaration ──────────────────────────────────────────
declare global {
  interface Window {
    Android?: {
      getInstalledApps: () => string;
      getAppIcon: (packageName: string) => string;
      getMonitoredApps: () => string;
      getTodayUsage: () => string;
      getDashboardStats: () => string;
      getWeeklyStats: () => string;
      saveApp: (packageName: string, limitMinutes: number, appName: string) => void;
      removeApp: (packageName: string) => void;
      setStrictMode: (enabled: boolean) => void;
      getStrictMode: () => boolean;
      isPermissionsGranted: () => string;
      requestUsageAccess: () => void;
      requestOverlay: () => void;
      requestBatteryOptimization: () => void;
      getActiveUnlock: (packageName: string) => string;
    };
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────
type AppState = 'loading' | 'onboarding' | 'setup' | 'dashboard';

interface MonitoredApp {
  packageName: string;
  appName: string;
  dailyLimitMinutes: number;
  usedMinutes: number;
}

interface InstalledApp {
  packageName: string;
  appName: string;
  limitMinutes: number;
  isSelected: boolean;
}

interface DashboardStats {
  focusScore: number;
  scoreDiffVsYesterday: number;
  totalSpentToday: number;
  totalSpentThisWeek: number;
  timeSavedMinutes: number;
  streakDays: number;
  strictMode: boolean;
}

interface WeeklyStatDay { focusScore: number; totalSpent: number; }

// ── Demo / fallback data (used when window.Android is not available) ──────────
const DEMO_INSTALLED: InstalledApp[] = [
  { packageName: 'com.instagram.android', appName: 'Instagram', limitMinutes: 30, isSelected: false },
  { packageName: 'com.zhiliaoapp.musically', appName: 'TikTok', limitMinutes: 30, isSelected: false },
  { packageName: 'com.google.android.youtube', appName: 'YouTube', limitMinutes: 60, isSelected: false },
  { packageName: 'com.twitter.android', appName: 'Twitter / X', limitMinutes: 20, isSelected: false },
  { packageName: 'com.whatsapp', appName: 'WhatsApp', limitMinutes: 45, isSelected: false },
];

const DEFAULT_STATS: DashboardStats = {
  focusScore: 84, scoreDiffVsYesterday: 12,
  totalSpentToday: 0, totalSpentThisWeek: 0,
  timeSavedMinutes: 252, streakDays: 3, strictMode: false,
};

// ── Shared components ─────────────────────────────────────────────────────────

const Button = ({
  children, onClick, variant = 'primary', className = '', disabled = false, ariaLabel,
}: {
  children: React.ReactNode; onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  className?: string; disabled?: boolean; ariaLabel?: string;
}) => {
  const variants = {
    primary: 'bg-white text-black hover:bg-zinc-200 border border-white/10 glow-ring',
    secondary: 'bg-zinc-900/80 text-white hover:bg-zinc-800 border border-white/5',
    outline: 'border border-zinc-700 text-white hover:bg-zinc-900',
    ghost: 'text-zinc-400 hover:text-white hover:bg-zinc-900/50',
    danger: 'bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20',
  };
  return (
    <motion.button onClick={onClick} disabled={disabled}
      aria-label={ariaLabel}
      title={ariaLabel}
      whileTap={{ scale: 0.96 }}
      className={`px-6 py-3.5 rounded-2xl font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2 ${variants[variant]} ${className}`}>
      {children}
    </motion.button>
  );
};

const Card = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <div className={`glass-card rounded-[2rem] p-6 ${className}`}>
    {children}
  </div>
);

/** Lazily loads the real app icon via the Android bridge; falls back to a coloured initial. */
const AppIcon = ({ packageName, appName, size = 'md' }: { packageName: string; appName: string; size?: 'sm' | 'md' }) => {
  const [iconSrc, setIconSrc] = useState('');
  const dim = size === 'sm' ? 'w-10 h-10' : 'w-12 h-12';

  useEffect(() => {
    if (!window.Android) return;
    const t = setTimeout(() => {
      const icon = window.Android!.getAppIcon(packageName);
      if (icon) setIconSrc(icon);
    }, 0);
    return () => clearTimeout(t);
  }, [packageName]);

  const COLORS = [
    'bg-purple-600', 'bg-blue-600', 'bg-emerald-600',
    'bg-red-600', 'bg-amber-600', 'bg-pink-600', 'bg-indigo-600',
  ];
  const color = COLORS[packageName.charCodeAt(packageName.length - 1) % COLORS.length];
  const letter = appName[0]?.toUpperCase() || '?';

  return (
    <div className={`${dim} rounded-2xl flex items-center justify-center overflow-hidden shrink-0 shadow-lg ${iconSrc ? '' : color}`}>
      {iconSrc
        ? <img src={iconSrc} className="w-full h-full object-cover" alt={appName} />
        : <span className="text-white font-bold text-lg font-outfit">{letter}</span>}
    </div>
  );
};

// ── Analytics sub-components ──────────────────────────────────────────────────

const StreakCard = ({ days }: { days: number }) => {
  const next = days < 3 ? 3 : days < 7 ? 7 : days < 14 ? 14 : days < 30 ? 30 : days + 10;
  return (
    <div className="mb-8 p-6 rounded-[2rem] bg-gradient-to-br from-orange-500/10 to-transparent border border-orange-500/20">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold flex items-center gap-2 mb-2 text-white font-outfit">
            <Award size={18} className="text-orange-400" /> Perfect Tracking
          </h3>
          <p className="text-4xl font-black text-orange-400 text-glow font-outfit">{days} day{days !== 1 ? 's' : ''}</p>
          <p className="text-sm text-zinc-400 mt-1">
            {days === 0 ? 'Start today — stay under all limits!' : `Next milestone: ${next} days 🎯`}
          </p>
        </div>
        <motion.div 
          animate={{ y: [0, -5, 0] }} 
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          className="text-5xl drop-shadow-[0_0_15px_rgba(249,115,22,0.5)]">
          {days >= 7 ? '🔥' : days >= 3 ? '⚡' : '🌱'}
        </motion.div>
      </div>
    </div>
  );
};

const WeeklyTrend = ({ data }: { data: WeeklyStatDay[] }) => {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const scores = data.length === 7 ? data.map(d => d.focusScore) : [72, 68, 75, 74, 79, 82, 84];
  const hasRealData = data.length === 7 && data.some(d => d.focusScore > 0);

  return (
    <div className="mb-8 p-6 rounded-[2rem] glass-card">
      <h3 className="font-bold mb-6 flex items-center gap-2 text-white font-outfit">
        <TrendingUp size={18} className="text-emerald-400" /> Weekly Trend
        {!hasRealData && <span className="text-xs text-zinc-500 font-normal ml-auto">Sample data</span>}
      </h3>
      <div className="flex items-end justify-between h-32 gap-3">
        {days.map((day, i) => {
          const isHigh = scores[i] >= 80;
          return (
            <div key={day} className="flex flex-col items-center flex-1">
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: `${(scores[i] / 100) * 128}px` }}
                transition={{ delay: i * 0.1, type: 'spring', damping: 15 }}
                className={`w-full rounded-t-lg ${scores[i] > 0 ? (isHigh ? 'bg-gradient-to-t from-emerald-600/50 to-emerald-400 glow-ring' : 'bg-gradient-to-t from-zinc-700/50 to-zinc-500') : 'bg-zinc-800'}`}
              />
              <span className="text-[10px] text-zinc-500 mt-3 font-semibold uppercase tracking-wider">{day}</span>
            </div>
          )
        })}
      </div>
    </div>
  );
};

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [step, setStep] = useState<AppState>('loading');
  const [onboardingStep, setOnboardingStep] = useState(0);

  // Setup screen state
  const [installedApps, setInstalledApps] = useState<InstalledApp[]>([]);
  const [loadingApps, setLoadingApps] = useState(false);

  // Dashboard state
  const [monitoredApps, setMonitoredApps] = useState<MonitoredApp[]>([]);
  const [stats, setStats] = useState<DashboardStats>(DEFAULT_STATS);
  const [weeklyData, setWeeklyData] = useState<WeeklyStatDay[]>([]);
  const [loadingDashboard, setLoadingDashboard] = useState(false);

  // ── Initialization ──────────────────────────────────────────────────────────
  
  useEffect(() => {
    if (window.Android) {
      try {
        const perms = JSON.parse(window.Android.isPermissionsGranted());
        if (perms.onboardingComplete) {
          const apps = JSON.parse(window.Android.getMonitoredApps());
          setStep(apps.length > 0 ? 'dashboard' : 'setup');
        } else {
          setStep('onboarding');
        }
      } catch (e) {
        setStep('onboarding');
      }
    } else {
      setTimeout(() => setStep('onboarding'), 800); // Desktop demo lag
    }
  }, []);

  // ── Data loading ────────────────────────────────────────────────────────────

  const loadSetupApps = () => {
    setLoadingApps(true);
    setTimeout(() => {
      if (window.Android) {
        try {
          const installed: { packageName: string; appName: string }[] =
            JSON.parse(window.Android.getInstalledApps());
          const monitored: { packageName: string; dailyLimitMinutes: number }[] =
            JSON.parse(window.Android.getMonitoredApps());
          const monitoredMap = new Map(monitored.map(m => [m.packageName, m.dailyLimitMinutes]));

          setInstalledApps(installed.map(app => ({
            ...app,
            limitMinutes: monitoredMap.get(app.packageName) ?? 30,
            isSelected: monitoredMap.has(app.packageName),
          })));
        } catch (e) {
          setInstalledApps(DEMO_INSTALLED);
        }
      } else {
        setInstalledApps(DEMO_INSTALLED);
      }
      setLoadingApps(false);
    }, 0);
  };

  const loadDashboard = () => {
    setLoadingDashboard(true);
    setTimeout(() => {
      if (window.Android) {
        try {
          const usageArr: { packageName: string; usedMinutes: number; limitMinutes: number }[] =
            JSON.parse(window.Android.getTodayUsage());
          const monitoredArr: { packageName: string; appName: string; dailyLimitMinutes: number }[] =
            JSON.parse(window.Android.getMonitoredApps());
          const usageMap = new Map(usageArr.map(u => [u.packageName, u.usedMinutes]));

          setMonitoredApps(monitoredArr.map(app => ({
            packageName: app.packageName,
            appName: app.appName,
            dailyLimitMinutes: app.dailyLimitMinutes,
            usedMinutes: usageMap.get(app.packageName) ?? 0,
          })));

          const s: DashboardStats = JSON.parse(window.Android.getDashboardStats());
          setStats(s);

          const weekly: WeeklyStatDay[] = JSON.parse(window.Android.getWeeklyStats());
          setWeeklyData(weekly);
        } catch (e) {}
      }
      setLoadingDashboard(false);
    }, 0);
  };

  useEffect(() => { if (step === 'setup') loadSetupApps(); }, [step]);
  useEffect(() => { if (step === 'dashboard') loadDashboard(); }, [step]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const toggleApp = (pkg: string) =>
    setInstalledApps(prev => prev.map(a => a.packageName === pkg ? { ...a, isSelected: !a.isSelected } : a));

  const updateLimit = (pkg: string, minutes: number) =>
    setInstalledApps(prev => prev.map(a => a.packageName === pkg ? { ...a, limitMinutes: minutes } : a));

  const finishSetup = () => {
    const selected = installedApps.filter(a => a.isSelected);
    if (window.Android) {
      selected.forEach(app => window.Android!.saveApp(app.packageName, app.limitMinutes, app.appName));
    }
    setStep('dashboard');
  };

  const toggleStrictMode = (enabled: boolean) => {
    setStats(s => ({ ...s, strictMode: enabled }));
    window.Android?.setStrictMode(enabled);
  };

  // ── Loading ─────────────────────────────────────────────────────────────────
  
  if (step === 'loading') {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
          <Loader size={32} className="text-white opacity-50" aria-label="Loading" />
        </motion.div>
      </div>
    );
  }

  // ── Onboarding ──────────────────────────────────────────────────────────────

  const OnboardingView = () => {
    const steps = [
      { title: 'Extreme Focus.', description: 'Block distractions and reclaim your time. Set hard limits that give you back control over your attention.', icon: <Smartphone className="text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.8)]" size={48} /> },
      { title: 'Choose Targets', description: 'Grant access so FocusFine can accurately track and block the apps that drain your productivity.', icon: <BarChart3 className="text-emerald-400 drop-shadow-[0_0_15px_rgba(52,211,153,0.8)]" size={48} />, permission: 'Enable Tracking', action: () => window.Android?.requestUsageAccess() },
      { title: 'Ironclad Lock', description: 'Allow us to overlay the lock screen over distractive apps instantly. No way back until the timer hits zero.', icon: <ShieldCheck className="text-blue-400 drop-shadow-[0_0_15px_rgba(96,165,250,0.8)]" size={48} />, permission: 'Enable Lock Screen', action: () => window.Android?.requestOverlay() },
      { title: 'Unstoppable Mode', description: 'To prevent any bypass, FocusFine runs persistently. This is your commitment to staying focused.', icon: <Zap className="text-amber-400 drop-shadow-[0_0_15px_rgba(251,191,36,0.8)]" size={48} />, permission: 'Enable Unstoppable Mode', action: () => window.Android?.requestBatteryOptimization() },
    ];
    const current = steps[onboardingStep];
    const isLast = onboardingStep === steps.length - 1;

    const handlePermissionTap = () => {
      current.action?.();
      if (isLast) setStep('setup');
      else setOnboardingStep(s => s + 1);
    };

    return (
      <div className="flex flex-col items-center justify-center min-h-[90vh] text-center px-6 relative overflow-hidden">
        {/* Background ambient glow */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-emerald-500/10 rounded-full blur-[100px] pointer-events-none" />

        <motion.div key={onboardingStep} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, y: -20 }} className="max-w-md w-full relative z-10">
          <div className="mb-10 flex justify-center">
            <motion.div 
              animate={{ y: [0, -10, 0] }} 
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              className="w-32 h-32 glass-card rounded-full flex items-center justify-center border-white/10 relative">
              <div className="absolute inset-0 rounded-full border border-white/20 scale-105 opacity-50" />
              {current.icon}
            </motion.div>
          </div>
          <h1 className="text-4xl font-black tracking-tight mb-4 text-white font-outfit">{current.title}</h1>
          <p className="text-zinc-400 text-lg mb-12 leading-relaxed">{current.description}</p>
          <div className="space-y-4">
            {current.permission ? (
              <Button onClick={handlePermissionTap} ariaLabel={current.permission} className="w-full py-5 text-lg shadow-[0_0_30px_rgba(255,255,255,0.15)]">{current.permission}</Button>
            ) : (
              <Button onClick={() => setOnboardingStep(1)} ariaLabel="Begin Setup" className="w-full py-5 text-lg shadow-[0_0_30px_rgba(255,255,255,0.15)]">Begin Setup <ArrowRight size={20} /></Button>
            )}
            <div className="flex justify-center gap-2 mt-10">
              {steps.map((_, i) => (
                <div key={i} className={`h-1.5 rounded-full transition-all duration-300 ${i === onboardingStep ? 'w-8 bg-white shadow-[0_0_10px_rgba(255,255,255,0.8)]' : 'w-2 bg-zinc-800'}`} />
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    );
  };

  // ── Setup ───────────────────────────────────────────────────────────────────

  const SetupView = () => {
    const selectedCount = installedApps.filter(a => a.isSelected).length;

    return (
      <div className="max-w-2xl mx-auto px-6 py-16 relative">
        <header className="mb-10 text-center relative z-10">
          <p className="text-emerald-400 text-xs font-bold uppercase tracking-widest mb-2 font-outfit">Phase 1</p>
          <h1 className="text-4xl font-black mb-3 text-white font-outfit">Select Targets</h1>
          <p className="text-zinc-400">Lock down the apps that consume your time.</p>
        </header>

        {loadingApps ? (
          <div className="flex items-center justify-center py-20 text-zinc-500">
            <Loader size={24} className="animate-spin mr-3" /> Loading applications…
          </div>
        ) : (
          <div className="space-y-4 mb-24 max-h-[55vh] overflow-y-auto pb-6 custom-scrollbar relative z-10">
            {installedApps.map((app, i) => (
              <motion.div 
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                key={app.packageName} onClick={() => toggleApp(app.packageName)}
                className={`flex items-center justify-between p-5 rounded-[2rem] transition-all cursor-pointer ${app.isSelected ? 'glass-card-active' : 'glass-card hover:bg-zinc-800/40'}`}>
                <div className="flex items-center gap-4">
                  <AppIcon packageName={app.packageName} appName={app.appName} />
                  <div>
                    <h3 className="font-semibold text-white text-lg font-outfit">{app.appName}</h3>
                    {app.isSelected && (
                      <div className="flex items-center gap-2 mt-1" onClick={e => e.stopPropagation()}>
                        <Clock size={14} className="text-emerald-400" />
                        <input type="number" value={app.limitMinutes} min={1} max={720}
                          aria-label={`Daily limit for ${app.appName} in minutes`}
                          title={`Set daily limit for ${app.appName}`}
                          onChange={e => updateLimit(app.packageName, parseInt(e.target.value) || 1)}
                          className="w-12 bg-transparent border-b border-zinc-600 focus:border-emerald-400 outline-none text-sm font-medium text-white p-0 text-center" />
                        <span className="text-xs text-zinc-500 uppercase font-bold tracking-wider">min / day</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all ${app.isSelected ? 'bg-emerald-500 border-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.5)]' : 'border-zinc-700'}`}>
                  {app.isSelected && <CheckCircle2 size={16} className="text-black" />}
                </div>
              </motion.div>
            ))}
          </div>
        )}

        <div className="fixed bottom-0 left-0 w-full p-6 bg-gradient-to-t from-black via-black to-transparent z-20">
          <Button disabled={selectedCount === 0 || loadingApps} onClick={finishSetup} ariaLabel="Finish Setup" className="w-full py-5 text-lg shadow-[0_0_30px_rgba(255,255,255,0.1)]">
            {selectedCount === 0 ? 'Select at least one' : `Engage Lock on ${selectedCount} App${selectedCount > 1 ? 's' : ''}`}
          </Button>
        </div>
      </div>
    );
  };

  // ── Dashboard ───────────────────────────────────────────────────────────────

  const DashboardView = () => {
    const scoreSign = stats.scoreDiffVsYesterday >= 0 ? '+' : '';
    const timeSavedHrs = (stats.timeSavedMinutes / 60).toFixed(1);

    return (
      <div className="max-w-2xl mx-auto px-6 py-12 pb-32 relative">
        {/* Background mesh glow */}
        <div className="fixed top-[-10%] left-[-10%] w-[120%] h-[50vh] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-900/20 via-black to-black pointer-events-none z-0" />

        {/* Header */}
        <header className="flex items-center justify-between mb-10 relative z-10">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-white flex items-center gap-3 font-outfit">
              FocusFine <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,1)]" aria-hidden="true" />
            </h1>
            <p className="text-zinc-500 text-sm font-medium tracking-wide mt-1 uppercase">
              {loadingDashboard ? 'Synchronizing…' : 'SYSTEM ACTIVE'}
            </p>
          </div>
          <button onClick={loadDashboard}
            aria-label="Refresh Dashboard"
            title="Refresh Dashboard"
            className="p-3.5 rounded-[1.25rem] glass-card text-zinc-400 hover:text-white transition-colors active:scale-95">
            <Settings size={22} className={loadingDashboard ? 'animate-spin' : ''} />
          </button>
        </header>

        {/* Focus Score Hero Radial/Wave simulation */}
        <div className="mb-8 p-10 rounded-[2.5rem] glass-card relative overflow-hidden z-10 border border-white/10 group">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent opacity-50 group-hover:opacity-100 transition-opacity duration-700" />
          <div className="relative z-10 flex flex-col items-center text-center">
            <p className="text-zinc-400 text-xs font-black uppercase tracking-[0.2em] mb-4">Focus Score</p>
            <div className="relative">
              {/* Outer glowing ring simulation */}
              <div className="absolute inset-0 rounded-full blur-2xl bg-emerald-500/20 scale-150" />
              <h2 className="text-8xl font-black text-white text-glow tracking-tighter font-outfit">
                {stats.focusScore}
              </h2>
            </div>
            
            {stats.scoreDiffVsYesterday !== 0 && (
              <div className="mt-6 flex items-center gap-2">
                <div className={`px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider ${stats.scoreDiffVsYesterday >= 0 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.2)]' : 'bg-red-500/10 text-red-500 border border-red-500/20'}`}>
                  {scoreSign}{stats.scoreDiffVsYesterday}% vs Yesterday
                </div>
              </div>
            )}
            
            <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden mt-8 shadow-inner" aria-hidden="true">
              <motion.div initial={{ width: 0 }} animate={{ width: `${stats.focusScore}%` }} transition={{ duration: 1.2, ease: "easeOut" }}
                className="h-full bg-emerald-400 glow-ring rounded-full" />
            </div>
          </div>
        </div>

        {/* Stat tiles */}
        <div className="grid grid-cols-2 gap-4 mb-10 relative z-10">
          <Card className="flex flex-col items-center text-center hover:bg-zinc-800/40 transition-colors">
            <DollarSign className="text-zinc-500 mb-3" size={24} />
            <p className="text-zinc-500 text-[10px] font-black uppercase tracking-wider mb-2">Spent To Unlock</p>
            <h2 className="text-3xl font-bold text-white font-outfit">${stats.totalSpentToday.toFixed(2)}</h2>
            {stats.totalSpentThisWeek > 0 && <p className="text-xs text-zinc-500 mt-2">${stats.totalSpentThisWeek.toFixed(2)} week</p>}
          </Card>
          <Card className="flex flex-col items-center text-center hover:bg-zinc-800/40 transition-colors">
            <Clock className="text-zinc-500 mb-3" size={24} />
            <p className="text-zinc-500 text-[10px] font-black uppercase tracking-wider mb-2">Time Rescued</p>
            <h2 className="text-3xl font-bold text-emerald-400 text-glow font-outfit">{timeSavedHrs}<span className="text-sm font-semibold text-zinc-500 ml-1 uppercase">hrs</span></h2>
          </Card>
        </div>

        {/* Strict Mode toggle */}
        <div className={`relative z-10 mb-10 p-6 rounded-[2rem] transition-all flex items-center justify-between ${stats.strictMode ? 'bg-red-950/30 border border-red-500/30 shadow-[0_0_30px_rgba(239,68,68,0.15)]' : 'glass-card'}`}>
          <div className="flex items-center gap-5">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${stats.strictMode ? 'bg-red-500/20 text-red-400' : 'bg-zinc-800 text-zinc-400'}`}>
              <Lock size={20} />
            </div>
            <div>
              <h3 className={`font-bold text-lg mb-0.5 font-outfit ${stats.strictMode ? 'text-red-400' : 'text-white'}`}>Hardcore Mode</h3>
              <p className={`text-xs font-medium uppercase tracking-wider ${stats.strictMode ? 'text-red-500/70' : 'text-zinc-500'}`}>
                {stats.strictMode ? 'Unlocks Disabled' : 'Emergency Unlocks Allowed'}
              </p>
            </div>
          </div>
          <button onClick={() => toggleStrictMode(!stats.strictMode)}
            aria-label={stats.strictMode ? "Disable Hardcore Mode" : "Enable Hardcore Mode"}
            title={stats.strictMode ? "Disable Hardcore Mode" : "Enable Hardcore Mode"}
            className={`w-14 h-8 rounded-full transition-all relative ${stats.strictMode ? 'bg-red-500' : 'bg-zinc-700'}`}>
            <div className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow transition-all ${stats.strictMode ? 'left-7' : 'left-1'}`} />
          </button>
        </div>

        {/* Active Limits */}
        <div className="relative z-10">
          <h2 className="text-xl font-bold mb-6 flex items-center gap-3 text-white font-outfit">
            Target Locks
            <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full">{monitoredApps.length}</span>
          </h2>

          <div className="space-y-4">
            {monitoredApps.length === 0 && !loadingDashboard && (
              <div className="glass-card p-8 rounded-[2rem] text-center">
                <p className="text-zinc-500 mb-4">No targets assigned.</p>
                <Button onClick={() => setStep('setup')} variant="outline" ariaLabel="Add first target" className="w-full">Deploy First Lock</Button>
              </div>
            )}
            <AnimatePresence>
              {monitoredApps.map(app => {
                const pct = Math.min((app.usedMinutes / app.dailyLimitMinutes) * 100, 100);
                const isOver = app.usedMinutes > app.dailyLimitMinutes;
                return (
                  <motion.div key={app.packageName} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, height: 0 }}
                    className="glass-card rounded-[2rem] p-6 relative overflow-hidden group">
                    <div className="flex items-center justify-between relative z-10">
                      <div className="flex items-center gap-5">
                        <AppIcon packageName={app.packageName} appName={app.appName} />
                        <div>
                          <h3 className="font-bold text-white text-lg font-outfit">{app.appName}</h3>
                          <p className={`text-xs font-bold uppercase tracking-wider mt-1 ${isOver ? 'text-red-400' : 'text-zinc-500'}`}>
                            {app.usedMinutes} / {app.dailyLimitMinutes} min
                            {isOver && ' · BREACHED'}
                          </p>
                        </div>
                      </div>
                      <button onClick={() => {
                          window.Android?.removeApp(app.packageName);
                          setMonitoredApps(prev => prev.filter(a => a.packageName !== app.packageName));
                        }}
                        aria-label={`Remove lock for ${app.appName}`}
                        title={`Remove lock for ${app.appName}`}
                        className="w-10 h-10 rounded-full flex items-center justify-center bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white transition-colors">
                        <X size={16} />
                      </button>
                    </div>
                    {/* Usage bar */}
                    <div className="absolute bottom-0 left-0 w-full h-1.5 bg-zinc-800" aria-hidden="true">
                      <div className={`h-full transition-all duration-700 w-[var(--progress)] ${isOver ? 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)]' : 'bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.5)]'}`}
                        style={{ '--progress': `${pct}%` } as React.CSSProperties} />
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>

            {monitoredApps.length > 0 && (
              <button onClick={() => setStep('setup')}
                aria-label="Add target app"
                title="Add target app"
                className="w-full py-5 rounded-[2rem] border border-dashed border-zinc-700 text-zinc-500 flex items-center justify-center gap-2 hover:border-zinc-500 hover:text-white transition-all hover:bg-zinc-900/50">
                <Plus size={18} /> Add Target
              </button>
            )}
          </div>
        </div>

        {/* Analytics */}
        <div className="mt-16 relative z-10">
          <h2 className="text-xl font-bold mb-6 flex items-center gap-3 text-white font-outfit">
            <BarChart3 size={20} className="text-zinc-500" /> Executive summary
          </h2>
          <StreakCard days={stats.streakDays} />
          <WeeklyTrend data={weeklyData} />
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-black text-white font-sans selection:bg-emerald-500/30 selection:text-white">
      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="min-h-screen">
          {step === 'onboarding' && <OnboardingView />}
          {step === 'setup' && <SetupView />}
          {step === 'dashboard' && <DashboardView />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

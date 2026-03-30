/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Smartphone, Clock, ShieldCheck, Zap, CheckCircle2, ArrowRight,
  Lock, DollarSign, X, Settings, BarChart3, Plus, TrendingUp,
  Flame, Award, Loader
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
type AppState = 'onboarding' | 'setup' | 'dashboard';

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
  children, onClick, variant = 'primary', className = '', disabled = false,
}: {
  children: React.ReactNode; onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  className?: string; disabled?: boolean;
}) => {
  const variants = {
    primary: 'bg-black dark:bg-white text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-200',
    secondary: 'bg-zinc-100 dark:bg-zinc-800 text-black dark:text-white hover:bg-zinc-200 dark:hover:bg-zinc-700',
    outline: 'border border-zinc-200 dark:border-zinc-700 text-black dark:text-white hover:bg-zinc-50 dark:hover:bg-zinc-900',
    ghost: 'text-zinc-500 dark:text-zinc-400 hover:text-black dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800',
    danger: 'bg-red-500 text-white hover:bg-red-600',
  };
  return (
    <button onClick={onClick} disabled={disabled}
      className={`px-6 py-3 rounded-2xl font-medium transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2 ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
};

const Card = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <div className={`bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-100 dark:border-zinc-800 shadow-sm p-6 ${className}`}>
    {children}
  </div>
);

/** Lazily loads the real app icon via the Android bridge; falls back to a coloured initial. */
const AppIcon = ({ packageName, appName, size = 'md' }: { packageName: string; appName: string; size?: 'sm' | 'md' }) => {
  const [iconSrc, setIconSrc] = useState('');
  const dim = size === 'sm' ? 'w-10 h-10' : 'w-12 h-12';

  useEffect(() => {
    if (!window.Android) return;
    // Use setTimeout to yield back to the UI thread before the synchronous bridge call
    const t = setTimeout(() => {
      const icon = window.Android!.getAppIcon(packageName);
      if (icon) setIconSrc(icon);
    }, 0);
    return () => clearTimeout(t);
  }, [packageName]);

  const COLORS = [
    'bg-purple-500', 'bg-blue-500', 'bg-green-500',
    'bg-red-500', 'bg-orange-500', 'bg-pink-500', 'bg-indigo-500',
  ];
  const color = COLORS[packageName.charCodeAt(packageName.length - 1) % COLORS.length];
  const letter = appName[0]?.toUpperCase() || '?';

  return (
    <div className={`${dim} rounded-2xl flex items-center justify-center overflow-hidden shrink-0 ${iconSrc ? '' : color}`}>
      {iconSrc
        ? <img src={iconSrc} className="w-full h-full object-cover" alt={appName} />
        : <span className="text-white font-bold text-lg">{letter}</span>}
    </div>
  );
};

// ── Analytics sub-components ──────────────────────────────────────────────────

const StreakCard = ({ days }: { days: number }) => {
  const next = days < 3 ? 3 : days < 7 ? 7 : days < 14 ? 14 : days < 30 ? 30 : days + 10;
  return (
    <div className="mb-8 p-6 rounded-3xl bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 border border-orange-200 dark:border-orange-900/40">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold flex items-center gap-2 mb-2 text-zinc-900 dark:text-white">
            <Award size={18} className="text-orange-500" /> Perfect Days Streak
          </h3>
          <p className="text-3xl font-black text-orange-600">{days} day{days !== 1 ? 's' : ''}</p>
          <p className="text-sm text-orange-700 dark:text-orange-400 mt-1">
            {days === 0 ? 'Start today — stay under all limits!' : `Next milestone: ${next} days 🎯`}
          </p>
        </div>
        <div className="text-5xl">{days >= 7 ? '🔥' : days >= 3 ? '⚡' : '🌱'}</div>
      </div>
    </div>
  );
};

const WeeklyTrend = ({ data }: { data: WeeklyStatDay[] }) => {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const scores = data.length === 7 ? data.map(d => d.focusScore) : [72, 68, 75, 74, 79, 82, 84];
  const hasRealData = data.length === 7 && data.some(d => d.focusScore > 0);

  return (
    <div className="mb-8 p-6 rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800">
      <h3 className="font-bold mb-4 flex items-center gap-2 text-zinc-900 dark:text-white">
        <TrendingUp size={18} className="text-green-500" /> Weekly Improvement
        {!hasRealData && <span className="text-xs text-zinc-400 font-normal ml-auto">Builds up over time</span>}
      </h3>
      <div className="flex items-end justify-between h-28 gap-2">
        {days.map((day, i) => (
          <div key={day} className="flex flex-col items-center flex-1">
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: `${(scores[i] / 100) * 112}px` }}
              transition={{ delay: i * 0.05 }}
              className={`w-full rounded-t-lg ${scores[i] > 0 ? 'bg-gradient-to-t from-green-500 to-green-300' : 'bg-zinc-200 dark:bg-zinc-700'}`}
            />
            <span className="text-xs text-zinc-400 dark:text-zinc-500 mt-2">{day}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [step, setStep] = useState<AppState>('onboarding');
  const [onboardingStep, setOnboardingStep] = useState(0);

  // Setup screen state
  const [installedApps, setInstalledApps] = useState<InstalledApp[]>([]);
  const [loadingApps, setLoadingApps] = useState(false);

  // Dashboard state
  const [monitoredApps, setMonitoredApps] = useState<MonitoredApp[]>([]);
  const [stats, setStats] = useState<DashboardStats>(DEFAULT_STATS);
  const [weeklyData, setWeeklyData] = useState<WeeklyStatDay[]>([]);
  const [loadingDashboard, setLoadingDashboard] = useState(false);

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
        } catch (e) {
          // Keep demo stats on error
        }
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

  // ── Onboarding ──────────────────────────────────────────────────────────────

  const OnboardingView = () => {
    const steps = [
      { title: 'Welcome to FocusFine', description: 'The dead-simple way to reclaim your time. Set limits, and if you break them, it\'ll cost you.', icon: <Smartphone className="text-black dark:text-white" size={48} /> },
      { title: 'Usage Access', description: 'We need to know how long you spend on each app to help you stay focused.', icon: <BarChart3 className="text-sky-500" size={48} />, permission: 'Grant Usage Access', action: () => window.Android?.requestUsageAccess() },
      { title: 'Overlay Permission', description: 'This lets us show the lock screen when you hit your daily limit.', icon: <ShieldCheck className="text-green-500" size={48} />, permission: 'Allow Drawing Over Apps', action: () => window.Android?.requestOverlay() },
      { title: 'Battery Optimization', description: 'We need to run in the background to monitor your usage reliably.', icon: <Zap className="text-yellow-500" size={48} />, permission: 'Ignore Battery Optimization', action: () => window.Android?.requestBatteryOptimization() },
    ];
    const current = steps[onboardingStep];
    const isLast = onboardingStep === steps.length - 1;

    const handlePermissionTap = () => {
      current.action?.();
      if (isLast) setStep('setup');
      else setOnboardingStep(s => s + 1);
    };

    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] text-center px-6">
        <motion.div key={onboardingStep} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="max-w-md w-full">
          <div className="mb-8 flex justify-center">
            <div className="w-24 h-24 bg-zinc-50 dark:bg-zinc-900 rounded-[2rem] flex items-center justify-center shadow-inner">
              {current.icon}
            </div>
          </div>
          <h1 className="text-3xl font-bold tracking-tight mb-4 text-zinc-900 dark:text-white">{current.title}</h1>
          <p className="text-zinc-500 dark:text-zinc-400 text-lg mb-12 leading-relaxed">{current.description}</p>
          <div className="space-y-4">
            {current.permission ? (
              <Button onClick={handlePermissionTap} className="w-full py-4 text-lg">{current.permission}</Button>
            ) : (
              <Button onClick={() => setOnboardingStep(1)} className="w-full py-4 text-lg">Get Started <ArrowRight size={20} /></Button>
            )}
            <div className="flex justify-center gap-2 mt-8">
              {steps.map((_, i) => (
                <div key={i} className={`h-1.5 rounded-full transition-all duration-300 ${i === onboardingStep ? 'w-8 bg-black dark:bg-white' : 'w-2 bg-zinc-200 dark:bg-zinc-700'}`} />
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
      <div className="max-w-2xl mx-auto px-6 py-12">
        <header className="mb-8">
          <h1 className="text-3xl font-bold mb-2 text-zinc-900 dark:text-white">Setup Your Limits</h1>
          <p className="text-zinc-500 dark:text-zinc-400">Pick the apps that distract you most.</p>
        </header>

        {loadingApps ? (
          <div className="flex items-center justify-center py-20 text-zinc-400">
            <Loader size={24} className="animate-spin mr-3" /> Loading apps…
          </div>
        ) : (
          <div className="space-y-3 mb-10 max-h-[60vh] overflow-y-auto pr-1">
            {installedApps.map(app => (
              <div key={app.packageName} onClick={() => toggleApp(app.packageName)}
                className={`flex items-center justify-between p-4 rounded-3xl border transition-all cursor-pointer ${app.isSelected ? 'border-black dark:border-white bg-zinc-50 dark:bg-zinc-800' : 'border-zinc-100 dark:border-zinc-800 hover:border-zinc-200 dark:hover:border-zinc-700'}`}>
                <div className="flex items-center gap-3">
                  <AppIcon packageName={app.packageName} appName={app.appName} />
                  <div>
                    <h3 className="font-semibold text-zinc-900 dark:text-white">{app.appName}</h3>
                    {app.isSelected && (
                      <div className="flex items-center gap-2 mt-1" onClick={e => e.stopPropagation()}>
                        <Clock size={13} className="text-zinc-400" />
                        <input type="number" value={app.limitMinutes} min={1} max={720}
                          onChange={e => updateLimit(app.packageName, parseInt(e.target.value) || 1)}
                          className="w-12 bg-transparent border-b border-zinc-300 dark:border-zinc-600 focus:border-black dark:focus:border-white outline-none text-sm font-medium text-zinc-900 dark:text-white" />
                        <span className="text-xs text-zinc-400 uppercase font-bold tracking-wider">min/day</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${app.isSelected ? 'bg-black dark:bg-white border-black dark:border-white' : 'border-zinc-200 dark:border-zinc-700'}`}>
                  {app.isSelected && <CheckCircle2 size={14} className="text-white dark:text-black" />}
                </div>
              </div>
            ))}
          </div>
        )}

        <Button disabled={selectedCount === 0 || loadingApps} onClick={finishSetup} className="w-full py-4 text-lg">
          {selectedCount === 0 ? 'Select at least one app' : `Monitor ${selectedCount} app${selectedCount > 1 ? 's' : ''}`}
        </Button>
      </div>
    );
  };

  // ── Dashboard ───────────────────────────────────────────────────────────────

  const DashboardView = () => {
    const scoreSign = stats.scoreDiffVsYesterday >= 0 ? '+' : '';
    const timeSavedHrs = (stats.timeSavedMinutes / 60).toFixed(1);

    return (
      <div className="max-w-2xl mx-auto px-6 py-12 pb-28">
        {/* Header */}
        <header className="flex items-center justify-between mb-10">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">FocusFine</h1>
            <p className="text-zinc-500 dark:text-zinc-400 text-sm">
              {loadingDashboard ? 'Refreshing…' : 'Monitoring active'}
            </p>
          </div>
          <button onClick={loadDashboard}
            className="p-3 rounded-2xl bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
            <Settings size={20} />
          </button>
        </header>

        {/* Focus Score Hero */}
        <div className="mb-8 p-8 rounded-[2.5rem] bg-gradient-to-br from-zinc-900 to-black text-white relative overflow-hidden">
          <div className="relative z-10">
            <div className="flex justify-between items-start mb-6">
              <div>
                <p className="text-zinc-400 text-xs font-bold uppercase tracking-widest mb-1">Your Focus Score</p>
                <h2 className="text-6xl font-black">{stats.focusScore}<span className="text-2xl text-zinc-500">/100</span></h2>
              </div>
              {stats.scoreDiffVsYesterday !== 0 && (
                <div className={`px-3 py-1 rounded-full text-xs font-bold border ${stats.scoreDiffVsYesterday >= 0 ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-red-500/20 text-red-400 border-red-500/30'}`}>
                  {scoreSign}{stats.scoreDiffVsYesterday}% vs Yesterday
                </div>
              )}
            </div>
            <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
              <motion.div initial={{ width: 0 }} animate={{ width: `${stats.focusScore}%` }} transition={{ duration: 0.8 }}
                className="h-full bg-white rounded-full" />
            </div>
          </div>
          <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-white/5 rounded-full blur-3xl" />
        </div>

        {/* Stat tiles */}
        <div className="grid grid-cols-2 gap-4 mb-10">
          <Card>
            <DollarSign className="text-zinc-400 dark:text-zinc-500 mb-4" size={24} />
            <p className="text-zinc-400 dark:text-zinc-500 text-xs font-bold uppercase tracking-wider mb-1">Spent Today</p>
            <h2 className="text-4xl font-bold text-zinc-900 dark:text-white">${stats.totalSpentToday.toFixed(2)}</h2>
            {stats.totalSpentThisWeek > 0 && (
              <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">${stats.totalSpentThisWeek.toFixed(2)} this week</p>
            )}
          </Card>
          <Card>
            <Clock className="text-zinc-400 dark:text-zinc-500 mb-4" size={24} />
            <p className="text-zinc-400 dark:text-zinc-500 text-xs font-bold uppercase tracking-wider mb-1">Time Saved</p>
            <h2 className="text-4xl font-bold text-zinc-900 dark:text-white">{timeSavedHrs}<span className="text-lg font-medium text-zinc-400 dark:text-zinc-500 ml-1">hrs</span></h2>
          </Card>
        </div>

        {/* Strict Mode toggle */}
        <div className={`mb-10 p-6 rounded-3xl border-2 transition-all flex items-center justify-between ${stats.strictMode ? 'border-red-500 bg-red-50 dark:bg-red-900/20' : 'border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900'}`}>
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${stats.strictMode ? 'bg-red-500 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500'}`}>
              <Lock size={24} />
            </div>
            <div>
              <h3 className={`font-bold ${stats.strictMode ? 'text-red-900 dark:text-red-400' : 'text-zinc-900 dark:text-white'}`}>Strict Mode</h3>
              <p className={`text-sm ${stats.strictMode ? 'text-red-700 dark:text-red-500' : 'text-zinc-400 dark:text-zinc-500'}`}>
                {stats.strictMode ? 'Pay-to-unlock is disabled.' : 'Allow emergency unlocks.'}
              </p>
            </div>
          </div>
          <button onClick={() => toggleStrictMode(!stats.strictMode)}
            className={`w-14 h-8 rounded-full transition-all relative ${stats.strictMode ? 'bg-red-500' : 'bg-zinc-200 dark:bg-zinc-700'}`}>
            <div className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow transition-all ${stats.strictMode ? 'left-7' : 'left-1'}`} />
          </button>
        </div>

        {/* Active Limits */}
        <h2 className="text-xl font-bold mb-5 flex items-center gap-2 text-zinc-900 dark:text-white">
          Active Limits
          <span className="text-sm font-normal text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full">{monitoredApps.length}</span>
        </h2>

        <div className="space-y-3">
          {monitoredApps.length === 0 && !loadingDashboard && (
            <p className="text-center text-zinc-400 dark:text-zinc-500 py-6 text-sm">No apps monitored yet. Tap + to add one.</p>
          )}
          {monitoredApps.map(app => {
            const pct = Math.min((app.usedMinutes / app.dailyLimitMinutes) * 100, 100);
            const isOver = app.usedMinutes > app.dailyLimitMinutes;
            return (
              <div key={app.packageName}
                className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-100 dark:border-zinc-800 shadow-sm p-6 relative overflow-hidden">
                <div className="flex items-center justify-between relative z-10">
                  <div className="flex items-center gap-4">
                    <AppIcon packageName={app.packageName} appName={app.appName} />
                    <div>
                      <h3 className="font-bold text-zinc-900 dark:text-white">{app.appName}</h3>
                      <p className={`text-sm ${isOver ? 'text-red-500' : 'text-zinc-400 dark:text-zinc-500'}`}>
                        {app.usedMinutes}m / {app.dailyLimitMinutes}m used
                        {isOver && ' · Over limit'}
                      </p>
                    </div>
                  </div>
                  <X size={18} className="text-zinc-300 dark:text-zinc-600 cursor-pointer hover:text-zinc-500"
                    onClick={() => {
                      window.Android?.removeApp(app.packageName);
                      setMonitoredApps(prev => prev.filter(a => a.packageName !== app.packageName));
                    }} />
                </div>
                {/* Usage bar */}
                <div className="absolute bottom-0 left-0 w-full h-1 bg-zinc-50 dark:bg-zinc-800">
                  <div className={`h-full transition-all duration-700 ${isOver ? 'bg-red-500' : 'bg-zinc-900 dark:bg-white'}`}
                    style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}

          <button onClick={() => setStep('setup')}
            className="w-full py-5 rounded-3xl border-2 border-dashed border-zinc-200 dark:border-zinc-700 text-zinc-400 dark:text-zinc-500 flex items-center justify-center gap-2 hover:border-zinc-300 dark:hover:border-zinc-600 hover:text-zinc-500 dark:hover:text-zinc-400 transition-all">
            <Plus size={20} /> Add App
          </button>
        </div>

        {/* Analytics */}
        <div className="mt-14">
          <h2 className="text-2xl font-bold mb-8 flex items-center gap-2 text-zinc-900 dark:text-white">
            <BarChart3 size={24} className="text-zinc-400 dark:text-zinc-500" /> Analytics
          </h2>
          <StreakCard days={stats.streakDays} />
          <WeeklyTrend data={weeklyData} />

          {/* Weekly summary */}
          <div className="p-8 rounded-[2.5rem] bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800">
            <h4 className="font-bold text-zinc-900 dark:text-white mb-4">This Week</h4>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-zinc-500 dark:text-zinc-400 text-sm">Total Spent on Unlocks</span>
                <span className="font-bold text-sm text-zinc-900 dark:text-white">${stats.totalSpentThisWeek.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500 dark:text-zinc-400 text-sm">Time Saved vs No Limits</span>
                <span className="font-bold text-sm text-green-600">{timeSavedHrs} hrs</span>
              </div>
              <div className="flex items-center justify-between pt-4 border-t border-zinc-200 dark:border-zinc-800">
                <span className="text-zinc-500 dark:text-zinc-400 text-sm font-medium">Current Streak</span>
                <span className="font-bold text-sm text-orange-500">{stats.streakDays} day{stats.streakDays !== 1 ? 's' : ''} 🔥</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ── Root render ──────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white font-sans selection:bg-zinc-900 selection:text-white dark:selection:bg-white dark:selection:text-zinc-900">
      <AnimatePresence mode="wait">
        {step === 'onboarding' && (
          <motion.div key="onboarding" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <OnboardingView />
          </motion.div>
        )}
        {step === 'setup' && (
          <motion.div key="setup" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <SetupView />
          </motion.div>
        )}
        {step === 'dashboard' && (
          <motion.div key="dashboard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <DashboardView />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top status bar accent */}
      <div className="fixed top-0 left-0 w-full h-0.5 z-[100]">
        <div className="flex-1 bg-zinc-100 dark:bg-zinc-800" />
      </div>
    </div>
  );
}

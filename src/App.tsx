import React, { useState, useEffect, useCallback } from 'react';
import { 
  Smartphone, 
  ShieldCheck, 
  Zap, 
  BarChart3, 
  Award, 
  TrendingUp, 
  Clock, 
  CheckCircle2, 
  Plus, 
  X, 
  ArrowRight, 
  Loader 
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// ── Types ─────────────────────────────────────────────────────────────────────

declare global {
  interface Window {
    Android?: {
      isPermissionsGranted: () => string;
      getMonitoredApps: () => string;
      getInstalledApps: () => string;
      getAppIcon: (pkg: string) => string;
      saveApp: (pkg: string, limit: number, name: string) => void;
      removeApp: (pkg: string) => void;
      getTodayUsage: () => string;
      getDashboardStats: () => string;
      getWeeklyStats: () => string;
      setStrictMode: (enabled: boolean) => void;
      requestUsageAccess: () => void;
      requestOverlay: () => void;
      requestAccessibilityService: () => void;
      requestBatteryOptimization: () => void;
      setOnboardingComplete: (complete: boolean) => void;
    };
  }
}

type AppState = 'loading' | 'onboarding' | 'setup' | 'dashboard';

type PermissionsState = {
  usageAccess: boolean;
  overlay: boolean;
  accessibility: boolean;
};

interface InstalledApp {
  packageName: string;
  appName: string;
  limitMinutes: number;
  isSelected: boolean;
}

interface MonitoredApp {
  packageName: string;
  appName: string;
  dailyLimitMinutes: number;
  usedMinutes: number;
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

interface WeeklyStatDay {
  focusScore: number;
  totalSpent: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_STATS: DashboardStats = {
  focusScore: 0,
  scoreDiffVsYesterday: 0,
  totalSpentToday: 0.0,
  totalSpentThisWeek: 0.0,
  timeSavedMinutes: 0,
  streakDays: 0,
  strictMode: false
};

const DEFAULT_PERMS: PermissionsState = {
  usageAccess: false,
  overlay: false,
  accessibility: false
};

const getFirstIncompleteOnboardingStep = (perms: PermissionsState) => {
  if (!perms.usageAccess) return 1;
  if (!perms.overlay) return 2;
  if (!perms.accessibility) return 3;
  return 4;
};

const DEMO_INSTALLED: InstalledApp[] = [
  { packageName: 'com.android.chrome', appName: 'Chrome', limitMinutes: 30, isSelected: false },
  { packageName: 'com.instagram.android', appName: 'Instagram', limitMinutes: 45, isSelected: false },
  { packageName: 'com.zhiliaoapp.musically', appName: 'TikTok', limitMinutes: 60, isSelected: false },
];

// ── Components ────────────────────────────────────────────────────────────────

const Button = ({ 
  children, 
  onClick, 
  disabled = false, 
  className = '', 
  ariaLabel 
}: { 
  children: React.ReactNode; 
  onClick?: () => void; 
  disabled?: boolean; 
  className?: string; 
  ariaLabel?: string;
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    aria-label={ariaLabel}
    title={ariaLabel}
    className={`px-8 py-4 rounded-full font-bold transition-all active:scale-95 disabled:opacity-30 disabled:pointer-events-none bg-white text-black hover:bg-zinc-200 ${className}`}
  >
    {children}
  </button>
);

const AppIcon = ({ packageName, appName }: { packageName: string; appName: string }) => {
  const [icon, setIcon] = useState<string | null>(null);

  useEffect(() => {
    if (window.Android) {
      setIcon(window.Android.getAppIcon(packageName));
    }
  }, [packageName]);

  return (
    <div className="w-12 h-12 rounded-2xl bg-zinc-800 flex items-center justify-center overflow-hidden shadow-lg border border-white/5">
      {icon ? (
        <img src={icon} alt={appName} className="w-full h-full object-cover" />
      ) : (
        <Smartphone className="text-zinc-600" size={24} />
      )}
    </div>
  );
};

const StreakCard = ({ days }: { days: number }) => {
  const next = days < 3 ? 3 : days < 7 ? 7 : days + 1;
  return (
    <div className="p-8 rounded-[2.5rem] bg-gradient-to-br from-zinc-900 to-black border border-white/5 shadow-2xl mb-8 relative overflow-hidden group">
      <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/10 rounded-full blur-[50px] -mr-16 -mt-16 group-hover:bg-orange-500/20 transition-all duration-700" />
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

// ── Sub-Views ───────────────────────────────────────────────────────────────

const OnboardingView = ({ 
  onboardingStep, 
  setOnboardingStep, 
  setStep, 
  perms, 
  refreshPerms 
}: { 
  onboardingStep: number, 
  setOnboardingStep: React.Dispatch<React.SetStateAction<number>>, 
  setStep: React.Dispatch<React.SetStateAction<AppState>>,
  perms: PermissionsState,
  refreshPerms: () => void
}) => {
  const steps = [
    { title: 'Extreme Focus.', description: 'Block distractions and reclaim your time. Set hard limits that give you back control over your attention.', icon: <Smartphone className="text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.8)]" size={48} /> },
    { 
      title: 'Usage Access', 
      description: 'Grant access so FocusFine can accurately track and block the apps that drain your productivity.', 
      icon: <BarChart3 className="text-emerald-400 drop-shadow-[0_0_15px_rgba(52,211,153,0.8)]" size={48} />, 
      permission: perms.usageAccess ? 'Usage Access Granted' : 'Enable Usage Access', 
      isGranted: perms.usageAccess,
      action: () => window.Android?.requestUsageAccess(),
      requiresGrant: true
    },
    { 
      title: 'Ironclad Lock', 
      description: 'Allow us to overlay the lock screen over distractive apps instantly. No way back until the timer hits zero.', 
      icon: <ShieldCheck className="text-blue-400 drop-shadow-[0_0_15px_rgba(96,165,250,0.8)]" size={48} />, 
      permission: perms.overlay ? 'Overlay Granted' : 'Enable Lock Screen', 
      isGranted: perms.overlay,
      action: () => window.Android?.requestOverlay(),
      requiresGrant: true
    },
    {
      title: 'App Switch Guard',
      description: 'Enable the Accessibility service so FocusFine can instantly intercept selected apps the moment you open them after the limit is hit.',
      icon: <ShieldCheck className="text-rose-400 drop-shadow-[0_0_15px_rgba(251,113,133,0.8)]" size={48} />,
      permission: perms.accessibility ? 'Accessibility Granted' : 'Enable App Blocking',
      isGranted: perms.accessibility,
      action: () => window.Android?.requestAccessibilityService(),
      requiresGrant: true
    },
    { title: 'Unstoppable Mode', description: 'To prevent any bypass, FocusFine runs persistently. This is your commitment to staying focused.', icon: <Zap className="text-amber-400 drop-shadow-[0_0_15px_rgba(251,191,36,0.8)]" size={48} />, permission: 'Enable Unstoppable Mode', action: () => window.Android?.requestBatteryOptimization(), requiresGrant: false },
  ];
  
  const current = steps[onboardingStep];
  const isLast = onboardingStep === steps.length - 1;
  const showRestrictedHelp = Boolean(current.requiresGrant && !current.isGranted);

  // Auto-advance if already granted
  useEffect(() => {
    if (onboardingStep > 0 && current.requiresGrant && current.isGranted) {
      setTimeout(() => setOnboardingStep(s => s + 1), 600);
    }
  }, [perms, onboardingStep, current.isGranted, current.requiresGrant, setOnboardingStep]);

  const handleNextTap = () => {
    if (onboardingStep === 0) {
      setOnboardingStep(1);
    } else if (current.requiresGrant && !current.isGranted) {
      current.action?.();
      // Start a polling check for 5 seconds to catch the permission grant
      const interval = setInterval(refreshPerms, 1000);
      setTimeout(() => clearInterval(interval), 5000);
    } else if (isLast) {
      current.action?.();
      setStep('setup');
    } else {
      setOnboardingStep(s => s + 1);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 bg-black flex flex-col p-8 md:p-16 z-[100] overflow-y-auto">
      <div className="flex-1 flex flex-col items-center justify-center space-y-10 max-w-sm mx-auto w-full">
        <motion.div 
          key={onboardingStep}
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', damping: 20 }}
          className="p-10 rounded-[3rem] bg-zinc-900/50 border border-white/5 backdrop-blur-3xl shadow-2xl relative overflow-hidden w-full"
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-3xl -mr-16 -mt-16" />
          <div className="relative z-10 flex flex-col items-center text-center">
            <div className="mb-8 p-6 rounded-3xl bg-zinc-900 border border-white/10 shadow-inner">
              {current.icon}
            </div>
            <h2 className="text-4xl font-black text-white mb-4 font-outfit uppercase tracking-tighter leading-none">{current.title}</h2>
            <p className="text-zinc-400 text-sm font-medium leading-relaxed">{current.description}</p>
          </div>
        </motion.div>

        <div className="flex flex-col gap-4 w-full">
          <button 
            onClick={handleNextTap}
            disabled={Boolean(current.requiresGrant && current.isGranted)}
            className={`w-full py-6 rounded-[2rem] font-black text-lg font-outfit uppercase tracking-widest transition-all shadow-xl hover:scale-[1.02] active:scale-[0.98] ${onboardingStep === 0 ? 'bg-white text-black' : (current.isGranted ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white text-black shadow-white/10')}`}
          >
            {onboardingStep === 0 ? 'Begin Setup' : current.permission || 'Next'}
          </button>
          
          {showRestrictedHelp && !current.isGranted && (
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }}
              className="p-5 rounded-[1.5rem] bg-zinc-900/80 border border-zinc-800/50 backdrop-blur-md"
            >
              <div className="flex items-start gap-3">
                <div className="p-1.5 rounded-full bg-blue-500/20 text-blue-400 mt-0.5">
                  <ShieldCheck size={14} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white font-outfit">Can't enable settings?</h4>
                  <p className="text-[11px] text-zinc-500 mt-1 leading-normal">
                    Android may restrict sideloaded apps. To fix it: Open <strong>App Info</strong> &gt; tap <strong>three dots</strong> (top-right) &gt; select <strong>"Allow restricted settings"</strong>.
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {isLast && (
            <button onClick={() => setStep('setup')} className="w-full py-4 text-zinc-600 text-xs font-bold uppercase tracking-widest hover:text-zinc-400">
              Skip for now
            </button>
          )}

          <div className="flex justify-center gap-2 mt-10">
            {steps.map((_, i) => (
              <div key={i} className={`h-1.5 rounded-full transition-all duration-300 ${i === onboardingStep ? 'w-8 bg-white shadow-xl' : 'w-2 bg-zinc-800'}`} />
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
};

const SetupView = ({ 
  installedApps, 
  loadingApps, 
  toggleApp, 
  updateLimit, 
  finishSetup 
}: { 
  installedApps: InstalledApp[], 
  loadingApps: boolean, 
  toggleApp: (pkg: string) => void, 
  updateLimit: (pkg: string, minutes: number) => void, 
  finishSetup: () => void 
}) => {
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
                        className="w-12 bg-transparent border-b border-zinc-600 focus:border-emerald-400 outline-none text-sm font-medium text-white p-0 text-center shadow-none" />
                      <span className="text-xs text-zinc-500 uppercase font-bold tracking-wider">min / day</span>
                    </div>
                  )}
                </div>
              </div>
              <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all ${app.isSelected ? 'bg-emerald-500 border-emerald-500 shadow-lg' : 'border-zinc-700'}`}>
                {app.isSelected && <CheckCircle2 size={16} className="text-black" />}
              </div>
            </motion.div>
          ))}
        </div>
      )}
      <div className="fixed bottom-0 left-0 w-full p-6 bg-gradient-to-t from-black via-black to-transparent z-20">
        <Button disabled={selectedCount === 0 || loadingApps} onClick={finishSetup} ariaLabel="Finish Setup" className="w-full py-5 text-lg shadow-xl">
          {selectedCount === 0 ? 'Select at least one' : `Engage Lock on ${selectedCount} App${selectedCount > 1 ? 's' : ''}`}
        </Button>
      </div>
    </div>
  );
};

const DashboardView = ({ 
  monitoredApps, 
  stats, 
  weeklyData, 
  setStep, 
  setMonitoredApps,
  toggleStrictMode
}: { 
  monitoredApps: MonitoredApp[], 
  stats: DashboardStats, 
  weeklyData: WeeklyStatDay[], 
  setStep: React.Dispatch<React.SetStateAction<AppState>>, 
  setMonitoredApps: React.Dispatch<React.SetStateAction<MonitoredApp[]>>,
  toggleStrictMode: (enabled: boolean) => void
}) => {
  const scoreSign = stats.scoreDiffVsYesterday >= 0 ? '+' : '';
  const timeSavedHrs = (stats.timeSavedMinutes / 60).toFixed(1);

  return (
    <div className="max-w-2xl mx-auto px-6 py-12 pb-32 relative">
      <div className="fixed top-[-10%] left-[-10%] w-[120%] h-[50vh] bg-top-glow pointer-events-none z-0" />
      <header className="flex items-center justify-between mb-10 relative z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg">
            <Zap size={20} className="text-black" />
          </div>
          <h1 className="text-2xl font-black text-white font-outfit uppercase tracking-tight">FocusFine</h1>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-zinc-900/80 border border-white/5 backdrop-blur-md">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Ironclad Active</span>
        </div>
      </header>

      <div className="flex justify-end mb-4 relative z-10">
        <button 
          onClick={() => toggleStrictMode(!stats.strictMode)}
          className={`px-4 py-2 rounded-full text-xs font-bold transition-all border ${stats.strictMode ? 'bg-red-500/20 border-red-500 text-red-500 shadow-glow-red' : 'bg-zinc-900 border-zinc-700 text-zinc-500'}`}
        >
          {stats.strictMode ? 'STRICT MODE ACTIVE' : 'ENABLE STRICT MODE'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8 relative z-10">
        <div className="p-8 rounded-[2.5rem] bg-white text-black shadow-[0_20px_50px_rgba(255,255,255,0.1)] relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-black/5 rounded-full blur-[40px] -mr-16 -mt-16 group-hover:bg-black/10 transition-all duration-700" />
          <h2 className="text-sm font-bold uppercase tracking-widest opacity-40 mb-1 font-outfit">Focus Score</h2>
          <div className="flex items-baseline gap-2">
            <p className="text-6xl font-black font-outfit">{stats.focusScore}%</p>
            <span className={`text-sm font-bold ${stats.scoreDiffVsYesterday >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              {scoreSign}{stats.scoreDiffVsYesterday}%
            </span>
          </div>
          <p className="text-xs font-medium opacity-50 mt-2">vs. yesterday</p>
        </div>

        <div className="p-8 rounded-[2.5rem] glass-card relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-[40px] -mr-16 -mt-16 group-hover:bg-emerald-500/20 transition-all duration-700" />
          <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-500 mb-1 font-outfit">Time Reclaimed</h2>
          <div className="flex items-baseline gap-1">
            <p className="text-6xl font-black text-white font-outfit">{timeSavedHrs}</p>
            <span className="text-2xl font-bold text-emerald-400 font-outfit">hrs</span>
          </div>
          <p className="text-xs font-medium text-zinc-500 mt-2">saved from distractions</p>
        </div>
      </div>

      <div className="relative z-10">
        <h2 className="text-xl font-bold mb-6 flex items-center gap-3 text-white font-outfit">
          <ShieldCheck size={20} className="text-zinc-500" /> Current barriers
        </h2>
        
        <div className="space-y-4 mb-10">
          <AnimatePresence initial={false}>
            {monitoredApps.map((app) => {
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
                  <div className="absolute bottom-0 left-0 w-full h-1.5 bg-zinc-800" aria-hidden="true">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.7, ease: "easeOut" }}
                      className={`h-full ${isOver ? 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)]' : 'bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.5)]'}`}
                    />
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

      <div className="mt-16 relative z-10">
        <h2 className="text-xl font-bold mb-6 flex items-center gap-3 text-white font-outfit">
          <BarChart3 size={20} className="text-zinc-500" /> Executive summary
        </h2>
        <streakCard days={stats.streakDays} />
        <weeklyTrend data={weeklyData} />
      </div>
    </div>
  );
};

// ── Main Controller ──────────────────────────────────────────────────────────

export default function App() {
  const [step, setStep] = useState<AppState>('loading');
  const [onboardingStep, setOnboardingStep] = useState(0);

  // Permissions state
  const [perms, setPerms] = useState<PermissionsState>(DEFAULT_PERMS);

  // Setup screen state
  const [installedApps, setInstalledApps] = useState<InstalledApp[]>([]);
  const [loadingApps, setLoadingApps] = useState(false);

  // Dashboard state
  const [monitoredApps, setMonitoredApps] = useState<MonitoredApp[]>([]);
  const [stats, setStats] = useState<DashboardStats>(DEFAULT_STATS);
  const [weeklyData, setWeeklyData] = useState<WeeklyStatDay[]>([]);

  const refreshPerms = useCallback(() => {
    if (window.Android) {
      try {
        const p = JSON.parse(window.Android.isPermissionsGranted());
        setPerms({
          usageAccess: Boolean(p.usageAccess),
          overlay: Boolean(p.overlay),
          accessibility: Boolean(p.accessibility),
        });
        return p;
      } catch (e) {
        return null;
      }
    }
    return null;
  }, []);

  useEffect(() => {
    const p = refreshPerms();
    if (p) {
      const latestPerms: PermissionsState = {
        usageAccess: Boolean(p.usageAccess),
        overlay: Boolean(p.overlay),
        accessibility: Boolean(p.accessibility),
      };
      const hasCorePermissions =
        latestPerms.usageAccess &&
        latestPerms.overlay &&
        latestPerms.accessibility;

      if (p.onboardingComplete && hasCorePermissions) {
        const apps = JSON.parse(window.Android!.getMonitoredApps());
        setStep(apps.length > 0 ? 'dashboard' : 'setup');
      } else {
        if (p.onboardingComplete && window.Android) {
          window.Android.setOnboardingComplete(false);
        }
        setOnboardingStep(getFirstIncompleteOnboardingStep(latestPerms));
        setStep('onboarding');
      }
    } else {
      setTimeout(() => setStep('onboarding'), 800);
    }
  }, [refreshPerms]);

  // Re-check permissions when app window gains focus
  useEffect(() => {
    const handleFocus = () => refreshPerms();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [refreshPerms]);

  const loadSetupApps = () => {
    setLoadingApps(true);
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
  };

  const loadDashboard = () => {
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
  };

  useEffect(() => { if (step === 'setup') loadSetupApps(); }, [step]);
  useEffect(() => { if (step === 'dashboard') loadDashboard(); }, [step]);

  const toggleApp = (pkg: string) =>
    setInstalledApps(prev => prev.map(a => a.packageName === pkg ? { ...a, isSelected: !a.isSelected } : a));

  const updateLimit = (pkg: string, minutes: number) =>
    setInstalledApps(prev => prev.map(a => a.packageName === pkg ? { ...a, limitMinutes: minutes } : a));

  const finishSetup = () => {
    const selected = installedApps.filter(a => a.isSelected);
    if (window.Android) {
      const latest = refreshPerms();
      if (latest) {
        const latestPerms: PermissionsState = {
          usageAccess: Boolean(latest.usageAccess),
          overlay: Boolean(latest.overlay),
          accessibility: Boolean(latest.accessibility),
        };

        if (!latestPerms.usageAccess || !latestPerms.overlay || !latestPerms.accessibility) {
          window.Android.setOnboardingComplete(false);
          setOnboardingStep(getFirstIncompleteOnboardingStep(latestPerms));
          setStep('onboarding');
          return;
        }
      }

      selected.forEach(app => window.Android!.saveApp(app.packageName, app.limitMinutes, app.appName));
      window.Android.setOnboardingComplete(true);
    }
    setStep('dashboard');
  };

  const toggleStrictMode = (enabled: boolean) => {
    if (window.Android) {
      window.Android.setStrictMode(enabled);
      setStats(prev => ({ ...prev, strictMode: enabled }));
    }
  };

  if (step === 'loading') {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
          <Loader size={32} className="text-white opacity-50" aria-label="Loading" />
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white font-sans selection:bg-emerald-500/30 selection:text-white">
      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="min-h-screen">
          {step === 'onboarding' && (
            <OnboardingView 
              onboardingStep={onboardingStep} 
              setOnboardingStep={setOnboardingStep} 
              setStep={setStep} 
              perms={perms}
              refreshPerms={refreshPerms}
            />
          )}
          {step === 'setup' && (
            <SetupView 
              installedApps={installedApps} 
              loadingApps={loadingApps} 
              toggleApp={toggleApp} 
              updateLimit={updateLimit} 
              finishSetup={finishSetup} 
            />
          )}
          {step === 'dashboard' && (
            <DashboardView 
              monitoredApps={monitoredApps} 
              stats={stats} 
              weeklyData={weeklyData} 
              setStep={setStep} 
              setMonitoredApps={setMonitoredApps} 
              toggleStrictMode={toggleStrictMode}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

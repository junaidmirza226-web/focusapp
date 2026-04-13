import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Award,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Loader,
  Lock,
  PencilLine,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  TrendingUp,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import {AnimatePresence, motion} from 'motion/react';

declare global {
  interface Window {
    Android?: {
      isPermissionsGranted: () => string;
      getActivationState?: () => string;
      ensureMonitoringService?: () => boolean;
      getMonitoredApps: () => string;
      getAppPolicies?: () => string;
      getInstalledApps: () => string;
      getAppIcon: (pkg: string) => string;
      saveApp: (pkg: string, limit: number, name: string) => void;
      saveAppPolicy?: (policyJson: string) => boolean;
      setTimeBlockRules?: (pkg: string, rulesJson: string) => boolean;
      removeApp: (pkg: string) => boolean;
      getTodayUsage: () => string;
      getDashboardStats: () => string;
      getWeeklyStats: () => string;
      getCurrentBlockState?: (pkg: string) => string;
      getSupportDiagnostics?: () => string;
      getUnlockQuote?: (pkg: string, reason: string) => string;
      getPremiumInsights?: () => string;
      getPremiumTrustState?: () => string;
      setStrictMode: (enabled: boolean) => void;
      requestUsageAccess: () => void;
      requestOverlay: () => void;
      requestAccessibilityService: () => void;
      requestBatteryOptimization: () => void;
      setOnboardingComplete: (complete: boolean) => void;
      notifyWebAppReady?: () => void;
    };
  }
}

type AppState = 'loading' | 'onboarding' | 'setup' | 'dashboard' | 'repair';
type WorkspaceMode = 'initial' | 'manage';
type PolicyMode = 'USAGE_ONLY' | 'TIME_ONLY' | 'COMBINED';
type BlockReason = 'USAGE_LIMIT' | 'TIME_BLOCK' | null;

type PermissionsState = {
  usageAccess: boolean;
  overlay: boolean;
  accessibility: boolean;
};

interface ActivationState extends PermissionsState {
  onboardingComplete: boolean;
  hasCorePermissions: boolean;
  accessibilityBound: boolean;
  accessibilityHealthy: boolean;
  monitoringServiceRunning: boolean;
  monitoringServiceHealthy: boolean;
  lastServiceCheckTime: number;
  heartbeatAgeMs: number | null;
  needsRepair: boolean;
  strictMode: boolean;
}

interface TimeRule {
  dayOfWeek: number;
  startMinuteOfDay: number;
  endMinuteOfDay: number;
  isEnabled: boolean;
}

interface BlockState {
  blocked: boolean;
  reason: BlockReason;
  blockEndsAt: number | null;
}

interface PolicyApp {
  packageName: string;
  appName: string;
  limitMinutes: number;
  isSelected: boolean;
  persisted: boolean;
  enforcementMode: PolicyMode;
  usageLimitEnabled: boolean;
  timeBlockEnabled: boolean;
  timeRules: TimeRule[];
  usedMinutes: number;
  blockState: BlockState | null;
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

interface SupportDiagnostics {
  generatedAt: number;
  generatedAtReadable: string;
  appVersion: string;
  currentProcessId?: number;
  androidSdk: number;
  deviceBrand: string;
  deviceModel: string;
  onboardingComplete: boolean;
  strictMode: boolean;
  hasCorePermissions: boolean;
  permissions: {
    usageAccess: boolean;
    overlay: boolean;
    accessibility: boolean;
  };
  service: {
    running: boolean;
    healthy: boolean;
    lastCheckTime: number;
    heartbeatAgeMs: number | null;
  };
  monitoredAppsCount: number;
  blockedNowCount: number;
  blockedNowPackages: string[];
  recentEvents?: Array<{
    atMs: number;
    atReadable: string;
    source: string;
    event: string;
    details: string | null;
  }>;
}

interface UnlockQuote {
  reason: 'USAGE_LIMIT' | 'TIME_BLOCK';
  unlockCountToday: number;
  quickAmount: number;
  extendedAmount: number;
  dailyAmount: number;
}

interface PremiumInsights {
  generatedAt: number;
  spentToday: number;
  spentWeek: number;
  usageUnlocksToday: number;
  timeUnlocksToday: number;
  unlocksTodayTotal: number;
  activeUnlocksNow: number;
  strictMode: boolean;
  recommendation: string;
}

interface PremiumTrustState {
  generatedAt: number;
  localOnlyStorage: boolean;
  cloudSyncEnabled: boolean;
  diagnosticsStoredInMemory: boolean;
  forceStopCaveat: string;
  hasCorePermissions: boolean;
  serviceHealthy: boolean;
  restartRecoveryAttempts24h: number;
  restartRecoveryFailures24h: number;
  blockedRedirects24h: number;
  overlayLaunchFailures24h: number;
  monitorSlowTicks24h: number;
  latencySamples: number;
  latencyMedianMs: number | null;
  latencyP95Ms: number | null;
  latencyMaxMs: number | null;
  reliabilityTier: 'HARDENED' | 'DEGRADED' | 'UNSTABLE' | 'REPAIR_REQUIRED' | string;
  reliabilityMessage: string;
}

type SupportCopyState = 'idle' | 'copied' | 'failed';

const DEFAULT_STATS: DashboardStats = {
  focusScore: 0,
  scoreDiffVsYesterday: 0,
  totalSpentToday: 0,
  totalSpentThisWeek: 0,
  timeSavedMinutes: 0,
  streakDays: 0,
  strictMode: false,
};

const DEFAULT_PERMS: PermissionsState = {
  usageAccess: false,
  overlay: false,
  accessibility: false,
};

const DEFAULT_ACTIVATION: ActivationState = {
  ...DEFAULT_PERMS,
  onboardingComplete: false,
  hasCorePermissions: false,
  accessibilityBound: false,
  accessibilityHealthy: false,
  monitoringServiceRunning: false,
  monitoringServiceHealthy: false,
  lastServiceCheckTime: 0,
  heartbeatAgeMs: null,
  needsRepair: false,
  strictMode: false,
};

const DEFAULT_WEEKLY_RULES: TimeRule[] = [1, 2, 3, 4, 5, 6, 7].map(day => ({
  dayOfWeek: day,
  startMinuteOfDay: 21 * 60,
  endMinuteOfDay: 9 * 60,
  isEnabled: true,
}));

const DEMO_INSTALLED: PolicyApp[] = [
  {
    packageName: 'com.android.chrome',
    appName: 'Chrome',
    limitMinutes: 30,
    isSelected: false,
    persisted: false,
    enforcementMode: 'COMBINED',
    usageLimitEnabled: true,
    timeBlockEnabled: true,
    timeRules: DEFAULT_WEEKLY_RULES,
    usedMinutes: 0,
    blockState: null,
  },
  {
    packageName: 'com.android.calculator2',
    appName: 'Calculator',
    limitMinutes: 20,
    isSelected: false,
    persisted: false,
    enforcementMode: 'USAGE_ONLY',
    usageLimitEnabled: true,
    timeBlockEnabled: false,
    timeRules: [],
    usedMinutes: 0,
    blockState: null,
  },
  {
    packageName: 'com.google.android.calendar',
    appName: 'Calendar',
    limitMinutes: 25,
    isSelected: false,
    persisted: false,
    enforcementMode: 'TIME_ONLY',
    usageLimitEnabled: false,
    timeBlockEnabled: true,
    timeRules: DEFAULT_WEEKLY_RULES,
    usedMinutes: 0,
    blockState: null,
  },
];

const getFirstIncompleteOnboardingStep = (perms: PermissionsState) => {
  if (!perms.usageAccess) return 1;
  if (!perms.overlay) return 2;
  if (!perms.accessibility) return 3;
  return 4;
};

const toTimeInput = (minutes: number) => {
  const h = Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0');
  const m = (minutes % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
};

const fromTimeInput = (value: string) => {
  const [h, m] = value.split(':').map(v => parseInt(v, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return Math.max(0, Math.min(23 * 60 + 59, h * 60 + m));
};

const formatClockTime = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  return `${hour12}:${mins.toString().padStart(2, '0')} ${suffix}`;
};

const formatScheduleSummary = (rules: TimeRule[]) => {
  const activeRule = rules.find(rule => rule.isEnabled) ?? rules[0];
  if (!activeRule) return 'No schedule';
  return `${formatClockTime(activeRule.startMinuteOfDay)} to ${formatClockTime(activeRule.endMinuteOfDay)} every day`;
};

const formatBlockState = (blockState: BlockState | null) => {
  if (!blockState?.blocked) return 'Protection ready';
  if (blockState.reason === 'TIME_BLOCK') {
    if (blockState.blockEndsAt) {
      const reopenAt = new Date(blockState.blockEndsAt).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      });
      return `Blocked by schedule until ${reopenAt}`;
    }
    return 'Blocked by schedule';
  }
  return 'Daily allowance exhausted';
};

const formatHeartbeat = (heartbeatAgeMs: number | null) => {
  if (heartbeatAgeMs == null) return 'No heartbeat yet';
  if (heartbeatAgeMs < 2_000) return 'Just now';
  if (heartbeatAgeMs < 60_000) return `${Math.round(heartbeatAgeMs / 1000)}s ago`;
  return `${Math.round(heartbeatAgeMs / 60_000)}m ago`;
};

const FALLBACK_USAGE_QUOTE: UnlockQuote = {
  reason: 'USAGE_LIMIT',
  unlockCountToday: 0,
  quickAmount: 1,
  extendedAmount: 5,
  dailyAmount: 20,
};

const FALLBACK_TIME_QUOTE: UnlockQuote = {
  reason: 'TIME_BLOCK',
  unlockCountToday: 0,
  quickAmount: 3,
  extendedAmount: 12,
  dailyAmount: 40,
};

const writeTextToClipboard = async (value: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const area = document.createElement('textarea');
  area.value = value;
  area.setAttribute('readonly', 'true');
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(area);
  if (!copied) {
    throw new Error('Clipboard copy failed');
  }
};

const scrollFieldIntoView = (target: HTMLElement) => {
  window.setTimeout(() => {
    target.scrollIntoView({behavior: 'smooth', block: 'center'});
  }, 120);
};

const useKeyboardInset = () => {
  const [keyboardInset, setKeyboardInset] = useState(0);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const handleResize = () => {
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      setKeyboardInset(inset > 120 ? inset : 0);
    };

    handleResize();
    viewport.addEventListener('resize', handleResize);
    viewport.addEventListener('scroll', handleResize);
    return () => {
      viewport.removeEventListener('resize', handleResize);
      viewport.removeEventListener('scroll', handleResize);
    };
  }, []);

  return keyboardInset;
};

const Button = ({
  children,
  onClick,
  disabled = false,
  className = '',
  ariaLabel,
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
    className={`rounded-[1.6rem] px-6 py-4 font-bold transition-all active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 ${className}`}>
    {children}
  </button>
);

const AppIcon = ({packageName, appName}: {packageName: string; appName: string}) => {
  const [icon, setIcon] = useState<string | null>(null);

  useEffect(() => {
    if (window.Android) {
      setIcon(window.Android.getAppIcon(packageName));
    }
  }, [packageName]);

  return (
    <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-[1.1rem] border border-white/8 bg-zinc-900 shadow-lg">
      {icon ? <img src={icon} alt={appName} className="h-full w-full object-cover" /> : <Smartphone size={22} className="text-zinc-500" />}
    </div>
  );
};

const StreakCard = ({days}: {days: number}) => {
  const nextMilestone = days < 3 ? 3 : days < 7 ? 7 : days + 1;

  return (
    <div className="relative mb-8 overflow-hidden rounded-[2.3rem] border border-white/6 bg-gradient-to-br from-zinc-950 via-zinc-900 to-black p-8 shadow-2xl">
      <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-amber-500/10 blur-3xl" />
      <div className="relative flex items-start justify-between gap-4">
        <div>
          <p className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.18em] text-amber-300/80">
            <Award size={16} /> Consistency streak
          </p>
          <p className="text-5xl font-black text-white">{days}</p>
          <p className="mt-2 text-sm text-zinc-400">
            {days === 0 ? 'Start today. One clean day gives you momentum.' : `Next milestone: ${nextMilestone} days.`}
          </p>
        </div>
        <div className="rounded-[1.5rem] border border-white/8 bg-white/4 px-4 py-3 text-right">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Status</p>
          <p className="mt-1 text-sm font-semibold text-white">{days >= 7 ? 'Locked in' : days >= 3 ? 'Building' : 'Starting strong'}</p>
        </div>
      </div>
    </div>
  );
};

const WeeklyTrend = ({data}: {data: WeeklyStatDay[]}) => {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const scores = data.length === 7 ? data.map(day => day.focusScore) : [72, 68, 75, 78, 80, 84, 82];
  const hasRealData = data.length === 7 && data.some(day => day.focusScore > 0);

  return (
    <div className="rounded-[2.3rem] border border-white/6 bg-zinc-950/80 p-6 shadow-2xl">
      <div className="mb-6 flex items-center gap-2 text-white">
        <TrendingUp size={18} className="text-emerald-400" />
        <h3 className="font-bold">Weekly trend</h3>
        {!hasRealData && <span className="ml-auto text-xs uppercase tracking-[0.18em] text-zinc-500">Sample</span>}
      </div>
      <div className="flex h-32 items-end justify-between gap-3">
        {days.map((day, index) => {
          const isHigh = scores[index] >= 80;
          return (
            <div key={day} className="flex flex-1 flex-col items-center">
              <motion.div
                initial={{height: 0}}
                animate={{height: `${(scores[index] / 100) * 128}px`}}
                transition={{delay: index * 0.08, type: 'spring', damping: 18}}
                className={`w-full rounded-t-xl ${scores[index] > 0 ? (isHigh ? 'bg-gradient-to-t from-emerald-500/50 to-emerald-300' : 'bg-gradient-to-t from-zinc-700 to-zinc-500') : 'bg-zinc-900'}`}
              />
              <span className="mt-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">{day}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const OnboardingView = ({
  onboardingStep,
  setOnboardingStep,
  setStep,
  perms,
  refreshActivation,
}: {
  onboardingStep: number;
  setOnboardingStep: React.Dispatch<React.SetStateAction<number>>;
  setStep: React.Dispatch<React.SetStateAction<AppState>>;
  perms: PermissionsState;
  refreshActivation: () => ActivationState | null;
}) => {
  const steps = [
    {
      title: 'Own your attention',
      description: 'Build a wall between impulse and action. FocusFine makes distraction expensive again.',
      icon: <Zap className="text-white" size={48} />,
    },
    {
      title: 'See every minute',
      description: 'Usage access lets FocusFine measure exactly when a distracting app steals your time.',
      icon: <BarChart3 className="text-emerald-400" size={48} />,
      permission: perms.usageAccess ? 'Usage access granted' : 'Enable usage access',
      isGranted: perms.usageAccess,
      action: () => window.Android?.requestUsageAccess(),
      requiresGrant: true,
    },
    {
      title: 'Place the lock',
      description: 'Overlay permission keeps the barrier visible the instant a blocked app appears.',
      icon: <Lock className="text-sky-400" size={48} />,
      permission: perms.overlay ? 'Lock screen granted' : 'Enable lock screen',
      isGranted: perms.overlay,
      action: () => window.Android?.requestOverlay(),
      requiresGrant: true,
    },
    {
      title: 'Catch every reopen',
      description: 'Accessibility lets FocusFine intercept launches, recents taps, and fast reopen attempts.',
      icon: <ShieldCheck className="text-rose-400" size={48} />,
      permission: perms.accessibility ? 'Accessibility granted' : 'Enable app blocking',
      isGranted: perms.accessibility,
      action: () => window.Android?.requestAccessibilityService(),
      requiresGrant: true,
    },
    {
      title: 'Keep protection alive',
      description: 'Battery exemption helps FocusFine stay awake in the background when you try to slip past it.',
      icon: <Wrench className="text-amber-300" size={48} />,
      permission: 'Enable resilient mode',
      isGranted: false,
      action: () => window.Android?.requestBatteryOptimization(),
      requiresGrant: false,
    },
  ];

  const current = steps[onboardingStep];
  const isLast = onboardingStep === steps.length - 1;
  const showRestrictedHelp = Boolean(current.requiresGrant && !current.isGranted);

  useEffect(() => {
    if (onboardingStep > 0 && current.requiresGrant && current.isGranted) {
      const timer = window.setTimeout(() => setOnboardingStep(step => Math.min(step + 1, steps.length - 1)), 500);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [current.isGranted, current.requiresGrant, onboardingStep, setOnboardingStep, steps.length]);

  const pollActivation = () => {
    const interval = window.setInterval(refreshActivation, 900);
    window.setTimeout(() => window.clearInterval(interval), 5_500);
  };

  const handleNext = () => {
    if (onboardingStep === 0) {
      setOnboardingStep(1);
      return;
    }

    if (current.requiresGrant && !current.isGranted) {
      current.action?.();
      pollActivation();
      return;
    }

    if (isLast) {
      current.action?.();
      setStep('setup');
      return;
    }

    setOnboardingStep(step => step + 1);
  };

  return (
    <motion.div initial={{opacity: 0}} animate={{opacity: 1}} className="fixed inset-0 z-[100] overflow-y-auto bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.18),_transparent_30%),_#020617] px-6 py-8 md:px-16 md:py-16">
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center gap-8">
        <motion.div
          key={onboardingStep}
          initial={{y: 18, opacity: 0}}
          animate={{y: 0, opacity: 1}}
          transition={{type: 'spring', damping: 20}}
          className="relative overflow-hidden rounded-[2.8rem] border border-white/8 bg-zinc-950/90 p-10 shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
          <div className="absolute -right-10 -top-10 h-36 w-36 rounded-full bg-emerald-400/8 blur-3xl" />
          <div className="relative flex flex-col items-center text-center">
            <div className="mb-8 rounded-[2rem] border border-white/8 bg-white/5 p-6">{current.icon}</div>
            <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.24em] text-emerald-300/70">Protection setup</p>
            <h2 className="text-4xl font-black tracking-tight text-white">{current.title}</h2>
            <p className="mt-4 text-sm leading-7 text-zinc-400">{current.description}</p>
          </div>
        </motion.div>

        <div className="rounded-[2rem] border border-white/8 bg-zinc-950/90 p-5 shadow-2xl">
          <Button
            onClick={handleNext}
            disabled={Boolean(current.requiresGrant && current.isGranted)}
            ariaLabel={onboardingStep === 0 ? 'Begin setup' : current.permission ?? 'Continue'}
            className={`w-full text-base font-black uppercase tracking-[0.22em] ${onboardingStep === 0 ? 'bg-white text-black' : current.isGranted ? 'border border-emerald-500/35 bg-emerald-500/15 text-emerald-300' : 'bg-white text-black'}`}>
            {onboardingStep === 0 ? 'Begin setup' : current.permission ?? 'Continue'}
          </Button>

          {showRestrictedHelp && (
            <div className="mt-4 rounded-[1.5rem] border border-zinc-800 bg-zinc-900/70 p-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-full bg-blue-500/15 p-2 text-blue-400">
                  <ShieldCheck size={14} />
                </div>
                <div>
                  <p className="text-sm font-bold text-white">If Android blocks the toggle</p>
                  <p className="mt-1 text-xs leading-6 text-zinc-500">
                    Open <strong>App info</strong>, tap the <strong>three dots</strong>, then allow <strong>restricted settings</strong>.
                  </p>
                </div>
              </div>
            </div>
          )}

          {isLast && (
            <button
              onClick={() => setStep('setup')}
              className="mt-4 w-full text-xs font-bold uppercase tracking-[0.22em] text-zinc-500 transition-colors hover:text-zinc-300">
              Continue without battery exemption
            </button>
          )}

          <div className="mt-8 flex justify-center gap-2">
            {steps.map((_, index) => (
              <div key={index} className={`h-1.5 rounded-full transition-all ${index === onboardingStep ? 'w-8 bg-white' : 'w-2 bg-zinc-800'}`} />
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
};

const RepairView = ({
  activation,
  refreshActivation,
  resumeFlow,
}: {
  activation: ActivationState;
  refreshActivation: () => ActivationState | null;
  resumeFlow: () => void;
}) => {
  const launchAndPoll = (action?: () => void) => {
    action?.();
    const interval = window.setInterval(refreshActivation, 900);
    window.setTimeout(() => {
      window.clearInterval(interval);
      const next = refreshActivation();
      if (next?.onboardingComplete && next.hasCorePermissions && !next.needsRepair) {
        resumeFlow();
      }
    }, 5_500);
  };

  const statusItems = [
    {
      key: 'usage',
      title: 'Usage access',
      description: 'Needed to track how long a protected app has been used today.',
      isHealthy: activation.usageAccess,
      action: () => launchAndPoll(() => window.Android?.requestUsageAccess()),
      buttonLabel: activation.usageAccess ? 'Granted' : 'Restore',
    },
    {
      key: 'overlay',
      title: 'Overlay lock',
      description: 'Keeps the barrier visible over a blocked app instead of leaving it usable underneath.',
      isHealthy: activation.overlay,
      action: () => launchAndPoll(() => window.Android?.requestOverlay()),
      buttonLabel: activation.overlay ? 'Granted' : 'Restore',
    },
    {
      key: 'accessibility',
      title: 'Accessibility intercept',
      description: 'Catches recents taps, app relaunches, and fast reopen attempts.',
      isHealthy: activation.accessibilityHealthy,
      action: () => launchAndPoll(() => window.Android?.requestAccessibilityService()),
      buttonLabel: activation.accessibilityHealthy ? 'Healthy' : 'Restore',
    },
    {
      key: 'service',
      title: 'Monitor heartbeat',
      description: 'Shows whether the background guard is still checking policy and usage.',
      isHealthy: activation.monitoringServiceHealthy,
      action: () => {
        window.Android?.ensureMonitoringService?.();
        const interval = window.setInterval(refreshActivation, 900);
        window.setTimeout(() => window.clearInterval(interval), 4_000);
      },
      buttonLabel: activation.monitoringServiceHealthy ? 'Healthy' : 'Restart',
    },
  ];

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6 py-12 pb-32">
      <div className="rounded-[2.6rem] border border-rose-500/20 bg-[radial-gradient(circle_at_top,_rgba(244,63,94,0.14),_transparent_38%),_rgba(9,9,11,0.95)] p-8 shadow-[0_30px_80px_rgba(0,0,0,0.55)]">
        <div className="flex items-start gap-4">
          <div className="rounded-[1.6rem] border border-rose-500/20 bg-rose-500/10 p-4 text-rose-300">
            <ShieldAlert size={28} />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-rose-300/75">Recovery center</p>
            <h1 className="mt-2 text-4xl font-black tracking-tight text-white">Protection needs repair</h1>
            <p className="mt-3 max-w-xl text-sm leading-7 text-zinc-400">
              FocusFine kept your rules, but one or more protection layers slipped. Restore them here, then jump straight back into the live barrier.
            </p>
          </div>
        </div>

        <div className="mt-8 grid gap-4">
          {statusItems.map(item => (
            <div key={item.key} className="rounded-[1.8rem] border border-white/6 bg-black/30 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-bold text-white">{item.title}</p>
                  <p className="mt-1 text-sm leading-6 text-zinc-500">{item.description}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${item.isHealthy ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>
                  {item.isHealthy ? 'Healthy' : 'Needs action'}
                </span>
              </div>
              <div className="mt-4 flex items-center justify-between gap-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-600">
                  {item.key === 'service' ? `Last heartbeat ${formatHeartbeat(activation.heartbeatAgeMs)}` : item.isHealthy ? 'Ready' : 'Open system settings'}
                </p>
                <Button
                  onClick={item.isHealthy ? undefined : item.action}
                  disabled={item.isHealthy}
                  className={`${item.isHealthy ? 'border border-emerald-500/30 bg-emerald-500/12 text-emerald-300' : 'bg-white text-black'}`}>
                  {item.buttonLabel}
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-col gap-3 rounded-[1.8rem] border border-white/6 bg-black/30 p-5 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-bold text-white">Rules are still on-device</p>
            <p className="mt-1 text-sm leading-6 text-zinc-500">You are repairing the guard, not rebuilding your whole setup.</p>
          </div>
          <Button onClick={resumeFlow} disabled={!activation.hasCorePermissions} className="bg-white text-black">
            Return to FocusFine
          </Button>
        </div>
      </div>
    </div>
  );
};

const PolicyEditorSheet = ({
  app,
  workspaceMode,
  strictMode,
  keyboardInset,
  onClose,
  onSave,
  onRemove,
}: {
  app: PolicyApp;
  workspaceMode: WorkspaceMode;
  strictMode: boolean;
  keyboardInset: number;
  onClose: () => void;
  onSave: (nextApp: PolicyApp) => void;
  onRemove: (packageName: string) => boolean;
}) => {
  const [draft, setDraft] = useState<PolicyApp>(app);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    setDraft(app);
    setConfirmRemove(false);
  }, [app]);

  const showUsageFields = draft.enforcementMode !== 'TIME_ONLY';
  const showTimeFields = draft.enforcementMode !== 'USAGE_ONLY';
  const primaryRule = draft.timeRules[0] ?? DEFAULT_WEEKLY_RULES[0];
  const removalDisabled = strictMode || Boolean(draft.blockState?.blocked);

  const updateMode = (mode: PolicyMode) => {
    setDraft(prev => ({
      ...prev,
      enforcementMode: mode,
      usageLimitEnabled: mode !== 'TIME_ONLY',
      timeBlockEnabled: mode !== 'USAGE_ONLY',
      timeRules: mode === 'USAGE_ONLY' ? [] : prev.timeRules.length ? prev.timeRules : DEFAULT_WEEKLY_RULES,
    }));
  };

  const updateTimeWindow = (startMinuteOfDay: number, endMinuteOfDay: number) => {
    setDraft(prev => ({
      ...prev,
      timeRules: DEFAULT_WEEKLY_RULES.map(rule => ({
        ...rule,
        startMinuteOfDay,
        endMinuteOfDay,
      })),
    }));
  };

  const handleSave = () => {
    onSave({
      ...draft,
      limitMinutes: Math.max(1, Math.min(720, Math.round(draft.limitMinutes || 1))),
    });
    onClose();
  };

  const handleRemove = () => {
    if (removalDisabled || !draft.persisted) return;
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    const removed = onRemove(draft.packageName);
    if (removed) {
      onClose();
    }
  };

  const focusInput = (event: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
    scrollFieldIntoView(event.currentTarget);
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-md">
      <div className="flex h-full items-end justify-center md:items-center">
        <motion.div
          initial={{y: 24, opacity: 0}}
          animate={{y: 0, opacity: 1}}
          exit={{y: 24, opacity: 0}}
          className="relative flex h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-[2.6rem] border border-white/8 bg-zinc-950 shadow-[0_30px_100px_rgba(0,0,0,0.6)] md:h-auto md:max-h-[92vh] md:rounded-[2.6rem]">
          <div className="border-b border-white/6 px-6 pb-5 pt-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-emerald-300/70">
                  {workspaceMode === 'initial' ? 'Rule designer' : 'Manage protection'}
                </p>
                <h2 className="mt-2 text-2xl font-black tracking-tight text-white">{draft.appName}</h2>
                <p className="mt-2 text-sm leading-6 text-zinc-400">
                  {draft.enforcementMode === 'COMBINED'
                    ? 'Blocked windows win first. Outside them, the daily allowance takes over.'
                    : draft.enforcementMode === 'TIME_ONLY'
                      ? 'This app stays closed during the chosen schedule, no matter how much time remains.'
                      : 'This app stays open until today’s allowance is spent.'}
                </p>
              </div>
              <button onClick={onClose} className="rounded-full border border-white/8 bg-white/5 p-3 text-zinc-400 transition-colors hover:text-white">
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="overflow-y-auto px-6 pb-40 pt-6" style={{paddingBottom: `${keyboardInset + 160}px`}}>
            <div className="grid gap-4">
              <div className="rounded-[1.8rem] border border-white/6 bg-white/4 p-5">
                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-zinc-500">Live state</p>
                <p className="mt-2 text-lg font-bold text-white">{formatBlockState(draft.blockState)}</p>
                <p className="mt-2 text-sm leading-6 text-zinc-500">
                  {draft.persisted ? 'This rule is already protecting the app.' : 'This app will become protected when you save your setup.'}
                </p>
              </div>

              <div className="rounded-[1.8rem] border border-white/6 bg-white/4 p-5">
                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-zinc-500">Mode</p>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {[
                    {key: 'USAGE_ONLY' as PolicyMode, label: 'Usage'},
                    {key: 'TIME_ONLY' as PolicyMode, label: 'Time block'},
                    {key: 'COMBINED' as PolicyMode, label: 'Combined'},
                  ].map(option => (
                    <button
                      key={option.key}
                      onClick={() => updateMode(option.key)}
                      className={`rounded-[1.3rem] border px-3 py-3 text-sm font-bold transition-all ${draft.enforcementMode === option.key ? 'border-emerald-400/50 bg-emerald-400/12 text-emerald-300' : 'border-white/8 bg-black/30 text-zinc-400 hover:text-white'}`}>
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {showUsageFields && (
                <div className="rounded-[1.8rem] border border-white/6 bg-white/4 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-zinc-500">Daily allowance</p>
                      <p className="mt-2 text-sm leading-6 text-zinc-400">Choose how many minutes this app is allowed outside blocked windows.</p>
                    </div>
                    <Clock3 size={18} className="mt-1 text-emerald-300" />
                  </div>
                  <label className="mt-5 block text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
                    Minutes per day
                    <input
                      type="number"
                      min={1}
                      max={720}
                      value={draft.limitMinutes}
                      onFocus={focusInput}
                      onChange={event => setDraft(prev => ({...prev, limitMinutes: parseInt(event.target.value, 10) || 1}))}
                      className="mt-3 w-full rounded-[1.3rem] border border-white/8 bg-black/30 px-4 py-4 text-lg font-bold text-white outline-none transition-colors focus:border-emerald-400"
                    />
                  </label>
                </div>
              )}

              {showTimeFields && (
                <div className="rounded-[1.8rem] border border-white/6 bg-white/4 p-5">
                  <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-zinc-500">Recurring block window</p>
                  <p className="mt-2 text-sm leading-6 text-zinc-400">Version one repeats the same window every day, which keeps the lock simple and reliable.</p>
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <label className="block text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
                      Block from
                      <input
                        type="time"
                        value={toTimeInput(primaryRule.startMinuteOfDay)}
                        onFocus={focusInput}
                        onChange={event => updateTimeWindow(fromTimeInput(event.target.value), primaryRule.endMinuteOfDay)}
                        className="mt-3 w-full rounded-[1.3rem] border border-white/8 bg-black/30 px-4 py-4 text-base font-bold text-white outline-none transition-colors focus:border-emerald-400"
                      />
                    </label>
                    <label className="block text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
                      Block until
                      <input
                        type="time"
                        value={toTimeInput(primaryRule.endMinuteOfDay)}
                        onFocus={focusInput}
                        onChange={event => updateTimeWindow(primaryRule.startMinuteOfDay, fromTimeInput(event.target.value))}
                        className="mt-3 w-full rounded-[1.3rem] border border-white/8 bg-black/30 px-4 py-4 text-base font-bold text-white outline-none transition-colors focus:border-emerald-400"
                      />
                    </label>
                  </div>
                  <p className="mt-4 rounded-[1.3rem] border border-amber-500/15 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-amber-100/85">
                    Active schedule: {formatScheduleSummary(draft.timeRules)}
                  </p>
                </div>
              )}

              {workspaceMode === 'manage' && draft.persisted && (
                <div className="rounded-[1.8rem] border border-rose-500/20 bg-rose-500/8 p-5">
                  <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-rose-200/80">Danger zone</p>
                  <p className="mt-2 text-sm leading-6 text-zinc-300">
                    Removing protection is deliberate. FocusFine refuses it while Strict Mode is active or while this app is currently blocked.
                  </p>
                  <p className="mt-3 text-sm font-semibold text-rose-200">
                    {strictMode
                      ? 'Strict Mode is active. Destructive changes are locked.'
                      : draft.blockState?.blocked
                        ? 'This app is blocked right now. Wait until the barrier is no longer active.'
                        : confirmRemove
                          ? 'Tap again to confirm permanent removal.'
                          : 'Protection can be removed from here only.'}
                  </p>
                  <button
                    onClick={handleRemove}
                    disabled={removalDisabled}
                    className={`mt-4 w-full rounded-[1.3rem] border px-4 py-4 text-sm font-bold uppercase tracking-[0.2em] transition-all ${removalDisabled ? 'border-white/8 bg-white/5 text-zinc-500' : confirmRemove ? 'border-rose-400/45 bg-rose-500/15 text-rose-200' : 'border-rose-500/25 bg-rose-500/10 text-rose-100 hover:bg-rose-500/15'}`}>
                    {confirmRemove ? 'Confirm remove protection' : 'Remove protection'}
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="absolute inset-x-0 bottom-0 border-t border-white/6 bg-zinc-950/95 px-6 py-5 backdrop-blur-xl" style={{bottom: keyboardInset ? `${keyboardInset}px` : undefined}}>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button onClick={onClose} className="w-full border border-white/8 bg-white/5 text-zinc-200">
                Close
              </Button>
              <Button onClick={handleSave} className="w-full bg-white text-black">
                Save rule
              </Button>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

const SetupView = ({
  workspaceMode,
  installedApps,
  loadingApps,
  strictMode,
  editorApp,
  keyboardInset,
  openEditor,
  toggleSelection,
  finishSetup,
  goBack,
  saveEditor,
  removePolicy,
}: {
  workspaceMode: WorkspaceMode;
  installedApps: PolicyApp[];
  loadingApps: boolean;
  strictMode: boolean;
  editorApp: PolicyApp | null;
  keyboardInset: number;
  openEditor: (packageName: string) => void;
  toggleSelection: (packageName: string, forceSelect?: boolean) => void;
  finishSetup: () => void;
  goBack: () => void;
  saveEditor: (nextApp: PolicyApp) => void;
  removePolicy: (packageName: string) => boolean;
}) => {
  const [query, setQuery] = useState('');
  const selectedCount = installedApps.filter(app => app.isSelected).length;

  const filteredApps = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return [...installedApps]
      .filter(app => !normalizedQuery || app.appName.toLowerCase().includes(normalizedQuery))
      .sort((left, right) => {
        const leftRank = Number(left.persisted || left.isSelected);
        const rightRank = Number(right.persisted || right.isSelected);
        if (leftRank !== rightRank) return rightRank - leftRank;
        return left.appName.localeCompare(right.appName);
      });
  }, [installedApps, query]);

  return (
    <div className="relative mx-auto flex min-h-screen w-full max-w-4xl flex-col px-6 py-10 pb-36">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.18),_transparent_55%)]" />

      <header className="relative z-10">
        <div className="flex items-center justify-between gap-4">
          {workspaceMode === 'manage' ? (
            <button
              onClick={goBack}
              className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/5 px-4 py-2 text-xs font-bold uppercase tracking-[0.2em] text-zinc-300 transition-colors hover:text-white">
              <ArrowLeft size={14} /> Dashboard
            </button>
          ) : (
            <span className="rounded-full border border-emerald-400/15 bg-emerald-400/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-300/80">
              Build your barrier
            </span>
          )}
          <span className="rounded-full border border-white/8 bg-white/5 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">
            {selectedCount} protected
          </span>
        </div>
        <h1 className="mt-6 text-4xl font-black tracking-tight text-white">
          {workspaceMode === 'manage' ? 'Protection studio' : 'Choose your target apps'}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-400">
          {workspaceMode === 'manage'
            ? 'Review live rules, tune schedules, and add new targets without weakening the barrier by accident.'
            : 'Pick the apps that leak attention, then give each one a rule that matches your real life.'}
        </p>
      </header>

      <div className="relative z-10 mt-8 rounded-[2rem] border border-white/6 bg-zinc-950/80 p-4 shadow-2xl">
        <label className="flex items-center gap-3 rounded-[1.5rem] border border-white/6 bg-black/30 px-4 py-3">
          <Search size={16} className="text-zinc-500" />
          <input
            type="text"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search apps"
            className="w-full bg-transparent text-sm text-white outline-none placeholder:text-zinc-600"
          />
        </label>
      </div>

      <div className="relative z-10 mt-6 grid gap-4">
        {loadingApps ? (
          <div className="flex items-center justify-center rounded-[2rem] border border-white/6 bg-zinc-950/80 py-24 text-zinc-500">
            <Loader size={22} className="mr-3 animate-spin" /> Loading applications...
          </div>
        ) : (
          filteredApps.map(app => {
            const summary = app.enforcementMode === 'USAGE_ONLY' ? `${app.limitMinutes} min per day` : app.enforcementMode === 'TIME_ONLY' ? formatScheduleSummary(app.timeRules) : `${app.limitMinutes} min plus ${formatScheduleSummary(app.timeRules)}`;
            const stateLabel = app.persisted ? 'Protected now' : app.isSelected ? 'Ready to save' : 'Not protected';
            return (
              <motion.div
                key={app.packageName}
                initial={{opacity: 0, y: 10}}
                animate={{opacity: 1, y: 0}}
                className={`rounded-[2rem] border p-5 transition-all ${app.persisted || app.isSelected ? 'border-emerald-400/15 bg-emerald-400/6 shadow-[0_20px_50px_rgba(0,0,0,0.25)]' : 'border-white/6 bg-zinc-950/80'}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-4">
                    <AppIcon packageName={app.packageName} appName={app.appName} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-bold text-white">{app.appName}</h3>
                        <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${app.persisted ? 'bg-emerald-500/15 text-emerald-300' : app.isSelected ? 'bg-sky-500/15 text-sky-200' : 'bg-white/5 text-zinc-500'}`}>
                          {stateLabel}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-zinc-400">{summary}</p>
                      {app.persisted && (
                        <p className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                          {formatBlockState(app.blockState)}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {!app.isSelected && !app.persisted ? (
                      <button
                        onClick={() => {
                          toggleSelection(app.packageName, true);
                          openEditor(app.packageName);
                        }}
                        className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white px-4 py-3 text-xs font-bold uppercase tracking-[0.18em] text-black transition-transform active:scale-[0.98]">
                        <Plus size={14} /> Protect
                      </button>
                    ) : (
                      <button
                        onClick={() => openEditor(app.packageName)}
                        className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/5 px-4 py-3 text-xs font-bold uppercase tracking-[0.18em] text-zinc-200 transition-colors hover:text-white">
                        <PencilLine size={14} /> Edit
                      </button>
                    )}
                    <div className={`flex h-10 w-10 items-center justify-center rounded-full border ${app.persisted || app.isSelected ? 'border-emerald-400 bg-emerald-400 text-black' : 'border-zinc-800 text-zinc-600'}`}>
                      {app.persisted || app.isSelected ? <CheckCircle2 size={16} /> : <ChevronRight size={16} />}
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })
        )}
      </div>

      <div
        className="fixed inset-x-0 bottom-0 z-30 border-t border-white/6 bg-[linear-gradient(180deg,rgba(2,6,23,0)_0%,rgba(2,6,23,0.92)_18%,rgba(2,6,23,0.98)_100%)] px-6 pb-6 pt-10 backdrop-blur-xl"
        style={{bottom: keyboardInset ? `${keyboardInset}px` : undefined}}>
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
          <div className="rounded-[1.7rem] border border-white/6 bg-zinc-950/85 px-5 py-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-zinc-500">
              {workspaceMode === 'manage' ? 'Safe management' : 'Before you continue'}
            </p>
            <p className="mt-2 text-sm leading-6 text-zinc-300">
              {workspaceMode === 'manage'
                ? 'Protection removal lives inside each app editor, requires confirmation, and stays blocked during Strict Mode or a live block.'
                : 'You can fine-tune every selected app before you finish. The lock does not go live until you save this setup.'}
            </p>
          </div>
          <Button
            disabled={selectedCount === 0 || loadingApps}
            onClick={finishSetup}
            ariaLabel={workspaceMode === 'manage' ? 'Save changes' : 'Finish setup'}
            className="w-full bg-white py-5 text-base font-black uppercase tracking-[0.22em] text-black">
            {selectedCount === 0
              ? 'Select at least one app'
              : workspaceMode === 'manage'
                ? 'Save changes'
                : `Engage protection on ${selectedCount} app${selectedCount > 1 ? 's' : ''}`}
          </Button>
        </div>
      </div>

      <AnimatePresence>
        {editorApp && (
          <PolicyEditorSheet
            app={editorApp}
            workspaceMode={workspaceMode}
            strictMode={strictMode}
            keyboardInset={keyboardInset}
            onClose={goBack}
            onSave={saveEditor}
            onRemove={removePolicy}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

const DashboardView = ({
  monitoredApps,
  stats,
  weeklyData,
  activation,
  supportDiagnostics,
  supportCopyState,
  unlockQuotes,
  premiumInsights,
  premiumTrustState,
  openManagement,
  openRepair,
  toggleStrictMode,
  refreshProtection,
  refreshDiagnostics,
  copyDiagnostics,
}: {
  monitoredApps: PolicyApp[];
  stats: DashboardStats;
  weeklyData: WeeklyStatDay[];
  activation: ActivationState;
  supportDiagnostics: SupportDiagnostics | null;
  supportCopyState: SupportCopyState;
  unlockQuotes: {
    usage: UnlockQuote | null;
    time: UnlockQuote | null;
  };
  premiumInsights: PremiumInsights | null;
  premiumTrustState: PremiumTrustState | null;
  openManagement: (packageName?: string) => void;
  openRepair: () => void;
  toggleStrictMode: (enabled: boolean) => void;
  refreshProtection: () => void;
  refreshDiagnostics: () => void;
  copyDiagnostics: () => void;
}) => {
  const scoreSign = stats.scoreDiffVsYesterday >= 0 ? '+' : '';
  const timeSavedHours = (stats.timeSavedMinutes / 60).toFixed(1);
  const healthOkay = activation.hasCorePermissions && activation.monitoringServiceHealthy;
  const usageQuote = unlockQuotes.usage ?? FALLBACK_USAGE_QUOTE;
  const timeQuote = unlockQuotes.time ?? FALLBACK_TIME_QUOTE;
  const insights = premiumInsights;
  const trust = premiumTrustState;
  const trustTier = trust?.reliabilityTier ?? 'PENDING';
  const trustTierTone =
    trustTier === 'HARDENED'
      ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200'
      : trustTier === 'DEGRADED'
        ? 'border-amber-400/35 bg-amber-500/10 text-amber-200'
        : trustTier === 'UNSTABLE' || trustTier === 'REPAIR_REQUIRED'
          ? 'border-rose-500/35 bg-rose-500/12 text-rose-200'
          : 'border-white/8 bg-white/5 text-zinc-300';

  return (
    <div className="relative mx-auto flex min-h-screen w-full max-w-4xl flex-col px-6 py-10 pb-32">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.18),_transparent_55%)]" />

      <header className="relative z-10 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/5 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-400">
            <div className={`h-2 w-2 rounded-full ${healthOkay ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
            {healthOkay ? 'Protection healthy' : 'Protection needs attention'}
          </div>
          <h1 className="mt-5 text-4xl font-black tracking-tight text-white">FocusFine control room</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-400">
            Strong rules, live health, and zero casual escape hatches. This is where you tune the barrier without weakening it.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => toggleStrictMode(!stats.strictMode)}
            className={`rounded-full border px-4 py-3 text-xs font-bold uppercase tracking-[0.18em] transition-all ${stats.strictMode ? 'border-red-500/35 bg-red-500/12 text-red-200' : 'border-white/8 bg-white/5 text-zinc-300'}`}>
            {stats.strictMode ? 'Strict Mode on' : 'Enable Strict Mode'}
          </button>
          <button
            onClick={healthOkay ? refreshProtection : openRepair}
            className="rounded-full border border-white/8 bg-white/5 px-4 py-3 text-xs font-bold uppercase tracking-[0.18em] text-zinc-300 transition-colors hover:text-white">
            {healthOkay ? 'Refresh shield' : 'Repair protection'}
          </button>
        </div>
      </header>

      <div className="relative z-10 mt-8 grid gap-4 md:grid-cols-2">
        <div className="relative overflow-hidden rounded-[2.5rem] bg-white p-8 text-black shadow-[0_20px_60px_rgba(255,255,255,0.08)]">
          <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-black/6 blur-3xl" />
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] opacity-45">Focus score</p>
          <div className="mt-3 flex items-end gap-3">
            <p className="text-6xl font-black">{stats.focusScore}%</p>
            <span className={`mb-2 text-sm font-bold ${stats.scoreDiffVsYesterday >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
              {scoreSign}
              {stats.scoreDiffVsYesterday}%
            </span>
          </div>
          <p className="mt-2 text-sm opacity-50">versus yesterday</p>
        </div>

        <div className="relative overflow-hidden rounded-[2.5rem] border border-white/6 bg-zinc-950/85 p-8 shadow-2xl">
          <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-emerald-500/10 blur-3xl" />
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-zinc-500">Time reclaimed</p>
          <div className="mt-3 flex items-end gap-2">
            <p className="text-6xl font-black text-white">{timeSavedHours}</p>
            <span className="mb-2 text-2xl font-bold text-emerald-300">hrs</span>
          </div>
          <p className="mt-2 text-sm text-zinc-500">saved from distraction loops</p>
        </div>
      </div>

      <div className="relative z-10 mt-8 rounded-[2.3rem] border border-white/6 bg-zinc-950/85 p-6 shadow-2xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-zinc-500">Protection health</p>
            <h2 className="mt-2 text-2xl font-black text-white">{healthOkay ? 'Barrier ready' : 'Repair recommended'}</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">Rules stay on-device. This panel tells you whether the guard itself is still awake and ready.</p>
          </div>
          <div className="rounded-[1.6rem] border border-white/6 bg-black/25 px-5 py-4 text-right">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Monitor heartbeat</p>
            <p className="mt-1 text-sm font-semibold text-white">{formatHeartbeat(activation.heartbeatAgeMs)}</p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-4">
          {[
            {label: 'Usage access', healthy: activation.usageAccess},
            {label: 'Overlay lock', healthy: activation.overlay},
            {label: 'Accessibility', healthy: activation.accessibility},
            {label: 'Monitor service', healthy: activation.monitoringServiceHealthy},
          ].map(item => (
            <div key={item.label} className="rounded-[1.5rem] border border-white/6 bg-black/25 px-4 py-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">{item.label}</p>
              <p className={`mt-2 text-sm font-semibold ${item.healthy ? 'text-emerald-300' : 'text-amber-200'}`}>
                {item.healthy ? 'Healthy' : 'Needs attention'}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="relative z-10 mt-8 grid gap-4 xl:grid-cols-2">
        <div className="rounded-[2.3rem] border border-white/6 bg-zinc-950/85 p-6 shadow-2xl">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-zinc-500">Trust and support</p>
          <h2 className="mt-2 text-2xl font-black text-white">Private by default</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            Rules and usage remain on this device. When support is needed, copy a compact diagnostics bundle instead of guessing.
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-[1.4rem] border border-white/6 bg-black/25 px-4 py-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Monitored apps</p>
              <p className="mt-2 text-sm font-semibold text-white">
                {supportDiagnostics?.monitoredAppsCount ?? monitoredApps.length}
              </p>
            </div>
            <div className="rounded-[1.4rem] border border-white/6 bg-black/25 px-4 py-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Blocked right now</p>
              <p className="mt-2 text-sm font-semibold text-white">{supportDiagnostics?.blockedNowCount ?? 0}</p>
            </div>
            <div className="rounded-[1.4rem] border border-white/6 bg-black/25 px-4 py-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Device</p>
              <p className="mt-2 text-sm font-semibold text-white">
                {supportDiagnostics ? `${supportDiagnostics.deviceBrand} ${supportDiagnostics.deviceModel}` : 'Live device info pending'}
              </p>
            </div>
            <div className="rounded-[1.4rem] border border-white/6 bg-black/25 px-4 py-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">App build</p>
              <p className="mt-2 text-sm font-semibold text-white">{supportDiagnostics?.appVersion ?? 'Unknown'}</p>
              {typeof supportDiagnostics?.currentProcessId === 'number' && (
                <p className="mt-1 text-xs text-zinc-500">Process #{supportDiagnostics.currentProcessId}</p>
              )}
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <button
              onClick={refreshDiagnostics}
              className="inline-flex w-full items-center justify-center gap-2 rounded-[1.2rem] border border-white/8 bg-white/5 px-4 py-3 text-xs font-bold uppercase tracking-[0.18em] text-zinc-200 transition-colors hover:text-white">
              <ShieldCheck size={14} /> Refresh diagnostics
            </button>
            <button
              onClick={copyDiagnostics}
              className={`inline-flex w-full items-center justify-center gap-2 rounded-[1.2rem] border px-4 py-3 text-xs font-bold uppercase tracking-[0.18em] transition-colors ${supportCopyState === 'copied' ? 'border-emerald-500/35 bg-emerald-500/12 text-emerald-200' : supportCopyState === 'failed' ? 'border-rose-500/30 bg-rose-500/12 text-rose-200' : 'border-white/8 bg-white text-black'}`}>
              {supportCopyState === 'copied' ? <CheckCircle2 size={14} /> : supportCopyState === 'failed' ? <AlertTriangle size={14} /> : <ArrowRight size={14} />}
              {supportCopyState === 'copied' ? 'Bundle copied' : supportCopyState === 'failed' ? 'Copy failed' : 'Copy support bundle'}
            </button>
          </div>

          <div className="mt-5 rounded-[1.4rem] border border-white/6 bg-black/25 px-4 py-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Recent runtime events</p>
            {supportDiagnostics?.recentEvents?.length ? (
              <div className="mt-3 space-y-3">
                {supportDiagnostics.recentEvents.slice(0, 6).map((event, index) => (
                  <div key={`${event.atMs}-${index}`} className="rounded-xl border border-white/6 bg-zinc-900/60 px-3 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                      {event.source} · {event.atReadable}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-zinc-100">{event.event}</p>
                    {event.details && <p className="mt-1 text-xs text-zinc-400">{event.details}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-zinc-500">No runtime events captured yet. Refresh diagnostics after normal use.</p>
            )}
          </div>
        </div>

        <div className="rounded-[2.3rem] border border-white/6 bg-zinc-950/85 p-6 shadow-2xl">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-zinc-500">Premium unlock ladder</p>
          <h2 className="mt-2 text-2xl font-black text-white">Friction with intention</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            Time-block overrides are priced higher than usage-limit overrides. Repeated unlocks in one day keep increasing to prevent routine bypass.
          </p>

          <div className="mt-5 grid gap-3">
            {[
              {label: 'Usage limit lock', quote: usageQuote},
              {label: 'Time block lock', quote: timeQuote},
            ].map(row => (
              <div key={row.label} className="rounded-[1.4rem] border border-white/6 bg-black/25 px-4 py-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">{row.label}</p>
                <p className="mt-2 text-sm font-semibold text-white">
                  15m ${row.quote.quickAmount} · 1h ${row.quote.extendedAmount} · Day ${row.quote.dailyAmount}
                </p>
                <p className="mt-1 text-xs text-zinc-500">Unlock attempts today: {row.quote.unlockCountToday}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[2.3rem] border border-white/6 bg-zinc-950/85 p-6 shadow-2xl">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-zinc-500">Premium behavior insights</p>
          <h2 className="mt-2 text-2xl font-black text-white">Cost of overrides</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            Treat unlock spend as a signal. If override pressure climbs, tighten rules before willpower gets taxed.
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-[1.4rem] border border-white/6 bg-black/25 px-4 py-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Spent today</p>
              <p className="mt-2 text-sm font-semibold text-white">${(insights?.spentToday ?? 0).toFixed(2)}</p>
            </div>
            <div className="rounded-[1.4rem] border border-white/6 bg-black/25 px-4 py-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Spent this week</p>
              <p className="mt-2 text-sm font-semibold text-white">${(insights?.spentWeek ?? 0).toFixed(2)}</p>
            </div>
            <div className="rounded-[1.4rem] border border-white/6 bg-black/25 px-4 py-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Unlocks today</p>
              <p className="mt-2 text-sm font-semibold text-white">{insights?.unlocksTodayTotal ?? 0}</p>
              <p className="mt-1 text-xs text-zinc-500">
                Usage {insights?.usageUnlocksToday ?? 0} · Time {insights?.timeUnlocksToday ?? 0}
              </p>
            </div>
            <div className="rounded-[1.4rem] border border-white/6 bg-black/25 px-4 py-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Active unlocks now</p>
              <p className="mt-2 text-sm font-semibold text-white">{insights?.activeUnlocksNow ?? 0}</p>
            </div>
          </div>

          <div className="mt-5 rounded-[1.4rem] border border-white/6 bg-black/25 px-4 py-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Recommendation</p>
            <p className="mt-2 text-sm text-zinc-100">
              {insights?.recommendation ?? 'Refresh diagnostics to load premium behavior guidance.'}
            </p>
          </div>
        </div>

        <div className="rounded-[2.3rem] border border-white/6 bg-zinc-950/85 p-6 shadow-2xl">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-zinc-500">Privacy and trust signals</p>
          <h2 className="mt-2 text-2xl font-black text-white">Evidence-backed reliability</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            This view is computed from live runtime events. It shows whether the guard is stable, recovering, or under pressure.
          </p>

          <div className={`mt-4 inline-flex rounded-full border px-4 py-2 text-[11px] font-bold uppercase tracking-[0.2em] ${trustTierTone}`}>
            Tier: {trustTier.replace('_', ' ')}
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-[1.4rem] border border-white/6 bg-black/25 px-4 py-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Storage</p>
              <p className="mt-2 text-sm font-semibold text-white">{trust?.localOnlyStorage ? 'On-device only' : 'Check policy'}</p>
              <p className="mt-1 text-xs text-zinc-500">{trust?.cloudSyncEnabled ? 'Cloud sync enabled' : 'No cloud sync enabled'}</p>
            </div>
            <div className="rounded-[1.4rem] border border-white/6 bg-black/25 px-4 py-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Recovery (24h)</p>
              <p className="mt-2 text-sm font-semibold text-white">
                Attempts {trust?.restartRecoveryAttempts24h ?? 0} | Failures {trust?.restartRecoveryFailures24h ?? 0}
              </p>
            </div>
            <div className="rounded-[1.4rem] border border-white/6 bg-black/25 px-4 py-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Intercepts (24h)</p>
              <p className="mt-2 text-sm font-semibold text-white">
                Redirects {trust?.blockedRedirects24h ?? 0} | Overlay failures {trust?.overlayLaunchFailures24h ?? 0}
              </p>
            </div>
            <div className="rounded-[1.4rem] border border-white/6 bg-black/25 px-4 py-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Latency</p>
              <p className="mt-2 text-sm font-semibold text-white">
                p95 {trust?.latencyP95Ms ?? '-'}ms | max {trust?.latencyMaxMs ?? '-'}ms
              </p>
              <p className="mt-1 text-xs text-zinc-500">samples {trust?.latencySamples ?? 0}</p>
            </div>
          </div>

          <div className="mt-5 rounded-[1.4rem] border border-white/6 bg-black/25 px-4 py-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Interpretation</p>
            <p className="mt-2 text-sm text-zinc-100">
              {trust?.reliabilityMessage ?? 'Refresh diagnostics to calculate live trust signals.'}
            </p>
            <p className="mt-2 text-xs text-zinc-500">
              {trust?.forceStopCaveat ?? 'Force-stop remains an Android OS-level kill path.'}
            </p>
          </div>
        </div>
      </div>

      <section className="relative z-10 mt-10">
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 className="flex items-center gap-3 text-xl font-bold text-white">
            <ShieldCheck size={20} className="text-emerald-300" /> Current barriers
          </h2>
          <button
            onClick={() => openManagement()}
            className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/5 px-4 py-3 text-xs font-bold uppercase tracking-[0.18em] text-zinc-300 transition-colors hover:text-white">
            <Plus size={14} /> Add target
          </button>
        </div>

        <div className="grid gap-4">
          {monitoredApps.map(app => {
            const pct = Math.min((app.usedMinutes / Math.max(app.limitMinutes, 1)) * 100, 100);
            const isOver = app.usedMinutes >= app.limitMinutes && app.enforcementMode !== 'TIME_ONLY';
            return (
              <motion.div
                key={app.packageName}
                initial={{opacity: 0, scale: 0.96}}
                animate={{opacity: 1, scale: 1}}
                className="relative overflow-hidden rounded-[2rem] border border-white/6 bg-zinc-950/85 p-6 shadow-2xl">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <AppIcon packageName={app.packageName} appName={app.appName} />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-bold text-white">{app.appName}</h3>
                        <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${app.blockState?.blocked ? 'bg-rose-500/15 text-rose-200' : 'bg-emerald-500/15 text-emerald-300'}`}>
                          {app.blockState?.blocked ? 'Blocked now' : 'Ready'}
                        </span>
                      </div>
                      <p className={`mt-2 text-sm font-semibold ${isOver ? 'text-rose-200' : 'text-zinc-400'}`}>
                        {app.enforcementMode === 'TIME_ONLY' ? 'Time window rule' : `${app.usedMinutes} / ${app.limitMinutes} min today`}
                      </p>
                      <p className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                        {app.enforcementMode === 'COMBINED' ? 'Combined mode' : app.enforcementMode === 'TIME_ONLY' ? 'Time block only' : 'Usage limit only'}
                        {app.timeBlockEnabled ? ` · ${formatScheduleSummary(app.timeRules)}` : ''}
                      </p>
                      <p className="mt-2 text-sm text-zinc-400">{formatBlockState(app.blockState)}</p>
                    </div>
                  </div>

                  <button
                    onClick={() => openManagement(app.packageName)}
                    className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/5 px-4 py-3 text-xs font-bold uppercase tracking-[0.18em] text-zinc-300 transition-colors hover:text-white">
                    <PencilLine size={14} /> Manage
                  </button>
                </div>

                {app.enforcementMode !== 'TIME_ONLY' && (
                  <div className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-900">
                    <motion.div
                      initial={{width: 0}}
                      animate={{width: `${pct}%`}}
                      transition={{duration: 0.7, ease: 'easeOut'}}
                      className={`h-full ${isOver ? 'bg-rose-400' : 'bg-emerald-400'}`}
                    />
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      </section>

      <section className="relative z-10 mt-12">
        <h2 className="mb-6 flex items-center gap-3 text-xl font-bold text-white">
          <BarChart3 size={20} className="text-zinc-500" /> Executive summary
        </h2>
        <StreakCard days={stats.streakDays} />
        <WeeklyTrend data={weeklyData} />
      </section>
    </div>
  );
};

export default function App() {
  const [step, setStep] = useState<AppState>('loading');
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('initial');
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [perms, setPerms] = useState<PermissionsState>(DEFAULT_PERMS);
  const [activation, setActivation] = useState<ActivationState>(DEFAULT_ACTIVATION);
  const [installedApps, setInstalledApps] = useState<PolicyApp[]>([]);
  const [loadingApps, setLoadingApps] = useState(false);
  const [editorPackage, setEditorPackage] = useState<string | null>(null);
  const [monitoredApps, setMonitoredApps] = useState<PolicyApp[]>([]);
  const [stats, setStats] = useState<DashboardStats>(DEFAULT_STATS);
  const [weeklyData, setWeeklyData] = useState<WeeklyStatDay[]>([]);
  const [supportDiagnostics, setSupportDiagnostics] = useState<SupportDiagnostics | null>(null);
  const [supportCopyState, setSupportCopyState] = useState<SupportCopyState>('idle');
  const [premiumInsights, setPremiumInsights] = useState<PremiumInsights | null>(null);
  const [premiumTrustState, setPremiumTrustState] = useState<PremiumTrustState | null>(null);
  const [unlockQuotes, setUnlockQuotes] = useState<{
    usage: UnlockQuote | null;
    time: UnlockQuote | null;
  }>({
    usage: null,
    time: null,
  });
  const keyboardInset = useKeyboardInset();

  const readActivationState = useCallback((): ActivationState | null => {
    if (!window.Android) return null;

    try {
      const raw = window.Android.getActivationState ? window.Android.getActivationState() : window.Android.isPermissionsGranted();
      const parsed = JSON.parse(raw);
      return {
        usageAccess: Boolean(parsed.usageAccess),
        overlay: Boolean(parsed.overlay),
        accessibility: Boolean(parsed.accessibility),
        onboardingComplete: Boolean(parsed.onboardingComplete),
        hasCorePermissions: Boolean(parsed.hasCorePermissions ?? (parsed.usageAccess && parsed.overlay && parsed.accessibility)),
        accessibilityBound: Boolean(parsed.accessibilityBound),
        accessibilityHealthy: Boolean(parsed.accessibilityHealthy ?? (parsed.accessibility && parsed.accessibilityBound)),
        monitoringServiceRunning: Boolean(parsed.monitoringServiceRunning),
        monitoringServiceHealthy: Boolean(parsed.monitoringServiceHealthy),
        lastServiceCheckTime: Number(parsed.lastServiceCheckTime ?? 0),
        heartbeatAgeMs: typeof parsed.heartbeatAgeMs === 'number' ? parsed.heartbeatAgeMs : null,
        needsRepair: Boolean(parsed.needsRepair),
        strictMode: Boolean(parsed.strictMode),
      };
    } catch {
      return null;
    }
  }, []);

  const refreshActivation = useCallback(() => {
    const next = readActivationState();
    if (next) {
      setPerms({
        usageAccess: next.usageAccess,
        overlay: next.overlay,
        accessibility: next.accessibility,
      });
      setActivation(next);
    }
    return next;
  }, [readActivationState]);

  const loadSupportDiagnostics = useCallback(() => {
    if (!window.Android?.getSupportDiagnostics) return null;
    try {
      const parsed = JSON.parse(window.Android.getSupportDiagnostics()) as SupportDiagnostics;
      setSupportDiagnostics(parsed);
      return parsed;
    } catch {
      return null;
    }
  }, []);

  const loadPremiumInsights = useCallback(() => {
    if (!window.Android?.getPremiumInsights) return null;
    try {
      const parsed = JSON.parse(window.Android.getPremiumInsights()) as PremiumInsights;
      setPremiumInsights(parsed);
      return parsed;
    } catch {
      return null;
    }
  }, []);

  const loadPremiumTrustState = useCallback(() => {
    if (!window.Android?.getPremiumTrustState) return null;
    try {
      const parsed = JSON.parse(window.Android.getPremiumTrustState()) as PremiumTrustState;
      setPremiumTrustState(parsed);
      return parsed;
    } catch {
      return null;
    }
  }, []);

  const loadUnlockQuotes = useCallback((packageName: string | null) => {
    if (!packageName || !window.Android?.getUnlockQuote) {
      setUnlockQuotes({usage: null, time: null});
      return;
    }

    try {
      const usage = JSON.parse(window.Android.getUnlockQuote(packageName, 'USAGE_LIMIT')) as UnlockQuote;
      const time = JSON.parse(window.Android.getUnlockQuote(packageName, 'TIME_BLOCK')) as UnlockQuote;
      setUnlockQuotes({usage, time});
    } catch {
      setUnlockQuotes({usage: null, time: null});
    }
  }, []);

  const readPolicies = useCallback(() => {
    if (!window.Android) return [];
    try {
      return window.Android.getAppPolicies ? JSON.parse(window.Android.getAppPolicies()) : JSON.parse(window.Android.getMonitoredApps());
    } catch {
      return [];
    }
  }, []);

  const routeFromActivation = useCallback(
    (next: ActivationState) => {
      if (next.onboardingComplete) {
        if (next.hasCorePermissions && !next.needsRepair) {
          window.Android?.ensureMonitoringService?.();
          const apps = readPolicies();
          setStep(apps.length > 0 ? 'dashboard' : 'setup');
          setWorkspaceMode(apps.length > 0 ? 'manage' : 'initial');
          return;
        }
        setStep('repair');
        return;
      }

      if (next.hasCorePermissions) {
        setWorkspaceMode('initial');
        setStep('setup');
        return;
      }

      setOnboardingStep(getFirstIncompleteOnboardingStep(next));
      setStep('onboarding');
    },
    [readPolicies],
  );

  const loadSetupApps = useCallback(() => {
    setLoadingApps(true);

    try {
      if (!window.Android) {
        setInstalledApps(DEMO_INSTALLED);
        setLoadingApps(false);
        return;
      }

      const installed: {packageName: string; appName: string}[] = JSON.parse(window.Android.getInstalledApps());
      const policies: Array<{
        packageName: string;
        appName: string;
        dailyLimitMinutes: number;
        enforcementMode?: PolicyMode;
        usageLimitEnabled?: boolean;
        timeBlockEnabled?: boolean;
        timeRules?: TimeRule[];
      }> = readPolicies();

      const usageArr: {packageName: string; usedMinutes: number}[] = JSON.parse(window.Android.getTodayUsage());
      const usageMap = new Map(usageArr.map(item => [item.packageName, item.usedMinutes]));
      const policyMap = new Map(policies.map(policy => [policy.packageName, policy]));

      const nextApps: PolicyApp[] = installed.map(app => {
        let blockState: BlockState | null = null;
        if (policyMap.has(app.packageName) && window.Android?.getCurrentBlockState) {
          try {
            const rawBlockState = JSON.parse(window.Android.getCurrentBlockState(app.packageName));
            blockState = {
              blocked: Boolean(rawBlockState.blocked),
              reason: rawBlockState.reason ?? null,
              blockEndsAt: typeof rawBlockState.blockEndsAt === 'number' ? rawBlockState.blockEndsAt : null,
            };
          } catch {
            blockState = null;
          }
        }

        return {
          packageName: app.packageName,
          appName: app.appName,
          limitMinutes: policyMap.get(app.packageName)?.dailyLimitMinutes ?? 30,
          isSelected: policyMap.has(app.packageName),
          persisted: policyMap.has(app.packageName),
          enforcementMode: policyMap.get(app.packageName)?.enforcementMode ?? 'COMBINED',
          usageLimitEnabled: policyMap.get(app.packageName)?.usageLimitEnabled ?? true,
          timeBlockEnabled: policyMap.get(app.packageName)?.timeBlockEnabled ?? true,
          timeRules: policyMap.get(app.packageName)?.timeRules?.length ? policyMap.get(app.packageName)!.timeRules! : DEFAULT_WEEKLY_RULES,
          usedMinutes: usageMap.get(app.packageName) ?? 0,
          blockState,
        };
      });

      setInstalledApps(nextApps);
      setEditorPackage(currentEditorPackage => {
        if (!currentEditorPackage) return currentEditorPackage;
        return nextApps.some(app => app.packageName === currentEditorPackage) ? currentEditorPackage : null;
      });
    } catch {
      setInstalledApps(DEMO_INSTALLED);
    } finally {
      setLoadingApps(false);
    }
  }, [readPolicies]);

  const loadDashboard = useCallback(() => {
    if (!window.Android) return;

    try {
      const usageArr: {packageName: string; usedMinutes: number}[] = JSON.parse(window.Android.getTodayUsage());
      const usageMap = new Map(usageArr.map(item => [item.packageName, item.usedMinutes]));
      const policies: Array<{
        packageName: string;
        appName: string;
        dailyLimitMinutes: number;
        enforcementMode?: PolicyMode;
        usageLimitEnabled?: boolean;
        timeBlockEnabled?: boolean;
        timeRules?: TimeRule[];
      }> = readPolicies();

      const nextApps: PolicyApp[] = policies.map(policy => {
        let blockState: BlockState | null = null;
        if (window.Android?.getCurrentBlockState) {
          try {
            const rawBlockState = JSON.parse(window.Android.getCurrentBlockState(policy.packageName));
            blockState = {
              blocked: Boolean(rawBlockState.blocked),
              reason: rawBlockState.reason ?? null,
              blockEndsAt: typeof rawBlockState.blockEndsAt === 'number' ? rawBlockState.blockEndsAt : null,
            };
          } catch {
            blockState = null;
          }
        }

        return {
          packageName: policy.packageName,
          appName: policy.appName,
          limitMinutes: policy.dailyLimitMinutes,
          isSelected: true,
          persisted: true,
          enforcementMode: policy.enforcementMode ?? 'USAGE_ONLY',
          usageLimitEnabled: policy.usageLimitEnabled ?? true,
          timeBlockEnabled: policy.timeBlockEnabled ?? false,
          timeRules: policy.timeRules ?? [],
          usedMinutes: usageMap.get(policy.packageName) ?? 0,
          blockState,
        };
      });

      setMonitoredApps(nextApps);
      setStats(JSON.parse(window.Android.getDashboardStats()));
      setWeeklyData(JSON.parse(window.Android.getWeeklyStats()));
      loadSupportDiagnostics();
      loadPremiumInsights();
      loadPremiumTrustState();
      loadUnlockQuotes(nextApps[0]?.packageName ?? null);
    } catch {
      // Keep previous dashboard state if parsing fails.
    }
  }, [loadPremiumInsights, loadPremiumTrustState, loadSupportDiagnostics, loadUnlockQuotes, readPolicies]);

  const persistPolicies = useCallback((appsToPersist: PolicyApp[]) => {
    if (!window.Android) return;

    appsToPersist.forEach(app => {
      if (window.Android?.saveAppPolicy) {
        const policy = {
          packageName: app.packageName,
          appName: app.appName,
          dailyLimitMinutes: app.limitMinutes,
          isEnabled: true,
          enforcementMode: app.enforcementMode,
          usageLimitEnabled: app.enforcementMode !== 'TIME_ONLY',
          timeBlockEnabled: app.enforcementMode !== 'USAGE_ONLY',
          timeRules: app.enforcementMode === 'USAGE_ONLY' ? [] : app.timeRules.length ? app.timeRules : DEFAULT_WEEKLY_RULES,
        };
        window.Android.saveAppPolicy(JSON.stringify(policy));
      } else {
        window.Android.saveApp(app.packageName, app.limitMinutes, app.appName);
        if (window.Android?.setTimeBlockRules && app.enforcementMode !== 'USAGE_ONLY') {
          window.Android.setTimeBlockRules(app.packageName, JSON.stringify(app.timeRules));
        }
      }
    });
  }, []);

  useEffect(() => {
    const next = refreshActivation();
    if (next) {
      routeFromActivation(next);
    } else {
      const timer = window.setTimeout(() => setStep('onboarding'), 800);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [refreshActivation, routeFromActivation]);

  useEffect(() => {
    const syncActivation = () => {
      const next = refreshActivation();
      if (next) {
        if (step === 'repair' && next.onboardingComplete && next.hasCorePermissions) {
          routeFromActivation(next);
          return;
        }

        if (step === 'dashboard' && next.needsRepair) {
          setStep('repair');
          return;
        }

        if (step === 'onboarding' && next.hasCorePermissions) {
          routeFromActivation(next);
          return;
        }

        if (step === 'dashboard') {
          loadDashboard();
        }
      }
    };

    window.addEventListener('focus', syncActivation);
    window.addEventListener('focusfine:activation', syncActivation as EventListener);
    return () => {
      window.removeEventListener('focus', syncActivation);
      window.removeEventListener('focusfine:activation', syncActivation as EventListener);
    };
  }, [loadDashboard, refreshActivation, routeFromActivation, step]);

  useEffect(() => {
    if (step === 'setup') {
      loadSetupApps();
    }
  }, [loadSetupApps, step]);

  useEffect(() => {
    if (step === 'dashboard') {
      window.Android?.ensureMonitoringService?.();
      loadDashboard();
    }
  }, [loadDashboard, step]);

  useEffect(() => {
    if (step !== 'loading') {
      const timer = window.setTimeout(() => {
        window.Android?.notifyWebAppReady?.();
      }, 2500);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [step]);

  const openManagement = (packageName?: string) => {
    setWorkspaceMode('manage');
    setEditorPackage(packageName ?? null);
    setStep('setup');
  };

  const toggleSelection = (packageName: string, forceSelect?: boolean) => {
    setInstalledApps(prev =>
      prev.map(app => {
        if (app.packageName !== packageName) return app;
        if (app.persisted) {
          return {...app, isSelected: true};
        }
        const nextSelected = typeof forceSelect === 'boolean' ? forceSelect : !app.isSelected;
        return {...app, isSelected: nextSelected};
      }),
    );
  };

  const saveEditor = (nextApp: PolicyApp) => {
    setInstalledApps(prev =>
      prev.map(app =>
        app.packageName === nextApp.packageName
          ? {
              ...nextApp,
              isSelected: true,
              persisted: app.persisted || nextApp.persisted,
              blockState: app.blockState,
              usedMinutes: app.usedMinutes,
            }
          : app,
      ),
    );
  };

  const removePolicy = (packageName: string) => {
    if (!window.Android) return false;
    const removed = window.Android.removeApp(packageName);
    if (!removed) return false;

    setInstalledApps(prev =>
      prev.map(app =>
        app.packageName === packageName
          ? {
              ...app,
              isSelected: false,
              persisted: false,
              blockState: null,
              usedMinutes: 0,
            }
          : app,
      ),
    );
    setMonitoredApps(prev => prev.filter(app => app.packageName !== packageName));
    return true;
  };

  const finishSetup = () => {
    const latest = refreshActivation();
    if (latest && !latest.hasCorePermissions) {
      setStep(latest.onboardingComplete ? 'repair' : 'onboarding');
      setOnboardingStep(getFirstIncompleteOnboardingStep(latest));
      return;
    }

    const selectedApps = installedApps.filter(app => app.isSelected);
    persistPolicies(selectedApps);
    window.Android?.setOnboardingComplete(true);
    window.Android?.ensureMonitoringService?.();
    setWorkspaceMode('manage');
    setEditorPackage(null);
    setStep('dashboard');
  };

  const toggleStrictMode = (enabled: boolean) => {
    window.Android?.setStrictMode(enabled);
    setStats(prev => ({...prev, strictMode: enabled}));
    setActivation(prev => ({...prev, strictMode: enabled}));
  };

  const refreshProtection = () => {
    window.Android?.ensureMonitoringService?.();
    const interval = window.setInterval(() => {
      const next = refreshActivation();
      if (next?.monitoringServiceHealthy) {
        window.clearInterval(interval);
      }
    }, 900);
    window.setTimeout(() => window.clearInterval(interval), 4_500);
  };

  const refreshDiagnostics = () => {
    loadSupportDiagnostics();
    loadPremiumInsights();
    loadPremiumTrustState();
    if (!unlockQuotes.usage && monitoredApps.length > 0) {
      loadUnlockQuotes(monitoredApps[0].packageName);
    }
  };

  const copyDiagnostics = () => {
    const payload =
      window.Android?.getSupportDiagnostics?.() ??
      JSON.stringify(
        {
          generatedAt: Date.now(),
          source: 'web-fallback',
          activation,
          stats,
          monitoredApps: monitoredApps.map(app => app.packageName),
        },
        null,
        2,
      );

    writeTextToClipboard(payload)
      .then(() => {
        setSupportCopyState('copied');
        loadSupportDiagnostics();
      })
      .catch(() => {
        setSupportCopyState('failed');
      })
      .finally(() => {
        window.setTimeout(() => setSupportCopyState('idle'), 2200);
      });
  };

  const resumeFlow = () => {
    const next = refreshActivation();
    if (next) {
      routeFromActivation(next);
    }
  };

  const editorApp = editorPackage ? installedApps.find(app => app.packageName === editorPackage) ?? null : null;

  if (step === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.18),_transparent_36%),_#020617] px-6">
        <div className="rounded-[2.2rem] border border-white/8 bg-zinc-950/85 p-8 text-center shadow-2xl">
          <motion.div animate={{rotate: 360}} transition={{duration: 1, repeat: Infinity, ease: 'linear'}} className="mx-auto mb-4 w-fit text-white/70">
            <Loader size={32} />
          </motion.div>
          <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-zinc-500">Checking protection state</p>
          <p className="mt-2 text-sm leading-6 text-zinc-400">FocusFine is rebuilding the barrier and reading your latest permissions.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#020617] text-white selection:bg-emerald-500/30 selection:text-white">
      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} className="min-h-screen">
          {step === 'onboarding' && (
            <OnboardingView
              onboardingStep={onboardingStep}
              setOnboardingStep={setOnboardingStep}
              setStep={setStep}
              perms={perms}
              refreshActivation={refreshActivation}
            />
          )}

          {step === 'repair' && (
            <RepairView activation={activation} refreshActivation={refreshActivation} resumeFlow={resumeFlow} />
          )}

          {step === 'setup' && (
            <SetupView
              workspaceMode={workspaceMode}
              installedApps={installedApps}
              loadingApps={loadingApps}
              strictMode={stats.strictMode || activation.strictMode}
              editorApp={editorApp}
              keyboardInset={keyboardInset}
              openEditor={setEditorPackage}
              toggleSelection={toggleSelection}
              finishSetup={finishSetup}
              goBack={() => {
                if (editorPackage) {
                  setEditorPackage(null);
                } else if (workspaceMode === 'manage') {
                  setStep('dashboard');
                }
              }}
              saveEditor={saveEditor}
              removePolicy={removePolicy}
            />
          )}

          {step === 'dashboard' && (
            <DashboardView
              monitoredApps={monitoredApps}
              stats={stats}
              weeklyData={weeklyData}
              activation={activation}
              supportDiagnostics={supportDiagnostics}
              supportCopyState={supportCopyState}
              unlockQuotes={unlockQuotes}
              premiumInsights={premiumInsights}
              premiumTrustState={premiumTrustState}
              openManagement={openManagement}
              openRepair={() => setStep('repair')}
              toggleStrictMode={toggleStrictMode}
              refreshProtection={refreshProtection}
              refreshDiagnostics={refreshDiagnostics}
              copyDiagnostics={copyDiagnostics}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

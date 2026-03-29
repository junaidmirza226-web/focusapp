/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Smartphone,
  Clock,
  ShieldCheck,
  Zap,
  CheckCircle2,
  ArrowRight,
  Instagram,
  Twitter,
  Youtube,
  MessageCircle,
  Lock,
  DollarSign,
  X,
  Settings,
  BarChart3,
  Plus,
  ChevronRight,
  AlertCircle,
  TrendingUp,
  Flame,
  Award,
  Loader
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---

type AppState = 'onboarding' | 'setup' | 'dashboard' | 'limit-hit';

interface SocialApp {
  id: string;
  name: string;
  icon: React.ReactNode;
  color: string;
  limitMinutes: number;
  usedMinutes: number;
  isSelected: boolean;
}

// --- Constants ---

const INITIAL_APPS: SocialApp[] = [
  { id: 'instagram', name: 'Instagram', icon: <Instagram size={20} />, color: 'bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-600', limitMinutes: 30, usedMinutes: 0, isSelected: false },
  { id: 'tiktok', name: 'TikTok', icon: <Zap size={20} />, color: 'bg-black', limitMinutes: 30, usedMinutes: 0, isSelected: false },
  { id: 'youtube', name: 'YouTube', icon: <Youtube size={20} />, color: 'bg-red-600', limitMinutes: 60, usedMinutes: 0, isSelected: false },
  { id: 'twitter', name: 'Twitter', icon: <Twitter size={20} />, color: 'bg-sky-500', limitMinutes: 20, usedMinutes: 0, isSelected: false },
  { id: 'whatsapp', name: 'WhatsApp', icon: <MessageCircle size={20} />, color: 'bg-green-500', limitMinutes: 45, usedMinutes: 0, isSelected: false },
];

// --- Components ---

const Button = ({ children, onClick, variant = 'primary', className = '', disabled = false }: { 
  children: React.ReactNode, 
  onClick?: () => void, 
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger',
  className?: string,
  disabled?: boolean
}) => {
  const variants = {
    primary: 'bg-black text-white hover:bg-zinc-800',
    secondary: 'bg-zinc-100 text-black hover:bg-zinc-200',
    outline: 'border border-zinc-200 text-black hover:bg-zinc-50',
    ghost: 'text-zinc-500 hover:text-black hover:bg-zinc-100',
    danger: 'bg-red-500 text-white hover:bg-red-600',
  };

  return (
    <button 
      onClick={onClick}
      disabled={disabled}
      className={`px-6 py-3 rounded-2xl font-medium transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2 ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
};

const Card = ({ children, className = "" }: { children: React.ReactNode, className?: string }) => (
  <div className={`bg-white rounded-3xl border border-zinc-100 shadow-sm p-6 ${className}`}>
    {children}
  </div>
);

const HourlyHeatmap = () => {
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const getIntensity = (hour: number) => {
    // Simulated usage data - peaks at 11 PM, 8 PM
    if (hour === 23 || hour === 20) return 'bg-red-500';
    if (hour >= 18 && hour <= 22) return 'bg-orange-400';
    if (hour >= 9 && hour <= 17) return 'bg-yellow-200';
    return 'bg-zinc-100';
  };

  return (
    <div className="mb-12 p-6 rounded-3xl bg-white border border-zinc-100">
      <h3 className="font-bold mb-4 flex items-center gap-2">
        <Flame size={18} className="text-orange-500" /> Peak Usage Times
      </h3>
      <div className="grid grid-cols-12 gap-1">
        {hours.map(hour => (
          <div
            key={hour}
            className={`h-8 rounded-md ${getIntensity(hour)} transition-all hover:scale-110 cursor-pointer`}
            title={`${hour}:00`}
          />
        ))}
      </div>
      <p className="text-xs text-zinc-400 mt-4">Darkest = highest usage. Most used: 11 PM</p>
    </div>
  );
};

const WeeklyTrend = () => {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const scores = [72, 68, 75, 74, 79, 82, 84]; // Simulated focus scores

  return (
    <div className="mb-12 p-6 rounded-3xl bg-white border border-zinc-100">
      <h3 className="font-bold mb-4 flex items-center gap-2">
        <TrendingUp size={18} className="text-green-500" /> Weekly Improvement
      </h3>
      <div className="flex items-end justify-between h-32 gap-2">
        {days.map((day, i) => (
          <div key={day} className="flex flex-col items-center flex-1">
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: `${(scores[i] / 100) * 128}px` }}
              className="w-full bg-gradient-to-t from-green-400 to-green-200 rounded-t-lg transition-all"
              title={`${scores[i]}/100`}
            />
            <span className="text-xs text-zinc-400 mt-2">{day}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const StreakCard = () => {
  return (
    <div className="mb-12 p-6 rounded-3xl bg-gradient-to-br from-amber-50 to-orange-50 border border-orange-200">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold flex items-center gap-2 mb-2">
            <Award size={18} className="text-orange-500" /> Perfect Days Streak
          </h3>
          <p className="text-3xl font-black text-orange-600">3 days</p>
          <p className="text-sm text-orange-700 mt-1">Keep it up! Next milestone: 7 days 🎯</p>
        </div>
        <div className="text-5xl">🔥</div>
      </div>
    </div>
  );
};

export default function App() {
  const [step, setStep] = useState<AppState>('onboarding');
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [apps, setApps] = useState<SocialApp[]>(INITIAL_APPS);
  const [activeApp, setActiveApp] = useState<SocialApp | null>(null);
  const [totalSpent, setTotalSpent] = useState(0);

  // --- Handlers ---

  const toggleAppSelection = (id: string) => {
    setApps(prev => prev.map(app => 
      app.id === id ? { ...app, isSelected: !app.isSelected } : app
    ));
  };

  const updateLimit = (id: string, minutes: number) => {
    setApps(prev => prev.map(app => 
      app.id === id ? { ...app, limitMinutes: minutes } : app
    ));
  };

  const simulateLimitHit = (app: SocialApp) => {
    setActiveApp(app);
    setStep('limit-hit');
  };

  const handlePay = () => {
    setTotalSpent(prev => prev + 1);
    // Add 15 minutes to the limit
    if (activeApp) {
      setApps(prev => prev.map(a => 
        a.id === activeApp.id ? { ...a, limitMinutes: a.limitMinutes + 15 } : a
      ));
    }
    setStep('dashboard');
  };

  const handleClose = () => {
    setStep('dashboard');
  };

  // --- Views ---

  const OnboardingView = () => {
    const steps = [
      {
        title: "Welcome to FocusFine",
        description: "The dead-simple way to reclaim your time. Set limits, and if you break them, it'll cost you.",
        icon: <Smartphone className="text-black" size={48} />,
      },
      {
        title: "Usage Access",
        description: "We need to know how long you spend on each app to help you stay focused.",
        icon: <BarChart3 className="text-sky-500" size={48} />,
        permission: "Grant Usage Access"
      },
      {
        title: "Overlay Permission",
        description: "This allows us to show the lock screen when you hit your limit.",
        icon: <ShieldCheck className="text-green-500" size={48} />,
        permission: "Allow Drawing Over Apps"
      },
      {
        title: "Battery Optimization",
        description: "We need to run in the background to monitor your usage reliably.",
        icon: <Zap className="text-yellow-500" size={48} />,
        permission: "Ignore Battery Optimization"
      }
    ];

    const current = steps[onboardingStep];

    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] text-center px-6">
        <motion.div 
          key={onboardingStep}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="max-w-md w-full"
        >
          <div className="mb-8 flex justify-center">
            <div className="w-24 h-24 bg-zinc-50 rounded-[2rem] flex items-center justify-center shadow-inner">
              {current.icon}
            </div>
          </div>
          <h1 className="text-3xl font-bold tracking-tight mb-4">{current.title}</h1>
          <p className="text-zinc-500 text-lg mb-12 leading-relaxed">
            {current.description}
          </p>

          <div className="space-y-4">
            {current.permission ? (
              <Button 
                onClick={() => onboardingStep < steps.length - 1 ? setOnboardingStep(onboardingStep + 1) : setStep('setup')}
                className="w-full py-4 text-lg"
              >
                {current.permission}
              </Button>
            ) : (
              <Button 
                onClick={() => setOnboardingStep(1)}
                className="w-full py-4 text-lg"
              >
                Get Started <ArrowRight size={20} />
              </Button>
            )}
            
            <div className="flex justify-center gap-2 mt-8">
              {steps.map((_, i) => (
                <div 
                  key={i} 
                  className={`h-1.5 rounded-full transition-all duration-300 ${i === onboardingStep ? 'w-8 bg-black' : 'w-2 bg-zinc-200'}`} 
                />
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    );
  };

  const SetupView = () => {
    const selectedCount = apps.filter(a => a.isSelected).length;

    return (
      <div className="max-w-2xl mx-auto px-6 py-12">
        <header className="mb-12">
          <h1 className="text-3xl font-bold mb-2">Setup Your Limits</h1>
          <p className="text-zinc-500">Pick the apps that distract you the most.</p>
        </header>

        <div className="space-y-4 mb-12">
          {apps.map(app => (
            <div 
              key={app.id}
              onClick={() => toggleAppSelection(app.id)}
              className={`flex items-center justify-between p-5 rounded-3xl border transition-all cursor-pointer ${app.isSelected ? 'border-black bg-zinc-50' : 'border-zinc-100 hover:border-zinc-200'}`}
            >
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-white ${app.color}`}>
                  {app.icon}
                </div>
                <div>
                  <h3 className="font-semibold text-lg">{app.name}</h3>
                  {app.isSelected && (
                    <div className="flex items-center gap-2 mt-1">
                      <Clock size={14} className="text-zinc-400" />
                      <input 
                        type="number" 
                        value={app.limitMinutes}
                        onChange={(e) => {
                          e.stopPropagation();
                          updateLimit(app.id, parseInt(e.target.value) || 0);
                        }}
                        className="w-12 bg-transparent border-b border-zinc-300 focus:border-black outline-none text-sm font-medium"
                      />
                      <span className="text-xs text-zinc-400 uppercase font-bold tracking-wider">min/day</span>
                    </div>
                  )}
                </div>
              </div>
              <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${app.isSelected ? 'bg-black border-black' : 'border-zinc-200'}`}>
                {app.isSelected && <CheckCircle2 size={14} className="text-white" />}
              </div>
            </div>
          ))}
        </div>

        <Button 
          disabled={selectedCount === 0}
          onClick={() => setStep('dashboard')}
          className="w-full py-4 text-lg"
        >
          Finish Setup
        </Button>
      </div>
    );
  };

  const DashboardView = () => {
    const selectedApps = apps.filter(a => a.isSelected);
    const [isStrictMode, setIsStrictMode] = useState(false);

    return (
      <div className="max-w-2xl mx-auto px-6 py-12 pb-32">
        <header className="flex items-center justify-between mb-12">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">FocusFine</h1>
            <p className="text-zinc-500">Monitoring active...</p>
          </div>
          <div className="flex gap-2">
            <button className="p-3 rounded-2xl bg-zinc-100 text-zinc-600 hover:bg-zinc-200 transition-colors">
              <Settings size={20} />
            </button>
          </div>
        </header>

        {/* Premium Focus Score Header */}
        <div className="mb-8 p-8 rounded-[2.5rem] bg-gradient-to-br from-zinc-900 to-black text-white relative overflow-hidden">
          <div className="relative z-10">
            <div className="flex justify-between items-start mb-6">
              <div>
                <p className="text-zinc-400 text-xs font-bold uppercase tracking-widest mb-1">Your Focus Score</p>
                <h2 className="text-6xl font-black">84<span className="text-2xl text-zinc-500">/100</span></h2>
              </div>
              <div className="bg-green-500/20 text-green-400 px-3 py-1 rounded-full text-xs font-bold border border-green-500/30">
                +12% vs Yesterday
              </div>
            </div>
            <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: '84%' }}
                className="h-full bg-white"
              />
            </div>
          </div>
          {/* Decorative background element */}
          <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-white/5 rounded-full blur-3xl" />
        </div>

        <div className="grid grid-cols-2 gap-4 mb-12">
          <Card>
            <div className="flex flex-col h-full justify-between">
              <DollarSign className="text-zinc-400 mb-4" size={24} />
              <div>
                <p className="text-zinc-400 text-sm font-medium uppercase tracking-wider mb-1">Total Spent</p>
                <h2 className="text-4xl font-bold">${totalSpent.toFixed(2)}</h2>
              </div>
            </div>
          </Card>
          <Card>
            <div className="flex flex-col h-full justify-between">
              <Clock className="text-zinc-400 mb-4" size={24} />
              <div>
                <p className="text-zinc-400 text-sm font-medium uppercase tracking-wider mb-1">Time Saved</p>
                <h2 className="text-4xl font-bold">4.2<span className="text-lg font-medium text-zinc-400 ml-1">hrs</span></h2>
              </div>
            </div>
          </Card>
        </div>

        {/* Strict Mode Toggle */}
        <div className={`mb-12 p-6 rounded-3xl border-2 transition-all flex items-center justify-between ${isStrictMode ? 'border-red-500 bg-red-50' : 'border-zinc-100 bg-white'}`}>
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${isStrictMode ? 'bg-red-500 text-white' : 'bg-zinc-100 text-zinc-400'}`}>
              <Lock size={24} />
            </div>
            <div>
              <h3 className={`font-bold ${isStrictMode ? 'text-red-900' : 'text-zinc-900'}`}>Strict Mode</h3>
              <p className={`text-sm ${isStrictMode ? 'text-red-700' : 'text-zinc-400'}`}>
                {isStrictMode ? 'No "Pay to Unlock" allowed until 5 PM.' : 'Allow emergency unlocks for $1.'}
              </p>
            </div>
          </div>
          <button 
            onClick={() => setIsStrictMode(!isStrictMode)}
            className={`w-14 h-8 rounded-full transition-all relative ${isStrictMode ? 'bg-red-500' : 'bg-zinc-200'}`}
          >
            <div className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-all ${isStrictMode ? 'left-7' : 'left-1'}`} />
          </button>
        </div>

        <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
          Active Limits <span className="text-sm font-normal text-zinc-400 bg-zinc-100 px-2 py-0.5 rounded-full">{selectedApps.length}</span>
        </h2>

        <div className="space-y-4">
          {selectedApps.map(app => (
            <div key={app.id} className={`bg-white rounded-3xl border border-zinc-100 shadow-sm p-6 group hover:border-zinc-300 transition-all cursor-pointer overflow-hidden relative`}>
              <div className="flex items-center justify-between relative z-10">
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-white ${app.color}`}>
                    {app.icon}
                  </div>
                  <div>
                    <h3 className="font-bold text-lg">{app.name}</h3>
                    <p className="text-zinc-400 text-sm">
                      {app.usedMinutes}m / {app.limitMinutes}m used
                    </p>
                  </div>
                </div>
                <Button 
                  variant="secondary" 
                  className="py-2 px-4 text-sm"
                  onClick={() => simulateLimitHit(app)}
                >
                  Simulate Hit
                </Button>
              </div>
              
              {/* Progress Bar */}
              <div className="absolute bottom-0 left-0 w-full h-1 bg-zinc-50">
                <div 
                  className="h-full bg-zinc-900 transition-all duration-1000" 
                  style={{ width: `${Math.min((app.usedMinutes / app.limitMinutes) * 100, 100)}%` }} 
                />
              </div>
            </div>
          ))}
          
          <button 
            onClick={() => setStep('setup')}
            className="w-full py-6 rounded-3xl border-2 border-dashed border-zinc-200 text-zinc-400 flex items-center justify-center gap-2 hover:border-zinc-300 hover:text-zinc-500 transition-all"
          >
            <Plus size={20} /> Add App
          </button>
        </div>

        {/* Analytics Section */}
        <div className="mt-16">
          <h2 className="text-2xl font-bold mb-8 flex items-center gap-2">
            <BarChart3 size={24} className="text-zinc-400" /> Your Analytics
          </h2>

          <StreakCard />
          <HourlyHeatmap />
          <WeeklyTrend />

          <div className="p-8 rounded-[2.5rem] bg-zinc-50 border border-zinc-100">
            <h4 className="font-bold text-zinc-900 mb-4">Weekly Summary</h4>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-zinc-500 text-sm">Most Vulnerable Time</span>
                <span className="font-bold text-sm">Tuesdays, 11:00 PM</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500 text-sm">Top Distraction</span>
                <span className="font-bold text-sm text-red-500">TikTok</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500 text-sm">Money Saved (vs last week)</span>
                <span className="font-bold text-sm text-green-600">+$14.00</span>
              </div>
              <div className="flex items-center justify-between pt-4 border-t border-zinc-200">
                <span className="text-zinc-500 text-sm font-medium">Daily Average Improvement</span>
                <span className="font-bold text-sm text-green-600">+2.4%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const LimitHitView = () => {
    if (!activeApp) return null;

    return (
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed inset-0 z-50 bg-white flex flex-col items-center justify-center p-8 text-center"
      >
        <div className="max-w-md w-full">
          <div className="mb-12 flex justify-center">
            <div className="relative">
              <div className={`w-32 h-32 rounded-[2.5rem] flex items-center justify-center text-white shadow-2xl ${activeApp.color}`}>
                {React.cloneElement(activeApp.icon as React.ReactElement, { size: 64 })}
              </div>
              <div className="absolute -top-4 -right-4 w-12 h-12 bg-red-500 rounded-full border-4 border-white flex items-center justify-center text-white shadow-lg">
                <Lock size={20} />
              </div>
            </div>
          </div>

          <h1 className="text-4xl font-black tracking-tight mb-4">Limit Reached</h1>
          <p className="text-zinc-500 text-xl mb-12 leading-relaxed">
            You've used up your daily <span className="font-bold text-black">{activeApp.limitMinutes} minutes</span> on {activeApp.name}.
          </p>

          <div className="space-y-4">
            <button 
              onClick={handlePay}
              className="w-full bg-black text-white py-6 rounded-[2rem] font-bold text-xl flex items-center justify-center gap-3 shadow-xl hover:scale-[1.02] active:scale-95 transition-all"
            >
              <DollarSign size={24} /> Pay $1.00 for 15m
            </button>
            
            <button 
              onClick={handleClose}
              className="w-full bg-zinc-100 text-zinc-600 py-6 rounded-[2rem] font-bold text-xl flex items-center justify-center gap-3 hover:bg-zinc-200 active:scale-95 transition-all"
            >
              <X size={24} /> Close {activeApp.name}
            </button>
          </div>

          <p className="mt-12 text-zinc-400 text-sm font-medium uppercase tracking-widest">
            FocusFine • Stay Disciplined
          </p>
        </div>
      </motion.div>
    );
  };

  return (
    <div className="min-h-screen bg-white text-zinc-900 font-sans selection:bg-zinc-900 selection:text-white">
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
        {step === 'limit-hit' && (
          <motion.div key="limit-hit" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <LimitHitView />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Global Status Bar Simulation */}
      <div className="fixed top-0 left-0 w-full h-1 z-[100] flex">
        <div className="flex-1 bg-zinc-100" />
      </div>
    </div>
  );
}

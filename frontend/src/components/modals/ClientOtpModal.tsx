"use client";

import { useState, useEffect } from 'react';
import { Lock, ShieldAlert, Check, X, KeyRound, Loader2 } from 'lucide-react';
import { taskMapApi } from '@/api/taskMap';
import { NexusLogoLoader } from '@/components/ui/NexusLogo';

interface ClientOtpModalProps {
  isOpen: boolean;
  onClose: () => void;
  clientName: string;
  hoursLogged?: number;
  weeklyLimit?: number;
  onSuccess: (otp: string, pmName: string) => void;
}

export function ClientOtpModal({
  isOpen,
  onClose,
  clientName,
  hoursLogged,
  weeklyLimit,
  onSuccess,
}: ClientOtpModalProps) {
  const [otp, setOtp] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [myPmOtp, setMyPmOtp] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let mounted = true;
    taskMapApi
      .getMyDailyOtp()
      .then((res) => {
        if (mounted && res?.isPm && res?.otp) {
          setMyPmOtp(res.otp);
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanOtp = otp.trim();
    if (!/^\d{4}$/.test(cleanOtp)) {
      setErrorMessage('Please enter a valid 4-digit number.');
      return;
    }

    setIsVerifying(true);
    setErrorMessage(null);

    try {
      const res = await taskMapApi.verifyClientOtp({
        client: clientName,
        otp: cleanOtp,
      });

      if (res?.success && res.pmName) {
        onSuccess(cleanOtp, res.pmName);
        onClose();
      } else {
        setErrorMessage(res?.error || "Invalid 4-digit OTP. Check with your Project Manager.");
      }
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.error || err.message || 'Verification failed. Please try again.');
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="relative w-full max-w-md bg-card border border-border rounded-xl shadow-2xl p-6 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
                <span>Client Overhours Lock</span>
              </h3>
              <p className="text-xs text-zinc-400">
                Authorization required to assign tasks
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Client & Overhours details */}
        <div className="p-3.5 rounded-lg bg-secondary/80 border border-border text-xs space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-zinc-400">Client:</span>
            <span className="font-semibold text-zinc-200">{clientName}</span>
          </div>
          {typeof hoursLogged === 'number' && typeof weeklyLimit === 'number' && (
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-zinc-400">Total Team Hours (All MAs):</span>
              <span className="font-mono font-medium text-amber-300">
                {hoursLogged.toFixed(1)} / {weeklyLimit.toFixed(1)} hrs (Overtime)
              </span>
            </div>
          )}
          <p className="text-[11px] text-zinc-400 pt-1 border-t border-border/60">
            This client has reached or exceeded its weekly hours limit across the entire team (all assistants combined, not just your individual hours). To proceed with assigning this task, please enter today's 4-digit OTP from your Project Manager (found under the Eye icon in their Nexus Header).
          </p>
        </div>

        {/* OTP Input Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {myPmOtp && (
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs">
              <span className="text-zinc-300">
                Your PM OTP today: <strong className="font-mono text-amber-300 tracking-wider text-sm">{myPmOtp}</strong>
              </span>
              <button
                type="button"
                onClick={() => {
                  setOtp(myPmOtp);
                  if (errorMessage) setErrorMessage(null);
                }}
                className="px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-semibold text-[11px] transition-colors cursor-pointer"
              >
                Use My OTP
              </button>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-amber-400" />
              <span>Project Manager 4-Digit OTP</span>
            </label>
            <input
              type="text"
              maxLength={4}
              autoFocus
              value={otp}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, '');
                setOtp(val);
                if (errorMessage) setErrorMessage(null);
              }}
              placeholder="0000"
              className="w-full text-center text-2xl tracking-[0.4em] font-mono py-2.5 rounded-lg bg-secondary border border-border text-zinc-100 placeholder:text-zinc-600 focus:outline-hidden focus:ring-2 focus:ring-amber-400/50"
            />
          </div>

          {errorMessage && (
            <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300 flex items-center gap-2">
              <Lock className="w-3.5 h-3.5 shrink-0 text-red-400" />
              <span>{errorMessage}</span>
            </div>
          )}

          {isVerifying ? (
            <div className="py-6 flex flex-col items-center justify-center gap-3 animate-in fade-in duration-150 select-none">
              <NexusLogoLoader size={44} label="Verifying OTP & transferring task..." />
            </div>
          ) : (
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 text-xs rounded-lg border border-border bg-secondary hover:bg-zinc-800 text-zinc-300 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={otp.trim().length !== 4}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer font-semibold shadow-xs"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Authorize & Assign</span>
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

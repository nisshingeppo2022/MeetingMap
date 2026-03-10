"use client";

import { useEffect } from "react";

export type ToastType = "success" | "error" | "info";

interface ToastProps {
  message: string;
  type?: ToastType;
  onClose: () => void;
  duration?: number;
}

const TYPE_STYLES: Record<ToastType, string> = {
  success: "bg-green-600",
  error: "bg-red-500",
  info: "bg-indigo-600",
};

const TYPE_ICONS: Record<ToastType, string> = {
  success: "✓",
  error: "✕",
  info: "ℹ",
};

export default function Toast({ message, type = "info", onClose, duration = 3000 }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [onClose, duration]);

  return (
    <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-white text-sm font-medium ${TYPE_STYLES[type]} animate-in fade-in slide-in-from-bottom-2`}>
      <span className="text-base leading-none">{TYPE_ICONS[type]}</span>
      <span>{message}</span>
    </div>
  );
}

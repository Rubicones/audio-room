"use client";

export type BootLogEntry = {
  step: string;
  detail?: string;
  at: string;
  ms: number;
};

const MAX_LOGS = 80;
let logs: BootLogEntry[] = [];
const subscribers = new Set<() => void>();
let bootStartedAt = 0;

export function markBootStarted() {
  if (typeof performance === "undefined") return;
  if (bootStartedAt === 0) {
    bootStartedAt = performance.now();
  }
}

function formatTime(date = new Date()) {
  return date.toLocaleTimeString(undefined, {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function elapsedMs() {
  if (typeof performance === "undefined" || bootStartedAt === 0) return 0;
  return Math.round(performance.now() - bootStartedAt);
}

export function bootLog(step: string, detail?: string) {
  const ms = elapsedMs();
  const entry: BootLogEntry = { step, detail, at: formatTime(), ms };
  logs = [...logs.slice(-(MAX_LOGS - 1)), entry];
  if (typeof window !== "undefined") {
    console.info(`[foam-boot +${ms}ms]`, step, detail ?? "");
  }
  subscribers.forEach((notify) => notify());
}

export function getBootLogs(): BootLogEntry[] {
  return logs;
}

export function getBootElapsedMs() {
  return elapsedMs();
}

export function subscribeBootLogs(notify: () => void) {
  subscribers.add(notify);
  return () => {
    subscribers.delete(notify);
  };
}

export function clearBootLogs() {
  logs = [];
  bootStartedAt = 0;
  subscribers.forEach((notify) => notify());
}

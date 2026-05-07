"use client";

import { useEffect, useState, useCallback } from "react";

// Per-device calendar visibility. Mobile and desktop each have their own
// disabled-set in localStorage so toggling on phone doesn't affect laptop.
// "Disabled" means the user has hidden that calendar on this device class;
// empty default = everything visible.

const MQ = "(min-width: 1024px)";
type DeviceClass = "mobile" | "desktop";

function getDevice(): DeviceClass {
  if (typeof window === "undefined") return "desktop";
  return window.matchMedia(MQ).matches ? "desktop" : "mobile";
}

const KEY = (d: DeviceClass) => `cal-disabled-${d}`;

function readSet(d: DeviceClass): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(KEY(d));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function writeSet(d: DeviceClass, s: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY(d), JSON.stringify(Array.from(s)));
  } catch {
    // ignore quota / unavailable
  }
}

// Cross-instance pubsub so the FilterSidebar toggle and the grid filtering
// both re-render when one of them mutates the per-device set.
const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}

export function useDeviceFilter(initialDisabled?: string[]) {
  const [device, setDevice] = useState<DeviceClass>("desktop");
  const [tick, setTick] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const d = getDevice();
    setDevice(d);
    // Seed once per device-class on first ever visit so we keep whatever
    // calendars were already toggled-off in the DB. After this, the device's
    // localStorage is the single source of truth; the DB flag is ignored.
    let seeded = false;
    if (initialDisabled && window.localStorage.getItem(KEY(d)) == null) {
      writeSet(d, new Set(initialDisabled));
      seeded = true;
    }
    setReady(true);

    const mql = window.matchMedia(MQ);
    const onChange = () => {
      const next = getDevice();
      setDevice(next);
      if (initialDisabled && window.localStorage.getItem(KEY(next)) == null) {
        writeSet(next, new Set(initialDisabled));
        emit();
      }
      setTick((t) => t + 1);
    };
    mql.addEventListener("change", onChange);

    const sub = () => setTick((t) => t + 1);
    listeners.add(sub);

    const onStorage = (e: StorageEvent) => {
      if (e.key && e.key.startsWith("cal-disabled-")) sub();
    };
    window.addEventListener("storage", onStorage);

    // If we just seeded, defer emit until after sibling hooks have had a
    // chance to subscribe. Otherwise their initial render shows unfiltered.
    const t = seeded ? setTimeout(emit, 0) : null;

    return () => {
      if (t) clearTimeout(t);
      mql.removeEventListener("change", onChange);
      listeners.delete(sub);
      window.removeEventListener("storage", onStorage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const disabled = readSet(device);

  const isEnabled = useCallback(
    (id: string) => !disabled.has(id),
    // disabled is reconstructed each render; tick + device are real deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [device, tick],
  );

  const toggle = useCallback(
    (id: string) => {
      const cur = readSet(device);
      if (cur.has(id)) cur.delete(id);
      else cur.add(id);
      writeSet(device, cur);
      emit();
    },
    [device],
  );

  return { device, isEnabled, toggle, ready };
}

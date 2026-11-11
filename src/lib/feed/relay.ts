"use client";

import { useEffect, useState } from "react";
import { LINK_PORT } from "./sources";

/**
 * The Stream panel's settings to every open gate screen (the OBS browser source too) through OFP
 * Link on this PC: the panel sends {"type":"relay","channel":"stream","msg":…}, OFP Tower passes it
 * to its other pages, and they apply it. So a change in the panel shows in OBS with no new URL.
 * Without OFP Tower running nothing is sent and the panel says to copy the stream URL again.
 * Spec: docs/OFP-LINK.md, "Relay".
 */
export const RELAY_CHANNEL = "stream";

type Listener = (msg: Record<string, unknown>) => void;
const listeners = new Set<Listener>();
const states = new Set<(open: boolean) => void>();
let ws: WebSocket | null = null;
let open = false;
let users = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let wait = 2000;

function setOpen(v: boolean) {
  open = v;
  states.forEach((f) => f(v));
}

function connect() {
  if (ws || users === 0) return;
  try {
    ws = new WebSocket(`ws://localhost:${LINK_PORT}`);
  } catch {
    return retry();
  }
  ws.onopen = () => {
    wait = 2000;
    setOpen(true);
  };
  ws.onmessage = (e) => {
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(String(e.data));
    } catch {
      return;
    }
    if (m.type !== "relay" || m.channel !== RELAY_CHANNEL || !m.msg || typeof m.msg !== "object") return;
    listeners.forEach((f) => f(m.msg as Record<string, unknown>));
  };
  ws.onclose = () => {
    ws = null;
    setOpen(false);
    retry();
  };
}

function retry() {
  if (users === 0 || timer) return;
  timer = setTimeout(() => {
    timer = null;
    connect();
  }, wait);
  wait = Math.min(15_000, wait * 1.5);
}

/** Sends a message to the other pages on OFP Tower; false when OFP Tower isn't connected. */
export function sendRelay(msg: Record<string, unknown>): boolean {
  if (!ws || !open) return false;
  ws.send(JSON.stringify({ type: "relay", channel: RELAY_CHANNEL, msg }));
  return true;
}

/** Keeps the relay connection while mounted (when `on`); calls `onMessage` for what other pages send. Returns whether it's connected. */
export function useRelay(on: boolean, onMessage?: Listener): boolean {
  const [isOpen, setIsOpen] = useState(open);
  useEffect(() => {
    if (!on) return;
    users++;
    states.add(setIsOpen);
    if (onMessage) listeners.add(onMessage);
    connect();
    return () => {
      users--;
      states.delete(setIsOpen);
      if (onMessage) listeners.delete(onMessage);
      if (users === 0) {
        if (timer) clearTimeout(timer);
        timer = null;
        if (ws) {
          ws.onclose = null;
          ws.close();
        }
        ws = null;
        setOpen(false);
      }
    };
  }, [on, onMessage]);
  return on && isOpen;
}

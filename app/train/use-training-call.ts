"use client";

import { useEffect, useEffectEvent, useReducer, useRef, useState } from "react";
import type { ObjectionPrompt } from "@/shared/objections";
import type { TrainingSession } from "@/shared/types";
import { createCall, fallbackRecovery, fallbackReply, FALLBACK_LINES, reduceCall, type CallSettings } from "./session";
import { listenToRep, prefetchSpeech, recordRep, recordingSupported, speakProspect, speechRecognitionAvailable, type RepListener } from "./voice";

export interface TrainingConfig {
  objections: ObjectionPrompt[];
  voice: "elevenlabs" | "browser";
  stt?: "elevenlabs" | "browser";
  replies: "model" | "scripted";
}
export interface ScoredSession { session: TrainingSession; grading: "model" | "placeholder" }

async function post<T>(path: string, data: unknown, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data), signal });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "The request failed. Please retry.");
  return result as T;
}

export function useTrainingCall(config: TrainingConfig | null) {
  const [call, dispatch] = useReducer(reduceCall, null);
  const [mode, setMode] = useState<"voice" | "text">("voice");
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState("");
  const [interim, setInterim] = useState("");
  const [status, setStatus] = useState<"idle" | "scoring" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<ScoredSession | null>(null);
  const [retry, setRetry] = useState(0);
  const scored = useRef<ScoredSession | null>(null);
  const browserVoice = useRef(false);
  const startVersion = useRef(0);
  const flushSpeech = useRef<(() => void) | null>(null);
  const callId = call?.id;
  const phase = call?.phase;
  const pending = call?.pending;
  const listening = Boolean(call && call.phase !== "closing" && call.phase !== "complete" && !pending);

  useEffect(() => () => { startVersion.current++; }, []);

  const tick = useEffectEvent(() => {
    if (call?.deadline && Date.now() >= call.deadline) flushSpeech.current?.();
    dispatch({ type: "tick", now: Date.now() });
  });
  useEffect(() => {
    if (!callId || phase === "complete") return;
    const timer = setInterval(() => tick(), 250);
    return () => clearInterval(timer);
  }, [callId, phase]);

  /** Interruption line + audio generated during the last seconds of the pitch so it fires instantly. */
  const prefetched = useRef<{ callId: string; text: string; audio: Blob | null } | null>(null);
  const prefetchInterrupt = useEffectEvent(async () => {
    if (!call || call.phase !== "pitch" || prefetched.current?.callId === call.id) return;
    const current = call;
    prefetched.current = { callId: current.id, text: "", audio: null };
    const objection = current.objections[0];
    const fallback = `${FALLBACK_LINES.interrupt} ${objection.text}`;
    let text = fallback;
    try {
      const line = await post<{ text: string }>("/api/training/prospect", { scenario: current.scenario, event: "interrupt", objectionId: objection.id, transcript: current.transcript }, AbortSignal.timeout(8000));
      text = line.text || fallback;
    } catch { /* fallback line */ }
    let audio: Blob | null = null;
    if (audioEnabled && config?.voice === "elevenlabs" && !browserVoice.current) audio = await prefetchSpeech(text, AbortSignal.timeout(8000));
    if (prefetched.current?.callId === current.id) prefetched.current = { callId: current.id, text, audio };
  });
  useEffect(() => {
    if (phase !== "pitch" || !call?.deadline) return;
    const lead = Math.max(0, call.deadline - Date.now() - 8000);
    const timer = setTimeout(() => void prefetchInterrupt(), lead);
    return () => clearTimeout(timer);
  }, [phase, callId, call?.deadline]);

  const runPending = useEffectEvent(async (signal: AbortSignal) => {
    if (!call?.pending) return;
    const current = call;
    const work = current.pending!;
    if (work.kind === "line") {
      let text = work.fallback;
      const ready = work.event === "interrupt" && prefetched.current?.callId === current.id && prefetched.current.text ? prefetched.current : null;
      if (ready) text = ready.text;
      else {
        try {
          const line = await post<{ text: string; mode: "model" | "scripted" }>("/api/training/prospect", { scenario: current.scenario, event: work.event, objectionId: work.objectionId, transcript: current.transcript }, AbortSignal.any([signal, AbortSignal.timeout(9000)]));
          text = line.text || work.fallback;
        } catch {
          if (signal.aborted) return;
        }
      }
      if (!signal.aborted) dispatch({ type: "line", callId: current.id, pendingId: work.id, text, now: Date.now() });
      return;
    }
    if (work.kind === "speak") {
      if (audioEnabled) {
        try {
          const cached = prefetched.current?.callId === current.id && prefetched.current.text === work.text ? prefetched.current.audio : null;
          await speakProspect(work.text, {
            signal, provider: browserVoice.current ? "browser" : config?.voice ?? "browser", audio: cached,
            onFallback: (message) => { browserVoice.current = true; setNotice(message); },
          });
        } catch {
          if (signal.aborted) return;
          setNotice("Audio could not play. The prospect's words are shown on screen. You can turn prospect audio off and continue.");
        }
      } else {
        await new Promise<void>((resolve) => { setTimeout(resolve, 100); });
      }
      if (!signal.aborted) dispatch({ type: "spoken", callId: current.id, pendingId: work.id, now: Date.now() });
      return;
    }
    const leaving = current.phase === "leaving";
    const objection = current.objections[current.objectionIndex];
    const nextObjection = current.objections[(current.objectionIndex + 1) % current.objections.length];
    let response = (leaving ? fallbackRecovery(work.text) : fallbackReply(objection.category, work.text, nextObjection)) as { reply: string; handled: boolean; next?: string; mode: "model" | "scripted" };
    try {
      response = await post("/api/training/reply", leaving
        ? { scenario: current.scenario, leaving: true, transcript: current.transcript }
        : { scenario: current.scenario, objectionId: objection.id, nextObjectionId: nextObjection.id, transcript: current.transcript }, AbortSignal.any([signal, AbortSignal.timeout(10_000)]));
    } catch {
      if (signal.aborted) return;
      setNotice("The model reply was unavailable. Continuing with clearly labeled scripted practice.");
    }
    if (!signal.aborted) dispatch({ type: "reply", callId: current.id, pendingId: work.id, ...response, now: Date.now() });
  });
  useEffect(() => {
    if (!pending) return;
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) void runPending(controller.signal); });
    return () => controller.abort();
  }, [pending, callId, audioEnabled]);

  const onVoiceTurn = useEffectEvent((text: string) => {
    if (call) dispatch({ type: "rep", callId: call.id, phase: call.phase, text, now: Date.now() });
    setInterim("");
  });
  useEffect(() => {
    if (!listening || mode !== "voice") return;
    let input: RepListener | undefined;
    const onError = (message: string) => { setMode("text"); setNotice(message); };
    try {
      input = config?.stt === "elevenlabs" && recordingSupported()
        ? recordRep({ onTurn: onVoiceTurn, onInterim: setInterim, onError })
        : listenToRep({ pitch: phase === "pitch", onTurn: onVoiceTurn, onInterim: setInterim, onError });
      flushSpeech.current = input.flush;
    } catch {
      queueMicrotask(() => onError("Speech recognition is not supported. Continue with typed input."));
    }
    return () => { input?.stop(); flushSpeech.current = null; };
  }, [listening, mode, phase, callId, config?.stt]);

  const save = useEffectEvent(async (signal: AbortSignal) => {
    await Promise.resolve();
    if (!call || signal.aborted) return;
    if (!call.transcript.some((turn) => turn.speaker === "rep")) {
      setError("No rep speech was captured. Start a new call using the microphone or typed practice.");
      setStatus("error");
      return;
    }
    setError("");
    try {
      if (!scored.current) {
        setStatus("scoring");
        const response = await post<ScoredSession>("/api/training/score", {
          id: call.id, repId: call.repId, startedAt: new Date(call.startedMs).toISOString(),
          durationSec: Math.round((call.now - call.startedMs) / 1000), outcome: call.outcome, transcript: call.transcript,
        }, AbortSignal.any([signal, AbortSignal.timeout(55_000)]));
        if (signal.aborted) return;
        scored.current = response;
        setResult(response);
      }
      setStatus("saving");
      await post("/api/training/sessions", scored.current.session, AbortSignal.any([signal, AbortSignal.timeout(15_000)]));
      if (!signal.aborted) setStatus("saved");
    } catch (reason) {
      if (!signal.aborted) {
        setError(reason instanceof Error && reason.name !== "TimeoutError" ? reason.message : "The request timed out. Your transcript is retained; retry when ready.");
        setStatus("error");
      }
    }
  });
  useEffect(() => {
    if (phase !== "complete") return;
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) void save(controller.signal); });
    return () => controller.abort();
  }, [phase, callId, retry]);

  async function start(settings: Omit<CallSettings, "id" | "objections">) {
    if (!config || starting) return;
    const version = ++startVersion.current;
    setStarting(true);
    setNotice("");
    setError("");
    setResult(null);
    setStatus("idle");
    setInterim("");
    scored.current = null;
    browserVoice.current = false;
    try {
      if (mode === "voice") {
        const supported = config.stt === "elevenlabs" ? recordingSupported() : speechRecognitionAvailable() && Boolean(navigator.mediaDevices?.getUserMedia);
        if (!supported) throw new Error("unsupported");
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      }
    } catch {
      if (version === startVersion.current) {
        setMode("text");
        setNotice("Microphone access or browser speech recognition is unavailable. This call will use typed practice instead.");
      }
    }
    if (version !== startVersion.current) return;
    setStarting(false);
    dispatch({ type: "begin", state: createCall({ ...settings, id: crypto.randomUUID(), objections: config.objections }, Date.now()) });
  }

  function reset() {
    startVersion.current++;
    setStarting(false);
    dispatch({ type: "reset" });
    setStatus("idle");
    setResult(null);
    setError("");
    setInterim("");
    scored.current = null;
  }

  return {
    call, mode, setMode, audioEnabled, setAudioEnabled, starting, start, reset, notice, interim, listening, result, status, error,
    retry: () => setRetry((value) => value + 1),
    send: (text: string) => { if (call) dispatch({ type: "rep", callId: call.id, phase: call.phase, text, now: Date.now() }); },
    finish: () => { flushSpeech.current?.(); dispatch({ type: "finish", now: Date.now() }); },
  };
}

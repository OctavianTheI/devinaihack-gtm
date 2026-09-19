"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Conversation } from "@elevenlabs/client";
import { pickObjections } from "@/shared/objections";
import type {
  RepView,
  Scores,
  Divergence,
  TrainingSession,
  TrainingTranscriptTurn,
} from "@/shared/types";

// Demo timings (PLAN.md §1 step 3): rep pitches for this long, then gets
// interrupted and challenged for OBJECTION_SEC with fixed-list objections.
const PITCH_SEC = 30;
const OBJECTION_SEC = 60;
// Once this deep into the objection phase we ask the scorer whether the rep
// has earned the success branch ("per the live scoring", not a fixed script).
const SUCCESS_CHECK_AT_SEC = 40;
const WIN_AVG_THRESHOLD = 60;
// After the success branch fires, give the agent a moment to deliver the
// "send me the link" beat before we hang up.
const WON_HANGUP_DELAY_MS = 12_000;

// Injected user-side triggers used to force an agent turn at phase
// boundaries. They are filtered back out of the transcript in onMessage.
const INTERRUPT_TRIGGER =
  "(the prospect cuts you off mid-sentence and raises a concern)";
const SUCCESS_TRIGGER = "(the prospect suddenly leans in, interested)";

export type Phase =
  | "idle"
  | "connecting"
  | "intro"
  | "pitch"
  | "objections"
  | "won"
  | "scoring"
  | "done"
  | "error";

export interface SessionResult {
  session: TrainingSession;
  rep: RepView;
}

interface VoiceConversationLike {
  sendContextualUpdate(text: string): void;
  sendUserMessage(text: string): void;
  endSession(): Promise<void>;
}

export function useTrainingSession(repId: string) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [transcript, setTranscript] = useState<TrainingTranscriptTurn[]>([]);
  const [result, setResult] = useState<SessionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const conversationRef = useRef<VoiceConversationLike | null>(null);
  const transcriptRef = useRef<TrainingTranscriptTurn[]>([]);
  const phaseRef = useRef<Phase>("idle");
  const startedAtRef = useRef<number>(0);
  const pitchStartSecRef = useRef<number | null>(null);
  const objectionsStartSecRef = useRef<number | null>(null);
  const successCheckedRef = useRef(false);
  const injectedRef = useRef(new Set<string>([INTERRUPT_TRIGGER, SUCCESS_TRIGGER]));
  const timersRef = useRef<number[]>([]);

  const setPhaseBoth = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  const elapsed = () => (Date.now() - startedAtRef.current) / 1000;

  const cleanupTimers = () => {
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
  };

  const scoreNow = async (turns: TrainingTranscriptTurn[]) => {
    const res = await fetch("/api/training/score", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        transcript: turns.map(({ speaker, text }) => ({ speaker, text })),
      }),
    });
    if (!res.ok) throw new Error(`score failed: HTTP ${res.status}`);
    return (await res.json()) as {
      scores: Scores;
      divergences: Divergence[];
      summary: string;
    };
  };

  const finish = useCallback(
    async (outcome: "scored" | "won") => {
      if (phaseRef.current === "scoring" || phaseRef.current === "done") return;
      setPhaseBoth("scoring");
      cleanupTimers();
      try {
        await conversationRef.current?.endSession();
      } catch {
        // session may already be closed
      }
      conversationRef.current = null;

      const turns = transcriptRef.current;
      const startedAtIso = new Date(startedAtRef.current).toISOString();
      try {
        const scored = await scoreNow(turns);
        const res = await fetch("/api/training/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            repId,
            startedAt: startedAtIso,
            durationSec: Math.round(elapsed()),
            transcript: turns,
            outcome,
            scores: scored.scores,
            divergences: scored.divergences,
            summary: scored.summary,
          }),
        });
        if (!res.ok) throw new Error(`save failed: HTTP ${res.status}`);
        const data = (await res.json()) as SessionResult;
        setResult(data);
        setPhaseBoth("done");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhaseBoth("error");
      }
    },
    [repId]
  );

  const triggerAgentTurn = (injected: string, context: string) => {
    const conv = conversationRef.current;
    if (!conv) return;
    conv.sendContextualUpdate(context);
    conv.sendUserMessage(injected);
  };

  const enterObjectionPhase = useCallback(() => {
    if (phaseRef.current !== "pitch") return;
    setPhaseBoth("objections");
    objectionsStartSecRef.current = elapsed();
    const objections = pickObjections(4);
    triggerAgentTurn(
      INTERRUPT_TRIGGER,
      `[System] The rep's ${PITCH_SEC}s pitch window is over — interrupt them now. ` +
        `Then challenge them with these objections, one at a time, reacting to their answers: ` +
        objections.map((o) => `"${o.text}"`).join(" | ")
    );
  }, []);

  const maybeFireSuccessBranch = useCallback(async () => {
    if (successCheckedRef.current) return;
    successCheckedRef.current = true;
    try {
      const { scores } = await scoreNow(transcriptRef.current);
      const avg = (scores.objectionHandling + scores.closeRate) / 2;
      if (avg >= WIN_AVG_THRESHOLD && phaseRef.current === "objections") {
        setPhaseBoth("won");
        triggerAgentTurn(
          SUCCESS_TRIGGER,
          "[System] The rep is handling this well. Break character positively now: tell them you're ready to purchase, ask them to send a link to your email, and tell them to stay on the line — let's get this going."
        );
        timersRef.current.push(
          window.setTimeout(() => void finish("won"), WON_HANGUP_DELAY_MS)
        );
      }
    } catch {
      // scorer unreachable — just run out the objection phase normally
    }
  }, [finish]);

  // Master ticker: drives phase transitions off the elapsed clock.
  useEffect(() => {
    if (phase === "idle" || phase === "done" || phase === "error") return;
    const t = window.setInterval(() => {
      setElapsedSec(elapsed());
      const p = phaseRef.current;
      if (
        p === "pitch" &&
        pitchStartSecRef.current !== null &&
        elapsed() - pitchStartSecRef.current >= PITCH_SEC
      ) {
        enterObjectionPhase();
      } else if (
        p === "objections" &&
        objectionsStartSecRef.current !== null
      ) {
        const intoObjections = elapsed() - objectionsStartSecRef.current;
        if (intoObjections >= SUCCESS_CHECK_AT_SEC) void maybeFireSuccessBranch();
        if (intoObjections >= OBJECTION_SEC) void finish("scored");
      }
    }, 250);
    return () => window.clearInterval(t);
  }, [phase, enterObjectionPhase, maybeFireSuccessBranch, finish]);

  const start = useCallback(async () => {
    setPhaseBoth("connecting");
    setError(null);
    setResult(null);
    setTranscript([]);
    transcriptRef.current = [];
    successCheckedRef.current = false;
    pitchStartSecRef.current = null;
    objectionsStartSecRef.current = null;
    try {
      const res = await fetch("/api/training/voice", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `voice session failed: HTTP ${res.status}`);
      }
      const { signedUrl } = (await res.json()) as { signedUrl: string };

      const conversation = await Conversation.startSession({
        signedUrl,
        connectionType: "websocket",
        onMessage: ({ message, role }) => {
          if (role === "user" && injectedRef.current.has(message)) return;
          const turn: TrainingTranscriptTurn = {
            speaker: role === "user" ? "rep" : "customer",
            text: message,
            atSec: Math.round(elapsed()),
          };
          transcriptRef.current = [...transcriptRef.current, turn];
          setTranscript(transcriptRef.current);
          // Intro gate: the rep's first substantive utterance starts the
          // pitch clock. The agent prompt handles the "who is this?" pushback
          // if they launch in without introducing themselves.
          if (
            phaseRef.current === "intro" &&
            turn.speaker === "rep" &&
            turn.text.trim().split(/\s+/).length >= 3
          ) {
            pitchStartSecRef.current = elapsed();
            setPhaseBoth("pitch");
          }
        },
        onDisconnect: () => {
          if (
            phaseRef.current !== "done" &&
            phaseRef.current !== "scoring" &&
            phaseRef.current !== "error"
          ) {
            void finish("scored");
          }
        },
        onError: (message) => {
          setError(typeof message === "string" ? message : "voice error");
        },
      });
      conversationRef.current = conversation;
      startedAtRef.current = Date.now();
      setElapsedSec(0);
      setPhaseBoth("intro");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhaseBoth("error");
    }
  }, [finish]);

  const stop = useCallback(() => {
    void finish("scored");
  }, [finish]);

  // Safety net: hang up if the tab unmounts mid-session.
  useEffect(
    () => () => {
      cleanupTimers();
      void conversationRef.current?.endSession();
    },
    []
  );

  return { phase, elapsedSec, transcript, result, error, start, stop };
}

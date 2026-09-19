"use client";

import { useEffect, useState } from "react";
import { useTrainingSession, type Phase } from "./useTrainingSession";
import type { RepView } from "@/shared/types";
import styles from "./page.module.css";

const PHASE_LABEL: Record<Phase, string> = {
  idle: "Ready",
  connecting: "Dialing…",
  intro: "Introduce yourself",
  pitch: "Pitching",
  objections: "Handling objections",
  won: "Closing the deal",
  scoring: "Scoring call…",
  done: "Session complete",
  error: "Error",
};

function ClientPhoto() {
  return (
    <svg viewBox="0 0 320 180" className={styles.photo} role="img" aria-label="You and a client on a call">
      <rect width="320" height="180" fill="#e8e4dc" />
      <rect y="120" width="320" height="60" fill="#c9c2b4" />
      <circle cx="105" cy="72" r="26" fill="#8a7f6d" />
      <rect x="72" y="98" width="66" height="50" rx="10" fill="#8a7f6d" />
      <circle cx="215" cy="72" r="26" fill="#5d6b7a" />
      <rect x="182" y="98" width="66" height="50" rx="10" fill="#5d6b7a" />
      <rect x="140" y="108" width="40" height="26" rx="4" fill="#3d3a34" />
      <text x="160" y="168" textAnchor="middle" fontSize="11" fill="#6b6558" fontFamily="system-ui">
        you —————————— client
      </text>
    </svg>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.scoreRow}>
      <span className={styles.scoreLabel}>{label}</span>
      <div className={styles.scoreTrack}>
        <div className={styles.scoreFill} style={{ width: `${value}%` }} />
      </div>
      <span className={styles.scoreValue}>{value}</span>
    </div>
  );
}

export default function TrainPage() {
  const [reps, setReps] = useState<RepView[]>([]);
  const [repId, setRepId] = useState("rep-01");
  const { phase, elapsedSec, transcript, result, error, start, stop } =
    useTrainingSession(repId);

  useEffect(() => {
    fetch("/api/reps?source=live")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { reps: RepView[] }) => {
        setReps(d.reps);
        if (d.reps[0]) setRepId(d.reps[0].id);
      })
      .catch(() => setReps([]));
  }, []);

  const live = ["connecting", "intro", "pitch", "objections", "won"].includes(phase);

  return (
    <main className={styles.main}>
      <h1 className={styles.title}>Train</h1>

      <section className={styles.card}>
        <ClientPhoto />
        <div className={styles.controls}>
          <label className={styles.repPicker}>
            Training as{" "}
            <select
              value={repId}
              onChange={(e) => setRepId(e.target.value)}
              disabled={live}
            >
              {reps.length === 0 && <option value="rep-01">rep-01</option>}
              {reps.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.statusRow}>
            <span className={`${styles.badge} ${styles[phase]}`}>
              {PHASE_LABEL[phase]}
            </span>
            {live && <span className={styles.timer}>{Math.floor(elapsedSec)}s</span>}
          </div>
          {phase === "idle" || phase === "done" || phase === "error" ? (
            <button className={styles.play} onClick={() => void start()}>
              ▶ Play
            </button>
          ) : (
            <button className={styles.hangup} onClick={stop}>
              End call
            </button>
          )}
        </div>
      </section>

      {error && <p className={styles.error}>{error}</p>}

      {transcript.length > 0 && (
        <section className={styles.transcript}>
          {transcript.map((t, i) => (
            <p key={i} className={t.speaker === "rep" ? styles.rep : styles.customer}>
              <strong>{t.speaker === "rep" ? "You" : "Jordan"}:</strong> {t.text}
            </p>
          ))}
        </section>
      )}

      {result && (
        <section className={styles.results}>
          <h2>
            {result.session.outcome === "won" ? "Deal won 🎉" : "Call scored"}
          </h2>
          <ScoreBar label="Close likelihood" value={result.session.scores.closeRate} />
          <ScoreBar label="Objection handling" value={result.session.scores.objectionHandling} />
          <ScoreBar label="Script adherence" value={result.session.scores.scriptAdherence} />
          <ScoreBar label="Technical answers" value={result.session.scores.technicalAnswers} />
          <p className={styles.summary}>{result.session.summary}</p>
          {result.session.divergences.length > 0 && (
            <ul className={styles.divergences}>
              {result.session.divergences.map((d, i) => (
                <li key={i}>
                  <strong>{d.scriptStep}</strong> ({d.verdict}) — {d.whatTheyDid}.{" "}
                  <em>{d.aiReason}</em>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}

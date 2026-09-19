"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { RUBRIC } from "@/shared/rubric";
import type { RepView, Scores } from "@/shared/types";
import { hasIntroduction, OBJECTION_DURATION_SEC, PITCH_DURATION_SEC } from "./session";
import { useTrainingCall, type TrainingConfig } from "./use-training-call";
import styles from "./page.module.css";

const PHOTO = "https://images.unsplash.com/photo-1573497491208-6b1acb260507?auto=format&fit=crop&w=1400&q=85";
const phaseLabels = { intro: "Introduce yourself", pitch: "Make your pitch", challenge: "Handle objections", closing: "Closing the call", complete: "Call complete" };

export default function TrainPage() {
  const [reps, setReps] = useState<RepView[]>([]);
  const [config, setConfig] = useState<TrainingConfig | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [repId, setRepId] = useState("");
  const [company, setCompany] = useState("Northstar");
  const [offer, setOffer] = useState("CRM automation");
  const [pitchSec, setPitchSec] = useState(PITCH_DURATION_SEC);
  const [objectionSec, setObjectionSec] = useState(OBJECTION_DURATION_SEC);
  const [consent, setConsent] = useState(false);
  const [draft, setDraft] = useState("");
  const coach = useTrainingCall(config);
  const { call, result, status } = coach;
  const active = Boolean(call && call.phase !== "complete");
  const selected = reps.find((rep) => rep.id === repId);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const responses = await Promise.all([
          fetch("/api/reps?source=live", { signal: controller.signal, cache: "no-store" }),
          fetch("/api/training/config", { signal: controller.signal, cache: "no-store" }),
        ]);
        if (responses.some((response) => !response.ok)) throw new Error("Could not load training setup. Please retry.");
        const [team, training] = await Promise.all(responses.map((response) => response.json()));
        if (controller.signal.aborted) return;
        setReps(team.reps);
        setRepId((current) => current || team.reps[0]?.id || "");
        setConfig(training);
        setLoadError("");
      } catch (error) {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Could not load training setup.");
      }
    }
    void load();
    return () => controller.abort();
  }, [reload]);

  const remaining = call?.deadline ? Math.max(0, Math.ceil((call.deadline - call.now) / 1000)) : null;
  const customer = call?.transcript.filter((turn) => turn.speaker === "customer").at(-1);
  const firstRep = call?.transcript.findIndex((turn) => turn.speaker === "rep") ?? -1;
  const strongIntro = call?.transcript.findIndex((turn) => turn.speaker === "rep" && hasIntroduction(turn.text, call.scenario)) ?? -1;
  const canPlay = config && selected && consent && company.trim().length >= 2 && offer.trim().length >= 3 && !coach.starting;

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <Link href="/monitor" className={styles.brand}><span aria-hidden="true">S</span>Sales Coach</Link>
        <nav aria-label="Main navigation"><Link href="/monitor">Monitor team</Link><Link href="/train" aria-current="page">Train</Link></nav>
        <span className={styles.workspace}>Your practice space</span>
      </header>
      <main className={styles.main}>
        <header className={styles.heading}><p className={styles.eyebrow}>A little practice. A better next call.</p><h1>Make your next pitch count.</h1><p>A cold call. A skeptical prospect. A safe place to get better.</p></header>
        {loadError && <div className={styles.alert} role="alert">{loadError} <button onClick={() => setReload((value) => value + 1)}>Retry setup</button></div>}
        {!config && !loadError && <p role="status" className={styles.note}>Loading reps and training setup…</p>}
        <div className={styles.workspaceGrid}>
          <section className={styles.callCard} aria-labelledby="practice-title">
            <div className={styles.photo}>
              <Image src={PHOTO} alt="Two colleagues sitting across a table in conversation, illustrating a rep and client meeting" width={1400} height={900} unoptimized loading="eager" />
              <div className={styles.photoShade} />
              <span className={styles.simulation}>AI role-play · not a real client</span>
              <div className={styles.photoCaption}><p className={styles.eyebrow}>You + a future client</p><h2 id="practice-title">Meet Alex.</h2><p>A busy operations lead who wasn’t expecting your call.</p></div>
            </div>
            <div className={styles.callBody}>
              <div className={styles.callHeading}>
                <div><p className={styles.eyebrow}>{call ? phaseLabels[call.phase] : "Cold-call practice"}</p><h3>{call?.outcome === "won" ? "You won the practice deal." : active ? "Make the conversation yours." : "Ready when you are."}</h3></div>
                {active && <div className={styles.timer} aria-label="Time remaining">{remaining === null ? "⏸" : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`}<small>{remaining === null ? "paused · Alex's turn" : "your time left"}</small></div>}
              </div>
              <ol className={styles.phases} aria-label="Training phases">
                {(["intro", "pitch", "challenge"] as const).map((phase, index) => <li key={phase} aria-current={call?.phase === phase ? "step" : undefined}><span>{index + 1}</span>{phase === "intro" ? "Introduce" : phase === "pitch" ? `Pitch · ${call?.pitchSec ?? pitchSec}s` : `Objections · ${call?.objectionSec ?? objectionSec}s of your time`}</li>)}
              </ol>
              {!call ? (
                <div className={styles.startArea}>
                  <p>You’re making the call. Start with your name, company, and offer. Alex will listen to your pitch, interrupt when time is up, then challenge your answers.</p>
                  <label className={styles.consent}><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />I’ll use fictional details. I understand microphone audio is sent to the configured transcription service (ElevenLabs Scribe, or my browser’s speech service), and the transcript is sent to the configured AI provider for replies and grading.</label>
                  <button className={styles.playButton} disabled={!canPlay} onClick={() => {
                    if (selected) void coach.start({ repId, scenario: { repName: selected.name, company: company.trim(), offer: offer.trim() }, pitchSec, objectionSec });
                  }}><span aria-hidden="true">▶</span>{coach.starting ? "Connecting microphone…" : "Play"}</button>
                  {coach.starting && <button className={styles.textButton} onClick={coach.reset}>Cancel</button>}
                  <p className={styles.note}>{config?.stt === "elevenlabs" ? "Microphone practice works in any modern browser: your speech is recorded per turn and transcribed by ElevenLabs Scribe. Pause for about a second to send a turn." : "Microphone practice uses browser speech recognition, which needs Chrome or Edge on HTTPS or localhost."} Headphones help avoid feedback.</p>
                </div>
              ) : (
                <>
                  <div className={styles.prospect} aria-live="polite"><span className={styles.avatar}>A</span><div><p>Alex · prospect</p><blockquote>{customer?.text}</blockquote></div></div>
                  {active && <>
                    <div className={styles.callStatus} role="status"><span className={coach.listening ? styles.listeningDot : styles.thinkingDot} />{call.pending?.kind === "reply" ? "Alex is considering your answer…" : call.pending?.kind === "line" ? "Alex is thinking…" : call.pending?.kind === "speak" ? coach.audioEnabled ? "Alex is speaking…" : "Alex’s reply is on screen" : coach.mode === "voice" ? "Your turn · listening" : "Your turn · type your response"}<span>{call.handledIds.length} / 2 objections addressed</span></div>
                    {coach.mode === "voice" ? <div className={styles.liveWords}><p>{coach.interim || (config?.stt === "elevenlabs" ? "Speak, then pause — your turn is transcribed when you stop." : "Your words will appear here as they’re recognized.")}</p><button className={styles.textButton} onClick={() => coach.setMode("text")}>Use typed input instead</button></div> : <form className={styles.responseForm} onSubmit={(event) => { event.preventDefault(); coach.send(draft); setDraft(""); }}><label htmlFor="rep-response">Your response</label><textarea id="rep-response" rows={3} maxLength={1200} value={draft} disabled={!coach.listening} onChange={(event) => setDraft(event.target.value)} placeholder={call.phase === "intro" ? `Hi, I’m ${call.scenario.repName.split(" ")[0]} from ${call.scenario.company}. We offer ${call.scenario.offer}…` : "Acknowledge the concern, answer it, and make the value concrete."} /><button className={styles.primaryButton} disabled={!coach.listening || !draft.trim()}>Send response</button></form>}
                    <div className={styles.callActions}><button className={styles.secondaryButton} onClick={coach.finish} disabled={!call.transcript.some((turn) => turn.speaker === "rep")}>End & score</button><button className={styles.textButton} onClick={() => { coach.reset(); setDraft(""); }}>Cancel call</button></div>
                  </>}
                </>
              )}
              {coach.notice && <p className={styles.notice} role="status">{coach.notice}</p>}
              {(config?.replies === "scripted" || call?.scripted) && <p className={styles.notice}>Scripted prospect fallback is active: Alex uses fixed lines and a simple practice heuristic instead of the model. Configure SCORER_API_KEY for generated dialogue.</p>}
            </div>
            <p className={styles.photoCredit}>Illustrative photo by <a href="https://unsplash.com/de/fotos/two-women-sitting-beside-table-and-talking-LQ1t-8Ms5PY" target="_blank" rel="noreferrer">Christina @ wocintechchat.com / Unsplash</a>.</p>
          </section>
          <aside className={styles.sidebar}>
            <section className={styles.settings} aria-labelledby="setup-title"><p className={styles.eyebrow}>Set the scene</p><h2 id="setup-title">Your call, your pitch.</h2>
              <fieldset disabled={active || coach.starting || status === "scoring" || status === "saving"}>
                <label htmlFor="training-rep">Practice as</label><select id="training-rep" value={repId} onChange={(event) => setRepId(event.target.value)}>{reps.length === 0 && <option value="">No reps available</option>}{reps.map((rep) => <option key={rep.id} value={rep.id}>{rep.name}</option>)}</select>
                <label htmlFor="company">Your company</label><input id="company" value={company} minLength={2} maxLength={100} onChange={(event) => setCompany(event.target.value)} />
                <label htmlFor="offer">Your offer</label><input id="offer" value={offer} minLength={3} maxLength={300} onChange={(event) => setOffer(event.target.value)} />
                <div className={styles.inputMode} role="group" aria-label="Practice input"><button type="button" aria-pressed={coach.mode === "voice"} onClick={() => coach.setMode("voice")}>Microphone</button><button type="button" aria-pressed={coach.mode === "text"} onClick={() => coach.setMode("text")}>Typed practice</button></div>
                <details className={styles.durations}><summary>Adjust practice length</summary><label htmlFor="pitch-duration">Pitch <strong>{pitchSec}s</strong></label><input id="pitch-duration" type="range" min="10" max="60" step="5" value={pitchSec} onChange={(event) => setPitchSec(Number(event.target.value))} /><label htmlFor="objection-duration">Objections <strong>{objectionSec}s</strong></label><input id="objection-duration" type="range" min="20" max="120" step="10" value={objectionSec} onChange={(event) => setObjectionSec(Number(event.target.value))} /></details>
              </fieldset>
              <label className={styles.audioToggle}><input type="checkbox" checked={coach.audioEnabled} onChange={(event) => coach.setAudioEnabled(event.target.checked)} />Speak prospect replies</label><p className={styles.note}>{config?.voice === "elevenlabs" ? "ElevenLabs Flash voice and Scribe transcription, with browser fallbacks." : "Browser voice and browser speech recognition. Configure ElevenLabs on the server for Flash voice and Scribe transcription."} Typed practice also works with audio off.</p>
            </section>
            <section className={styles.brief}><p className={styles.eyebrow}>Make a good first impression</p><h2>They didn’t call you.</h2><ul><li>Say who you are, your company, and what you offer.</li><li>Make the value specific to a busy operations team.</li><li>Address concerns honestly. Don’t guess at technical details.</li><li>Handle two different objections with credible, non-repeated answers to earn a practice win.</li></ul><p className={styles.note}>A win is a demo coaching signal, not a real purchase prediction. The prospect’s email uses the fictional .example domain.</p></section>
          </aside>
        </div>
        {call?.phase === "complete" && <section className={styles.results} aria-labelledby="results-title">
          <div className={styles.resultHeading}><div><p className={styles.eyebrow}>{call.outcome === "won" ? "Practice deal won" : "Practice complete"}</p><h2 id="results-title">Your call, reflected back.</h2><p>{call.scenario.repName} · {Math.round((call.now - call.startedMs) / 1000)} seconds · Outcome: {call.outcome}</p></div><button className={styles.secondaryButton} disabled={status === "scoring" || status === "saving"} onClick={() => { coach.reset(); setDraft(""); }}>Practice again</button></div>
          {(status === "scoring" || status === "saving") && <p role="status" className={styles.notice}>{status === "scoring" ? "Scoring your transcript with the shared rubric…" : "Saving your results to the team’s training view…"}</p>}
          {coach.error && <div role="alert" className={styles.alert}><p>{coach.error}</p>{call.transcript.some((turn) => turn.speaker === "rep") && <button onClick={coach.retry}>{result ? "Retry saving" : "Retry scoring"}</button>}</div>}
          {result && <>
            <p className={result.grading === "placeholder" ? styles.notice : styles.note}>{result.grading === "placeholder" ? "Placeholder grading: the scoring model was unavailable. These deterministic estimates are NOT AI-rated results." : "Model-graded with the shared sales-coaching rubric."}</p>
            <div className={styles.scores}>{(Object.keys(RUBRIC) as (keyof Scores)[]).map((key) => <article key={key}><p>{RUBRIC[key].label}</p><strong>{result.session.scores[key]}<small>{key === "closeRate" ? "%" : " / 100"}</small></strong><p>{RUBRIC[key].description}</p></article>)}</div>
            <div className={styles.summary}><h3>What to take into your next call</h3><p>{result.session.summary}</p></div>
            {status === "saved" && <div className={styles.saved} role="status"><strong>Results saved to the demo training store.</strong><Link href="/monitor">View team performance →</Link><p>In Monitor, select Training data and Refresh data. The shared in-memory store is temporary; a separate serverless instance or restart may not retain this session.</p></div>}
            {status !== "saved" && <p className={styles.note}>Your scores are displayed above, but the save has not been confirmed yet.</p>}
          </>}
        </section>}
        {call && <details className={styles.transcript} open={call.phase === "complete"}><summary>Call transcript <span>{call.transcript.length} turns</span></summary><p className={styles.note}>Text only; this app does not store microphone recordings. Highlights are local opening checks, not additional AI grades.</p><ol>{call.transcript.map((turn, index) => <li key={index} className={index === strongIntro ? styles.strongMoment : index === firstRep && call.pushedBack ? styles.weakMoment : undefined}><div><strong>{turn.speaker === "rep" ? call.scenario.repName : "Alex"}</strong><time>{Math.floor(turn.atSec / 60)}:{String(turn.atSec % 60).padStart(2, "0")}</time>{index === strongIntro && <span>Clear introduction</span>}{index === firstRep && call.pushedBack && index !== strongIntro && <span>Introduction needed a prompt</span>}</div><p>{turn.text}</p></li>)}</ol></details>}
      </main>
    </div>
  );
}

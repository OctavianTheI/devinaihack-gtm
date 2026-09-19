"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { DataSource, RepView, Scores } from "@/shared/types";
import {
  businessMetrics, deltaDescription, formatMetric, hasScores,
  metricValue, scoreDeltas, scoreMetrics, sortReps,
  type MetricKey, type SortKey,
} from "./metrics";
import styles from "./page.module.css";

interface RepsResponse {
  source: DataSource;
  reps: RepView[];
  teamAverage: Scores | null;
}

function Score({ value, isRate = false }: { value: number | null; isRate?: boolean }) {
  if (value === null) return <span className={styles.muted} aria-label="Not trained">—</span>;
  return (
    <span className={styles.score}>
      <span>{value}{isRate ? "%" : <small> / 100</small>}</span>
      <span className={styles.track} aria-hidden="true">
        <span style={{ width: `${value}%` }} />
      </span>
    </span>
  );
}

function RepDetail({ rep, average, onClose }: { rep: RepView; average: Scores | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const deltas = scoreDeltas(rep, average);
  const best = deltas[0];
  const worst = deltas[deltas.length - 1];

  useEffect(() => {
    const element = dialog.current;
    const previouslyFocused = document.activeElement;
    const overflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      element?.close();
      document.body.style.overflow = overflow;
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, []);

  return (
    <dialog ref={dialog} className={styles.drawer} aria-labelledby="rep-title" onCancel={onClose} onClick={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className={styles.drawerContent}>
        <header className={styles.drawerHeader}>
          <div>
            <p className={styles.eyebrow}>{rep.source} performance</p>
            <h2 id="rep-title">{rep.name}</h2>
            <p className={styles.muted}>{rep.hasTraining ? "Training results available" : "No training completed yet"}</p>
          </div>
          <button className={styles.iconButton} onClick={onClose} aria-label="Close rep details">×</button>
        </header>
        <div className={styles.businessStats}>
          {businessMetrics.map(({ key, label }) => (
            <div key={key}><span>{label}</span><strong>{formatMetric(key, rep[key])}</strong></div>
          ))}
        </div>
        <p className={styles.note}>Business stats are from live sales and do not change with the score source.</p>
        <section className={styles.detailSection}>
          <h3>Performance vs. team</h3>
          <p className={styles.note}>{rep.source === "training" ? "Compared with trained reps only. Close rate represents estimated close likelihood." : "Compared with all reps in the live cohort."}</p>
          {!hasScores(rep) ? (
            <div className={styles.empty}>Not trained yet. Complete a training session to see scores and comparisons here.</div>
          ) : (
            <div className={styles.comparisons}>
              {scoreMetrics.map(({ key, label }) => {
                const delta = average ? rep.scores[key] - average[key] : null;
                return (
                  <div className={styles.comparison} key={key}>
                    <div className={styles.comparisonHeading}><span>{label}</span><strong>{formatMetric(key, rep.scores[key])}{key !== "closeRate" && " / 100"}</strong></div>
                    <div className={styles.comparisonTrack} aria-hidden="true">
                      <span style={{ width: `${rep.scores[key]}%` }} />
                      {average && <i style={{ left: `${average[key]}%` }} />}
                    </div>
                    <div className={styles.comparisonFooter}>
                      <span>Team avg. {average ? formatMetric(key, average[key]) : "unavailable"}</span>
                      {delta !== null && <span className={delta > 0 ? styles.positive : delta < 0 ? styles.negative : styles.muted}>{deltaDescription(key, delta)}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
        <section className={styles.summaryGrid} aria-label="Coaching summary">
          <article className={styles.bestCard}>
            <p className={styles.eyebrow}>Doing best</p>
            <h3>{best?.label ?? "Awaiting scores"}</h3>
            <p>{best ? `${deltaDescription(best.key, best.delta)}. This is their strongest relative score.` : "A scored session and team average are needed for a comparison."}</p>
          </article>
          <article className={styles.worstCard}>
            <p className={styles.eyebrow}>Doing worst</p>
            <h3>{worst?.label ?? "Awaiting scores"}</h3>
            <p>{worst ? `${deltaDescription(worst.key, worst.delta)}. This is their lowest relative score${worst.delta >= 0 ? ", not a below-average result" : ""}.` : "No coaching comparison available yet."}</p>
          </article>
        </section>
        <section className={styles.detailSection}>
          <h3>Script divergences <span className={styles.count}>{rep.divergences.length}</span></h3>
          <p className={styles.note}>Combined live and training history, newest training entries first. The shared data does not separate divergences by source.</p>
          {rep.divergences.length === 0 ? <div className={styles.empty}>No script divergences recorded.</div> : (
            <div className={styles.divergences}>
              {rep.divergences.map((divergence, index) => (
                <article className={styles.divergence} key={`${divergence.scriptStep}-${index}`}>
                  <div className={styles.comparisonHeading}><h4>{divergence.scriptStep}</h4><span className={`${styles.badge} ${styles[divergence.verdict]}`}>{divergence.verdict}</span></div>
                  <p>{divergence.whatTheyDid}</p>
                  <div className={styles.reason}><strong>AI assessment</strong><p>{divergence.aiReason}</p></div>
                  {divergence.verdict === "good" && <p className={styles.adopt}>Consider this approach when refining the team script.</p>}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </dialog>
  );
}

function ScriptUpload() {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [accepted, setAccepted] = useState(false);
  return (
    <details className={styles.scriptUpload}>
      <summary>Upload a sales script <span>Optional · local preview only</span></summary>
      <form onSubmit={(event) => { event.preventDefault(); setAccepted(true); }}>
        <p className={styles.note}>Choose a file or paste your script. It stays in this page only; it is not uploaded, saved, or used for scoring.</p>
        <label htmlFor="script-file">Script file</label>
        <input id="script-file" type="file" accept=".txt,.md,.pdf,.doc,.docx" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setAccepted(false); }} />
        <label htmlFor="script-text">Or paste script text</label>
        <textarea id="script-text" rows={4} value={text} placeholder="Opening, discovery, pitch, objection handling, close…" onChange={(event) => { setText(event.target.value); setAccepted(false); }} />
        <div><button className={styles.primaryButton} disabled={!file && !text.trim()} type="submit">Accept script</button></div>
        {accepted && <p role="status" className={styles.positive}>Script accepted locally{file ? `: ${file.name}` : ""}. Scoring is unchanged.</p>}
      </form>
    </details>
  );
}

export default function MonitorPage() {
  const [source, setSource] = useState<DataSource>("live");
  const [data, setData] = useState<RepsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "closeRate", direction: "desc" });
  const [filterMetric, setFilterMetric] = useState<MetricKey>("closeRate");
  const [minimum, setMinimum] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/reps?source=${source}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Could not load the team. Please try again.");
        const result: RepsResponse = await response.json();
        if (!controller.signal.aborted) {
          setData(result);
          setError(null);
          setLoading(false);
        }
      } catch (reason) {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "Could not load the team. Please try again.");
          setLoading(false);
        }
      }
    }
    void load();
    return () => controller.abort();
  }, [source, revision]);

  function reload(nextSource = source) {
    setLoading(true);
    setError(null);
    setSelectedId(null);
    setSource(nextSource);
    setRevision((value) => value + 1);
  }

  function changeSort(key: SortKey) {
    setSort((current) => ({ key, direction: current.key === key && current.direction === "desc" ? "asc" : "desc" }));
  }

  const currentData = !loading && !error && data?.source === source ? data : null;
  const reps = currentData?.reps ?? [];
  const average = currentData?.teamAverage ?? null;
  const selected = reps.find((rep) => rep.id === selectedId);
  const trainedCount = reps.filter((rep) => rep.hasTraining).length;
  const filtered = sortReps(reps.filter((rep) => {
    const value = metricValue(rep, filterMetric);
    return rep.name.toLowerCase().includes(query.trim().toLowerCase()) &&
      (minimum === "" || (value !== null && value >= Number(minimum)));
  }), sort.key, sort.direction);
  const columns = [{ key: "name", label: "Sales rep" }, ...businessMetrics, ...scoreMetrics] as const;

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <Link href="/monitor" className={styles.brand}><span className={styles.brandMark} aria-hidden="true">S</span>Sales Coach</Link>
        <nav aria-label="Main navigation"><Link href="/monitor" aria-current="page">Monitor team</Link><Link href="/train">Train</Link></nav>
        <span className={styles.workspace}>Manager workspace</span>
      </header>
      <main className={styles.main}>
        <div className={styles.heading}>
          <div><p className={styles.eyebrow}>Team intelligence</p><h1>Great calls. Better coaching.</h1><p className={styles.subtitle}>See what works, spot the gaps, and help every rep improve.</p></div>
          <div className={styles.sourceToggle} role="group" aria-label="Score source">
            {(["live", "training"] as const).map((value) => <button key={value} aria-pressed={source === value} onClick={() => { if (value !== source) reload(value); }}>{value === "live" ? "Live data" : "Training data"}</button>)}
          </div>
        </div>
        <section className={styles.overview} aria-label="Team overview">
          <article><p>Team members</p><strong>{currentData ? reps.length : "—"}</strong><span>Across the sales team</span></article>
          <article><p>{source === "live" ? "Team close rate" : "Team close likelihood"}</p><strong>{average ? `${average.closeRate}%` : "—"}</strong><span>{source === "live" ? "Live cohort average" : "Trained reps only"}</span></article>
          <article><p>Objection handling</p><strong>{average?.objectionHandling ?? "—"}<small> / 100</small></strong><span>Team average score</span></article>
          <article><p>Training coverage</p><strong>{currentData ? trainedCount : "—"}<small> / {currentData ? reps.length : "—"}</small></strong><span>Reps with a training result</span></article>
        </section>
        <section className={styles.tableCard} aria-labelledby="team-heading" aria-busy={loading}>
          <div className={styles.tableHeading}><div><h2 id="team-heading">Your team <span className={styles.count}>{currentData ? reps.length : "—"}</span></h2><p>Select a rep to explore their performance and coaching insights.</p></div><button className={styles.secondaryButton} onClick={() => reload()} disabled={loading}>Refresh data</button></div>
          <div className={styles.filters}>
            <label className={styles.search}>Search reps<input type="search" placeholder="Search by name…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
            <label>Metric<select aria-label="Metric" value={filterMetric} onChange={(event) => setFilterMetric(event.target.value as MetricKey)}>{[...businessMetrics, ...scoreMetrics].map(({ key, label }) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className={styles.minimum}>Minimum<input type="number" min="0" value={minimum} placeholder="Any" onChange={(event) => setMinimum(event.target.value)} /></label>
            {(query || minimum) && <button className={styles.textButton} onClick={() => { setQuery(""); setMinimum(""); }}>Clear filters</button>}
          </div>
          <p className={styles.sourceNote}>{source === "live" ? "Live view uses seeded demo call data. Scores are out of 100; close rate is a percentage." : "Training view uses saved session scores. Untrained reps show a dash and are excluded from team averages. Close rate means estimated close likelihood."} Business stats remain the same in both views.</p>
          {loading ? <div className={styles.empty} role="status">Loading {source} performance…</div> : error ? <div className={styles.empty} role="alert"><p>{error}</p><button className={styles.secondaryButton} onClick={() => reload()}>Try again</button></div> : (
            <>
              {source === "training" && trainedCount === 0 && <p className={styles.empty} role="status">No training results yet. Reps will appear with scores after their first session.</p>}
              <div className={styles.tableScroll} role="region" aria-label="Sales rep performance table" tabIndex={0}>
                <table className={styles.table}>
                  <caption className={styles.srOnly}>{source === "live" ? "Live" : "Training"} rep performance. Select a column heading to sort, or a rep name to open details.</caption>
                  <thead><tr>{columns.map(({ key, label }) => <th key={key} scope="col" aria-sort={sort.key === key ? sort.direction === "asc" ? "ascending" : "descending" : "none"}><button onClick={() => changeSort(key)}>{label}<span aria-hidden="true">{sort.key === key ? sort.direction === "asc" ? " ↑" : " ↓" : " ↕"}</span></button></th>)}</tr></thead>
                  <tbody>
                    {filtered.map((rep) => <tr key={rep.id} onClick={() => setSelectedId(rep.id)}>
                      <th scope="row"><button className={styles.repButton} onClick={() => setSelectedId(rep.id)} aria-haspopup="dialog"><span className={styles.avatar} aria-hidden="true">{rep.name.split(" ").map((name) => name[0]).slice(0, 2).join("")}</span><span>{rep.name}<small>{rep.hasTraining ? "Trained" : "Not trained"}</small></span></button></th>
                      {businessMetrics.map(({ key }) => <td key={key}>{formatMetric(key, rep[key])}</td>)}
                      {scoreMetrics.map(({ key }) => <td key={key}><Score value={metricValue(rep, key)} isRate={key === "closeRate"} /></td>)}
                    </tr>)}
                  </tbody>
                </table>
                {filtered.length === 0 && <div className={styles.empty}>No reps match these filters.</div>}
              </div>
              <footer className={styles.tableFooter}><span>Showing {filtered.length} of {reps.length} reps</span><span>Sorted by {columns.find((column) => column.key === sort.key)?.label.toLowerCase()} · {sort.direction === "desc" ? "highest first" : "lowest first"}</span></footer>
            </>
          )}
        </section>
        <ScriptUpload />
        <p className={styles.bottomNote}>A little insight. A better next conversation.</p>
      </main>
      {selected && <RepDetail rep={selected} average={average} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

interface RecognitionResult { isFinal: boolean; 0: { transcript: string } }
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}
type RecognitionConstructor = new () => Recognition;

export function speechRecognitionAvailable(): boolean {
  return Boolean(recognitionConstructor());
}

function recognitionConstructor(): RecognitionConstructor | undefined {
  const browser = window as typeof window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
}

export function listenToRep(options: {
  pitch: boolean;
  onTurn: (text: string) => void;
  onInterim: (text: string) => void;
  onError: (message: string) => void;
}): RepListener {
  const Constructor = recognitionConstructor();
  if (!Constructor) throw new Error("Speech recognition is not supported in this browser.");
  const recognition = new Constructor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";
  let alive = true;
  let finalText = "";
  let interim = "";
  let submitTimer: ReturnType<typeof setTimeout> | undefined;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  const flush = (includeInterim = false) => {
    clearTimeout(submitTimer);
    const text = `${finalText} ${includeInterim ? interim : ""}`.trim();
    finalText = "";
    if (includeInterim) interim = "";
    if (alive && text) options.onTurn(text);
  };
  const start = () => {
    if (!alive) return;
    try { recognition.start(); }
    catch { options.onError("The microphone could not start. Continue with typed input."); }
  };
  recognition.onresult = (event) => {
    if (!alive) return;
    interim = "";
    for (let index = event.resultIndex; index < event.results.length; index++) {
      const result = event.results[index];
      if (result.isFinal) finalText += ` ${result[0].transcript}`;
      else interim += ` ${result[0].transcript}`;
    }
    options.onInterim(`${finalText} ${interim}`.trim());
    clearTimeout(submitTimer);
    if (options.pitch) flush();
    else if (finalText.trim()) submitTimer = setTimeout(() => flush(), 1400);
  };
  recognition.onerror = ({ error }) => {
    if (alive && error !== "no-speech" && error !== "aborted") {
      alive = false;
      clearTimeout(submitTimer);
      clearTimeout(restartTimer);
      recognition.abort();
      options.onError(error === "not-allowed" || error === "service-not-allowed"
        ? "Microphone or speech-service permission was denied. Continue with typed input."
        : "Speech recognition is unavailable. Continue with typed input or try Chrome/Edge on HTTPS.");
    }
  };
  recognition.onend = () => {
    if (!alive) return;
    flush();
    restartTimer = setTimeout(start, 400);
  };
  start();
  return {
    flush: () => flush(true),
    stop: () => {
      alive = false;
      clearTimeout(submitTimer);
      clearTimeout(restartTimer);
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
    },
  };
}

export interface RepListener { flush: () => void; stop: () => void }

const SPEECH_RMS = 0.015;
const SILENCE_AFTER_SPEECH_MS = 1200;
const MAX_UTTERANCE_MS = 45_000;

export function recordingSupported(): boolean {
  return typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && typeof AudioContext !== "undefined";
}

/** Records the rep with MediaRecorder, splits on pauses using mic volume, and
 * transcribes each utterance server-side. Works in browsers whose
 * SpeechRecognition object exists but has no speech backend (Opera, Brave, Arc). */
export function recordRep(options: {
  onTurn: (text: string) => void;
  onInterim: (text: string) => void;
  onError: (message: string) => void;
}): RepListener {
  let alive = true;
  let stream: MediaStream | undefined;
  let context: AudioContext | undefined;
  let recorder: MediaRecorder | undefined;
  let chunks: Blob[] = [];
  let speaking = false;
  let lastSpeech = 0;
  let utteranceStart = 0;
  let meter: ReturnType<typeof setInterval> | undefined;
  let pendingUploads = 0;
  const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));

  const fail = (message: string) => {
    if (!alive) return;
    alive = false;
    cleanup();
    options.onError(message);
  };
  const cleanup = () => {
    clearInterval(meter);
    if (recorder && recorder.state !== "inactive") { recorder.ondataavailable = null; recorder.onstop = null; recorder.stop(); }
    stream?.getTracks().forEach((track) => track.stop());
    void context?.close().catch(() => {});
  };
  const upload = async (blob: Blob) => {
    if (blob.size < 1000) return;
    pendingUploads++;
    options.onInterim("Transcribing…");
    try {
      const response = await fetch("/api/training/transcribe", {
        method: "POST", headers: { "Content-Type": blob.type || "audio/webm" }, body: blob, signal: AbortSignal.timeout(25_000),
      });
      if (response.status === 503) throw new Error("unavailable");
      if (!response.ok) throw new Error("failed");
      const { text } = (await response.json()) as { text: string };
      if (alive && text) options.onTurn(text);
      else if (alive) options.onInterim("No speech detected. Try again a little louder.");
    } catch (error) {
      if (error instanceof Error && error.message === "unavailable") fail("Server transcription is unavailable. Continue with typed input.");
      else if (alive) options.onInterim("That clip could not be transcribed. Please say it again.");
    } finally {
      pendingUploads--;
      if (alive && pendingUploads === 0) options.onInterim("");
    }
  };
  const startRecorder = () => {
    if (!alive || !stream) return;
    chunks = [];
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder?.mimeType || mimeType || "audio/webm" });
      const hadSpeech = speaking || Date.now() - lastSpeech < SILENCE_AFTER_SPEECH_MS * 2;
      speaking = false;
      if (hadSpeech) void upload(blob);
      if (alive) startRecorder();
    };
    recorder.start();
    utteranceStart = Date.now();
  };
  const endUtterance = () => {
    if (recorder?.state === "recording") recorder.stop();
  };

  void (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (!alive) { stream.getTracks().forEach((track) => track.stop()); return; }
      context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      startRecorder();
      meter = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        const rms = Math.sqrt(sum / samples.length);
        const now = Date.now();
        if (rms > SPEECH_RMS) {
          if (!speaking) options.onInterim("Listening… keep going, I'll send it when you pause.");
          speaking = true;
          lastSpeech = now;
        } else if (speaking && now - lastSpeech > SILENCE_AFTER_SPEECH_MS) {
          endUtterance();
        }
        if (recorder?.state === "recording" && now - utteranceStart > MAX_UTTERANCE_MS) endUtterance();
      }, 100);
    } catch {
      fail("Microphone access was denied or unavailable. Continue with typed input.");
    }
  })();

  return {
    flush: () => { if (speaking || Date.now() - lastSpeech < SILENCE_AFTER_SPEECH_MS) endUtterance(); },
    stop: () => { alive = false; cleanup(); },
  };
}

function browserSpeech(text: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
    if (!("speechSynthesis" in window)) return reject(new Error("Browser voice is unavailable"));
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 1;
    const finish = (error?: Error) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      utterance.onend = null;
      utterance.onerror = null;
      if (error) { window.speechSynthesis.cancel(); reject(error); }
      else resolve();
    };
    const abort = () => finish(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(() => finish(new Error("Voice playback timed out")), 30_000);
    signal.addEventListener("abort", abort, { once: true });
    utterance.onend = () => finish();
    utterance.onerror = () => finish(new Error("Browser voice could not play"));
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  });
}

function playAudio(blob: Blob, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    const finish = (error?: Error) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute("src");
      URL.revokeObjectURL(url);
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(() => finish(new Error("Voice playback timed out")), 30_000);
    signal.addEventListener("abort", abort, { once: true });
    audio.onended = () => finish();
    audio.onerror = () => finish(new Error("Audio could not play"));
    void audio.play().catch(() => finish(new Error("Audio playback was blocked")));
  });
}

export async function speakProspect(text: string, options: {
  signal: AbortSignal;
  provider: "elevenlabs" | "browser";
  onFallback: (message: string) => void;
}) {
  if (options.provider === "elevenlabs") {
    try {
      const response = await fetch("/api/training/speech", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }), signal: AbortSignal.any([options.signal, AbortSignal.timeout(10_000)]),
      });
      if (!response.ok) throw new Error("ElevenLabs unavailable");
      await playAudio(await response.blob(), options.signal);
      return;
    } catch {
      if (options.signal.aborted) throw new DOMException("Aborted", "AbortError");
      options.onFallback("ElevenLabs could not play. Using browser voice for the rest of this session.");
    }
  }
  await browserSpeech(text, options.signal);
}

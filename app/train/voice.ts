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
}) {
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

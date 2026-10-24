import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Headphones,
  Mic,
  MicOff,
  Pause,
  Play,
  SkipForward,
  Volume2,
} from "lucide-react";
import { api, type Connection } from "./server-client";
import type {
  DjTrack as Track,
  DjMessage as Message,
  DjResponse,
  DjStatus,
} from "@playlist-recall/core/dj";
interface Recognition {
  lang: string;
  interimResults: boolean;
  onresult:
    | ((event: {
        results: {
          [index: number]: { [index: number]: { transcript: string } };
        };
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type VoiceWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};
export function DjApp({
  connection,
  configRevision = 0,
}: {
  connection: Connection;
  configRevision?: number;
}) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [queue, setQueue] = useState<Track[]>([]);
  const [position, setPosition] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [listening, setListening] = useState(false);
  const [serverVoice, setServerVoice] = useState(false);
  const spokenAudio = useRef<HTMLAudioElement | null>(null);
  const voiceRequest = useRef<AbortController | null>(null);
  const [spoken, setSpoken] = useState(false);
  const [continuous, setContinuous] = useState(true);
  const [ready, setReady] = useState(false);
  const mounted = useRef(true);
  const iframe = useRef<HTMLIFrameElement>(null);
  const recognition = useRef<Recognition | null>(null);
  const request = useRef<AbortController | null>(null);
  const sending = useRef(false);
  const advance = useRef<() => void>(() => {});
  const latest = useRef({ messages, queue, position, configured, continuous });
  latest.current = { messages, queue, position, configured, continuous };
  const current = queue[position];
  const origin = connection.url;
  const voiceWindow = window as VoiceWindow;
  const supportsMic = Boolean(
    voiceWindow.SpeechRecognition ?? voiceWindow.webkitSpeechRecognition,
  );
  const supportsVoice = "speechSynthesis" in window;
  const command = (command: string, extra: Record<string, unknown> = {}) =>
    iframe.current?.contentWindow?.postMessage(
      { source: "recall-dj", command, ...extra },
      origin,
    );
  useEffect(() => {
    const controller = new AbortController();
    void api<DjStatus>(connection, "dj/status", undefined, controller.signal)
      .then((value) => {
        setConfigured(value.configured);
        setServerVoice(value.voice);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("Le DJ ne peut pas joindre le serveur pour le moment.");
      });
    return () => controller.abort();
  }, [connection, configRevision]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== origin ||
        event.source !== iframe.current?.contentWindow ||
        event.data?.source !== "recall-dj-player"
      )
        return;
      if (event.data.event === "ready") setReady(true);
      if (event.data.event === "state") {
        setPlaying(event.data.state === 1);
        if (event.data.state === 0) advance.current();
      }
      if (event.data.event === "blocked")
        setError("Clique sur le lecteur pour démarrer l’écoute.");
      if (event.data.event === "error") {
        setPlaying(false);
        const session = latest.current;
        if (
          [100, 101, 150].includes(event.data.code) &&
          session.continuous &&
          session.position + 1 < session.queue.length
        ) {
          setError("Ce titre n’est pas disponible ici ; je passe au suivant.");
          setPosition(session.position + 1);
        } else {
          setError(
            "YouTube ne permet pas la lecture de ce titre ici. Passe au suivant ou ouvre-le sur YouTube.",
          );
        }
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [origin]);
  useEffect(() => {
    if (ready && current) command("cue", { id: current.id, autoplay: true });
  }, [ready, current?.id]);
  useEffect(
    () => () => {
      mounted.current = false;
      request.current?.abort();
      voiceRequest.current?.abort();
      spokenAudio.current?.pause();
      recognition.current?.stop();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    },
    [],
  );
  async function speak(text: string) {
    if (!spoken) return;
    voiceRequest.current?.abort();
    spokenAudio.current?.pause();
    if (serverVoice) {
      const controller = new AbortController();
      voiceRequest.current = controller;
      try {
        const value = await api<{ audio: string; mimeType: string }>(
          connection,
          "dj/speech",
          { text: text.slice(0, 600) },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        const audio = new Audio(`data:${value.mimeType};base64,${value.audio}`);
        spokenAudio.current = audio;
        audio.onplay = () => command("duck");
        audio.onended = audio.onerror = () => command("restore");
        await audio.play();
      } catch {
        if (!controller.signal.aborted) {
          command("restore");
          setError(
            "La voix n’a pas pu démarrer. La réponse du DJ reste dans le chat.",
          );
        }
      }
      return;
    }
    if (!supportsVoice) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "fr-FR";
    const french = window.speechSynthesis
      .getVoices()
      .filter((voice) => voice.lang.startsWith("fr"));
    utterance.voice =
      french.find((voice) => voice.localService) ?? french[0] ?? null;
    utterance.rate = 1;
    utterance.onstart = () => command("duck");
    utterance.onend = utterance.onerror = () => command("restore");
    window.speechSynthesis.speak(utterance);
  }
  async function send(text: string, automatic = false) {
    text = text.trim();
    if (!text || sending.current || !latest.current.configured) return;
    sending.current = true;
    setBusy(true);
    setError("");
    const before = latest.current;
    if (!automatic) {
      setPrompt("");
      setMessages((m) =>
        [...m, { role: "user" as const, content: text }].slice(-12),
      );
    }
    const controller = new AbortController();
    request.current = controller;
    try {
      const next = await api<DjResponse>(
        connection,
        "dj/chat",
        {
          message: text,
          history: before.messages.slice(-12),
          excludeIds: before.queue.map((track) => track.id).slice(-100),
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setMessages((m) =>
        [...m, { role: "assistant" as const, content: next.reply }].slice(-12),
      );
      if (next.tracks.length) {
        if (next.action === "replace" || automatic) {
          setQueue(next.tracks);
          setPosition(0);
        } else if (next.action === "append") {
          setQueue((previous) =>
            [...previous.slice(before.position), ...next.tracks].slice(0, 40),
          );
          setPosition(0);
        }
      }
      void speak(next.reply);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Le DJ ne répond pas.");
    } finally {
      sending.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  advance.current = () => {
    const value = latest.current;
    setError("");
    if (value.position + 1 < value.queue.length)
      setPosition(value.position + 1);
    else if (value.continuous && value.queue.length) {
      void send(
        "Continue cette session avec quelques autres titres de ma bibliothèque dans le même esprit. Fais une nouvelle recherche et évite les titres déjà proposés.",
        true,
      );
    }
  };
  async function microphone() {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const Constructor =
      voiceWindow.SpeechRecognition ?? voiceWindow.webkitSpeechRecognition;
    if (!Constructor) return;
    voiceRequest.current?.abort();
    spokenAudio.current?.pause();
    command("pause");
    if (supportsVoice) window.speechSynthesis.cancel();
    const mic = new Constructor();
    recognition.current = mic;
    mic.lang = "fr-FR";
    mic.interimResults = false;
    mic.onresult = (event) => {
      const text = event.results[0]?.[0]?.transcript ?? "";
      if (text) void send(text);
    };
    mic.onerror = (event) =>
      setError(
        event.error === "not-allowed"
          ? "Le micro n’est pas autorisé. Tu peux toujours écrire au DJ."
          : "Je n’ai pas pu entendre. Réessaie ou écris ton envie.",
      );
    mic.onend = () => setListening(false);
    try {
      // Request microphone permission from the visible DJ tab, then immediately
      // release this stream: SpeechRecognition manages its own capture session.
      const permission = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      permission.getTracks().forEach((track) => track.stop());
      if (!mounted.current) return;
      mic.start();
      setListening(true);
    } catch {
      setError(
        "Le micro ne peut pas démarrer ici. Utilise le chat ou ouvre la bibliothèque dans un onglet.",
      );
    }
  }
  return (
    <main className="dj-app">
      <header className="dj-header">
        <span className="dj-eyebrow">
          <Headphones size={16} /> RECALL / MODE DJ
        </span>
        <span className="dj-connected">Ta bibliothèque, ton ambiance</span>
      </header>
      <div className="dj-layout">
        <section className="dj-stage" aria-label="Lecture musicale">
          <div className="dj-stage-heading">
            <span className="dj-eyebrow">À TON RYTHME</span>
            <h1>
              Un mood.
              <br />
              La bonne musique.
            </h1>
            <p>Parle-moi de ta soirée. On trouve la suite ensemble.</p>
          </div>
          <div className="dj-player-shell">
            <iframe
              ref={iframe}
              src={`${connection.url}/dj/player`}
              title="Lecteur YouTube du DJ"
              allow="autoplay; encrypted-media; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              onLoad={() => command("hello")}
            />
          </div>
          <div className="dj-now">
            <span className="dj-eyebrow">
              {current ? "À L’ÉCOUTE" : "PRÊT QUAND TU L’ES"}
            </span>
            <h2>{current?.title ?? "Quelle est ton envie ?"}</h2>
            <p>
              {current?.channel ?? "Une ambiance, un artiste, une sensation…"}
            </p>
          </div>
          <div className="dj-controls">
            <button
              className="dj-round"
              aria-label={playing ? "Mettre en pause" : "Lire la musique"}
              disabled={!current || !ready}
              onClick={() => command(playing ? "pause" : "play")}
            >
              {playing ? <Pause /> : <Play />}
            </button>
            <button
              className="dj-round"
              aria-label="Morceau suivant"
              disabled={!current || busy}
              onClick={() => advance.current()}
            >
              <SkipForward />
            </button>
            {current && (
              <a
                className="dj-youtube"
                href={current.url}
                target="_blank"
                rel="noreferrer"
              >
                Ouvrir sur YouTube ↗
              </a>
            )}
          </div>
          <label className="dj-toggle">
            <input
              type="checkbox"
              checked={continuous}
              onChange={(e) => setContinuous(e.target.checked)}
            />{" "}
            Continuer la musique automatiquement
          </label>
        </section>
        <section
          className="dj-conversation"
          aria-label="Conversation avec le DJ"
        >
          <div className="dj-chat-heading">
            <h2>Ton DJ personnel</h2>
            <label className="dj-voice-toggle">
              <Volume2 size={16} />
              <input
                type="checkbox"
                checked={spoken}
                disabled={!supportsVoice && !serverVoice}
                onChange={(e) => {
                  setSpoken(e.target.checked);
                  if (!e.target.checked) {
                    voiceRequest.current?.abort();
                    spokenAudio.current?.pause();
                    if (supportsVoice) window.speechSynthesis.cancel();
                    command("restore");
                  }
                }}
              />{" "}
              Me répondre à voix haute
            </label>
          </div>
          {configured === false && (
            <p className="notice" role="status">
              L’interface est prête. Le DJ attend encore le branchement de son
              IA côté serveur.
            </p>
          )}
          <div
            className="dj-chat"
            role="log"
            aria-label="Messages du DJ"
            aria-live="polite"
          >
            {!messages.length && (
              <div className="dj-welcome">
                <div className="dj-disc" aria-hidden="true">
                  r
                </div>
                <h3>Alors, comment tu te sens ?</h3>
                <p>
                  « Un peu mélancolique, mais j’ai envie de bouger. »<br />«
                  Plus doux. » « Surprends-moi. »
                </p>
              </div>
            )}
            {messages.map((message, index) => (
              <div key={index} className={`dj-message ${message.role}`}>
                <span>{message.role === "user" ? "TOI" : "TON DJ"}</span>
                <p>{message.content}</p>
              </div>
            ))}
            {busy && (
              <p className="dj-thinking" role="status">
                Je fouille dans tes morceaux…
              </p>
            )}
          </div>
          <div className="dj-moods">
            {[
              "Une fin de soirée douce",
              "De l’énergie pour danser",
              "Du calme pour me concentrer",
            ].map((mood) => (
              <button
                key={mood}
                disabled={busy || !configured}
                onClick={() => void send(mood)}
              >
                {mood}
              </button>
            ))}
          </div>
          <form
            className="dj-input"
            onSubmit={(e) => {
              e.preventDefault();
              void send(prompt);
            }}
          >
            <label className="sr-only" htmlFor="dj-prompt">
              Ton envie musicale
            </label>
            <textarea
              id="dj-prompt"
              rows={2}
              placeholder="Dis-moi ton mood, ou change l’ambiance…"
              maxLength={1500}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(prompt);
                }
              }}
            />
            <div>
              <button
                type="button"
                className={`dj-round ${listening ? "listening" : ""}`}
                aria-label={listening ? "Arrêter le micro" : "Parler au DJ"}
                aria-pressed={listening}
                disabled={!supportsMic || !configured || busy}
                onClick={() => void microphone()}
              >
                {listening ? <MicOff size={20} /> : <Mic size={20} />}
              </button>
              <button
                className="dj-send"
                aria-label="Envoyer au DJ"
                disabled={!prompt.trim() || busy || !configured}
              >
                <ArrowUp size={21} />
              </button>
            </div>
          </form>
          <p className="dj-privacy">
            Le micro s’active à ton clic. Le chat et la voix du DJ utilisent
            Gemini ; la dictée utilise le service vocal de Chrome.
          </p>
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          {!!queue.length && (
            <section className="dj-queue" aria-label="File de lecture">
              <h3>La suite de ta session</h3>
              {queue.slice(position).map((track, index) => (
                <button
                  key={`${track.id}-${index}`}
                  className={index === 0 ? "current" : ""}
                  onClick={() => {
                    setPosition(position + index);
                    setError("");
                  }}
                >
                  <span>
                    {index === 0 ? "●" : String(index + 1).padStart(2, "0")}
                  </span>
                  <span>
                    <strong>{track.title}</strong>
                    <small>{track.channel}</small>
                  </span>
                </button>
              ))}
            </section>
          )}
        </section>
      </div>
    </main>
  );
}

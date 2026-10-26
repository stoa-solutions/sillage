import { useEffect, useRef, useState } from "react";
import {
  Search,
  RefreshCw,
  Plus,
  Download,
  Loader2,
  Image,
  Library,
  Maximize2,
} from "lucide-react";
import { ProductBrand } from "./product-brand";
import { VideoCard } from "./App";
import type { SearchResult } from "./types";
import { api, downloadJson, type Connection } from "./server-client";
import { LibraryStore } from "./db";
import { exportLibrary } from "./import";
interface Playlist {
  id: string;
  title: string;
  entries: number;
  last_sync_at: string | null;
  status: string;
  error: string | null;
}
interface Status {
  counts: {
    videos: number;
    descriptions: number;
    text_indexed: number;
    images: number;
  };
  jobs: { kind: string; status: string; count: number }[];
  syncEnabled: boolean;
  youtubeConfigured: boolean;
  visionEnabled: boolean;
}
interface Response {
  results: (SearchResult & { reason: string })[];
  total: number;
  degraded: string | null;
}
export function ConnectedApp({ connection }: { connection: Connection }) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [query, setQuery] = useState("");
  const [playlistId, setPlaylistId] = useState("");
  const [mode, setMode] = useState<"text" | "image">("text");
  const [duration, setDuration] = useState("all");
  const [channel, setChannel] = useState("");
  const [publishedAfter, setPublishedAfter] = useState("");
  const [sort, setSort] = useState("relevance");
  const [offset, setOffset] = useState(0);
  const [response, setResponse] = useState<Response>({
    results: [],
    total: 0,
    degraded: null,
  });
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [revision, setRevision] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const lastSearch = useRef("");
  const fingerprint = useRef("");
  const refreshFailed = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const [next, nextStatus] = await Promise.all([
          api<{ playlists: Playlist[] }>(
            connection,
            "playlists",
            undefined,
            controller.signal,
          ),
          api<Status>(connection, "status", undefined, controller.signal),
        ]);
        setPlaylists(next.playlists);
        setStatus(nextStatus);
        if (refreshFailed.current) {
          refreshFailed.current = false;
          setError("");
          setRevision((n) => n + 1);
        }
        const signature = JSON.stringify([
          nextStatus.counts,
          next.playlists.map((p) => p.last_sync_at),
        ]);
        if (fingerprint.current && fingerprint.current !== signature)
          setRevision((n) => n + 1);
        fingerprint.current = signature;
      } catch (e) {
        if (!controller.signal.aborted) {
          refreshFailed.current = true;
          setError(e instanceof Error ? e.message : "Serveur indisponible.");
        }
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [connection]);
  useEffect(() => {
    const controller = new AbortController();
    const key = JSON.stringify({
      query,
      playlistId,
      mode,
      duration,
      channel,
      publishedAfter,
      sort,
      revision,
    });
    const changed = lastSearch.current !== key;
    lastSearch.current = key;
    if (changed && offset !== 0) {
      setOffset(0);
      return () => controller.abort();
    }
    setLoading(true);
    setError("");
    const timer = setTimeout(
      () =>
        void api<Response>(
          connection,
          "search",
          {
            query,
            playlistId: playlistId || undefined,
            mode,
            sort,
            offset,
            limit: 48,
            minDuration:
              duration === "long"
                ? 3600
                : duration === "medium"
                  ? 600
                  : undefined,
            maxDuration:
              duration === "short"
                ? 600
                : duration === "medium"
                  ? 3600
                  : undefined,
            channel: channel || undefined,
            publishedAfter: publishedAfter || undefined,
          },
          controller.signal,
        )
          .then((next) => {
            if (controller.signal.aborted) return;
            setResponse((previous) => ({
              ...next,
              results: offset
                ? [...previous.results, ...next.results]
                : next.results,
            }));
          })
          .catch((e) => {
            if (!controller.signal.aborted)
              setError(
                e instanceof Error ? e.message : "Recherche indisponible.",
              );
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          }),
      250,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    connection,
    query,
    playlistId,
    mode,
    duration,
    channel,
    publishedAfter,
    sort,
    offset,
    revision,
  ]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  async function run(action: () => Promise<unknown>, message: string) {
    setError("");
    setNotice("");
    setAdding(true);
    try {
      await action();
      setNotice(message);
      setRevision((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opération impossible.");
    } finally {
      setAdding(false);
    }
  }
  const pending =
    status?.jobs
      .filter((j) => j.status !== "failed")
      .reduce((n, j) => n + j.count, 0) ?? 0;
  const failed =
    status?.jobs
      .filter((j) => j.status === "failed")
      .reduce((n, j) => n + j.count, 0) ?? 0;
  return (
    <div className="app">
      <aside className="sidebar">
        <ProductBrand mode="serveur" />
        <nav>
          <button
            className={`nav-item ${!playlistId ? "active" : ""}`}
            onClick={() => setPlaylistId("")}
          >
            <Library size={17} /> Bibliothèque{" "}
            <small>{status?.counts.videos ?? 0}</small>
          </button>
          <p className="nav-label">PLAYLISTS</p>
          {playlists.map((p) => (
            <button
              key={p.id}
              className={`nav-item playlist-nav ${playlistId === p.id ? "active" : ""}`}
              onClick={() => setPlaylistId(p.id)}
              title={p.title}
            >
              <span>{p.title}</span>
              <small>{p.entries}</small>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <p className="local-note">Votre bibliothèque sur votre VPS</p>
          <p className="muted">
            {status?.syncEnabled
              ? "Actualisation automatique toutes les 6 heures."
              : "Actualisation automatique en attente d’activation."}
          </p>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <ProductBrand compact />
          <div className="breadcrumb">
            Votre espace / Bibliothèque synchronisée
          </div>
          <div className="toolbar">
            <button
              className="btn"
              disabled={adding}
              onClick={() =>
                void run(
                  async () =>
                    downloadJson(
                      await api(connection, "export"),
                      "playlist-recall-serveur.json",
                    ),
                  "Sauvegarde exportée.",
                )
              }
            >
              <Download size={15} /> Exporter
            </button>
            <button
              className="btn"
              disabled={adding || !playlists.length}
              onClick={() =>
                void run(async () => {
                  for (const p of playlists.filter(
                    (p) => !playlistId || p.id === playlistId,
                  ))
                    await api(
                      connection,
                      `playlists/${encodeURIComponent(p.id)}/sync`,
                      {},
                    );
                }, "Actualisation demandée. La progression apparaît ci-dessous.")
              }
            >
              <RefreshCw size={15} /> Actualiser
            </button>
            <button
              className="btn icon"
              aria-label="Ouvrir la bibliothèque dans un onglet"
              title="Ouvrir la bibliothèque dans un onglet"
              onClick={() =>
                window.open(
                  new URL("library.html", window.location.href).href,
                  "_blank",
                  "noopener",
                )
              }
            >
              <Maximize2 size={15} />
            </button>
          </div>
        </header>
        <section className="intro">
          <p className="eyebrow">VOTRE MÉMOIRE YOUTUBE</p>
          <h1>Retrouver une vidéo.</h1>
          <p>
            Un titre, une ambiance ou une miniature. Vos playlists restent à
            jour.
          </p>
        </section>
        <form
          className="add-playlist"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api(connection, "playlists", { url });
              setUrl("");
            }, "Playlist ajoutée. La collecte est en attente.");
          }}
        >
          <label className="sr-only" htmlFor="playlist-url">
            Lien de playlist YouTube
          </label>
          <input
            id="playlist-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Coller le lien d’une playlist YouTube"
            required
            maxLength={500}
          />
          <button className="btn" disabled={adding || !url.trim()}>
            <Plus size={15} /> Ajouter
          </button>
        </form>
        {status && !status.youtubeConfigured && (
          <div className="notice info">
            La clé YouTube doit être configurée sur le serveur pour actualiser
            les playlists.
          </div>
        )}
        <div className="search-box">
          <Search size={21} />
          <label className="sr-only" htmlFor="server-search">
            Rechercher dans les playlists
          </label>
          <input
            id="server-search"
            ref={searchRef}
            value={query}
            maxLength={1000}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              mode === "image"
                ? "Une miniature bleue avec un saxophone…"
                : "Jazz romantique de plus d’une heure…"
            }
          />
          {loading && <Loader2 size={18} className="spinner" />}
        </div>
        <div className="filterbar">
          <div className="filter-group">
            <label className="select-wrap">
              Rechercher dans
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as "text" | "image")}
              >
                <option value="text">Textes et souvenirs</option>
                <option value="image" disabled={!status?.visionEnabled}>
                  Miniatures
                </option>
              </select>
            </label>
            <label className="select-wrap">
              Playlist
              <select
                value={playlistId}
                onChange={(e) => setPlaylistId(e.target.value)}
              >
                <option value="">Toutes</option>
                {playlists.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="select-wrap">
              Durée
              <select
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              >
                <option value="all">Toutes</option>
                <option value="short">Moins de 10 min</option>
                <option value="medium">Entre 10 min et 1 h</option>
                <option value="long">Plus d’une heure</option>
              </select>
            </label>
          </div>
        </div>
        <details className="advanced-filters">
          <summary>Chaîne et date de publication</summary>
          <div className="filter-group">
            <label>
              Chaîne
              <input
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                maxLength={300}
              />
            </label>
            <label>
              Publiée depuis
              <input
                type="date"
                value={publishedAfter}
                onChange={(e) => setPublishedAfter(e.target.value)}
              />
            </label>
          </div>
        </details>
        {error && (
          <div role="alert" className="notice error">
            {error} Vous pouvez revenir à votre bibliothèque locale avec le
            bouton en haut.
          </div>
        )}
        {notice && (
          <div role="status" className="notice info">
            {notice}
          </div>
        )}
        {response.degraded && (
          <div role="status" className="notice info">
            {response.degraded}
          </div>
        )}
        {status && (
          <div className="server-status">
            <span>{status.counts.videos.toLocaleString("fr-FR")} vidéos</span>
            <span>
              {status.counts.descriptions.toLocaleString("fr-FR")} descriptions
            </span>
            <span>
              {status.counts.text_indexed.toLocaleString("fr-FR")} indexées par
              texte
            </span>
            <span>
              <Image size={12} /> {status.counts.images.toLocaleString("fr-FR")}{" "}
              miniatures indexées
            </span>
            {pending > 0 && (
              <span>{pending} traitements en cours ou en attente</span>
            )}
            {failed > 0 && (
              <button
                className="btn"
                disabled={adding}
                onClick={() =>
                  void run(
                    () => api(connection, "jobs/retry", {}),
                    "Nouvelle tentative demandée.",
                  )
                }
              >
                {failed} erreurs · Réessayer
              </button>
            )}
          </div>
        )}
        <details className="sync-details">
          <summary>État des playlists</summary>
          {playlists.map((p) => (
            <p key={p.id}>
              <strong>{p.title}</strong> ·{" "}
              {p.last_sync_at
                ? `Mise à jour ${new Date(p.last_sync_at).toLocaleString("fr-FR")}`
                : "Première synchronisation en attente"}
              {p.status === "syncing" ? " · Collecte en cours" : ""}
              {p.error ? ` · ${p.error}` : ""}
            </p>
          ))}
          <button
            className="btn"
            disabled={adding}
            onClick={() =>
              void run(async () => {
                const data = await new LibraryStore().read();
                if (!data.playlists.length)
                  throw new Error("La bibliothèque locale est vide.");
                downloadJson(
                  exportLibrary(data),
                  "playlist-recall-avant-migration.json",
                );
                await api(connection, "import", exportLibrary(data));
              }, "Bibliothèque locale copiée sur le serveur. L’original est conservé.")
            }
          >
            Copier ma bibliothèque locale vers le serveur
          </button>
        </details>
        <div className="results-heading">
          <p>
            <strong>
              {loading ? "Recherche…" : `${response.total} résultats`}
            </strong>
          </p>
          <label className="select-wrap">
            Trier par
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="relevance">Pertinence</option>
              <option value="position">Ordre de playlist</option>
              <option value="duration">Durée décroissante</option>
            </select>
          </label>
        </div>
        <div className="video-grid">
          {response.results.map((result) => (
            <div key={result.video.id}>
              <VideoCard
                result={result}
                showSemantic={mode === "text" && Boolean(query)}
              />
              {result.reason && (
                <p className="server-reason">{result.reason}</p>
              )}
            </div>
          ))}
        </div>
        {!loading && !response.results.length && !error && (
          <div className="empty">
            <Search size={28} />
            <p>
              {playlists.length
                ? "Aucun résultat. Essayez une autre description ou élargissez les filtres."
                : "Ajoutez une playlist avec son lien pour commencer."}
            </p>
          </div>
        )}
        {response.results.length < response.total && (
          <div className="load-more">
            <button
              className="btn"
              disabled={loading}
              onClick={() => setOffset(response.results.length)}
            >
              Afficher plus de vidéos
            </button>
          </div>
        )}
        <footer className="footer">
          Recherche sur votre VPS. Les rapprochements sémantiques et visuels
          sont des suggestions. La bibliothèque ne contient pas votre historique
          d’écoute.
        </footer>
      </main>
    </div>
  );
}

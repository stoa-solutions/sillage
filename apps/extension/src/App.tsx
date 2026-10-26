import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Clock3,
  Disc3,
  Download,
  FolderHeart,
  Library,
  Loader2,
  Maximize2,
  Pause,
  Play,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { ProductBrand } from "./product-brand";
import { LibraryStore } from "./db";
import { buildDocument, exportLibrary, parseImport } from "./import";
import { formatDuration, parseQuery, searchLibrary } from "./search";
import { EmbeddingClient } from "./embeddings";
import { MODEL_KEY } from "./model";
import type {
  LibraryImport,
  SearchFilters,
  SearchResult,
  VectorRecord,
} from "./types";

const number = (n: number) => n.toLocaleString("fr-FR");
const EMPTY: LibraryImport = { videos: [], playlists: [], memberships: [] };
type Notice = { kind: "error" | "info"; message: string };

export function App() {
  const store = useMemo(() => new LibraryStore(), []);
  const [library, setLibrary] = useState<LibraryImport>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [vectors, setVectors] = useState(new Map<string, number[]>());
  const [query, setQuery] = useState("");
  const [queryEmbedding, setQueryEmbedding] = useState<{
    text: string;
    vector: number[];
  } | null>(null);
  const [searching, setSearching] = useState(false);
  const [playlistId, setPlaylistId] = useState("");
  const [duration, setDuration] = useState("all");
  const [minMinutes, setMinMinutes] = useState("");
  const [maxMinutes, setMaxMinutes] = useState("");
  const [sort, setSort] = useState<SearchFilters["sort"]>("relevance");
  const [limit, setLimit] = useState(48);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [importing, setImporting] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState({ done: 0, total: 0 });
  const [modelMessage, setModelMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const clientRef = useRef<EmbeddingClient | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const cancelRef = useRef(false);
  const cacheRef = useRef(new Map<string, number[]>());
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const [next, nextVectors] = await Promise.all([
      store.read(),
      store.vectors(MODEL_KEY),
    ]);
    if (mounted.current) {
      setLibrary(next);
      setVectors(nextVectors);
    }
    return next;
  }, [store]);

  useEffect(() => {
    mounted.current = true;
    const channel = new BroadcastChannel("playlist-recall-library");
    channelRef.current = channel;
    channel.onmessage = () => {
      void refresh().catch(() => undefined);
    };
    void navigator.locks
      .request("playlist-recall-seed", async () => {
        const current = await store.read();
        if (current.playlists.length === 0) {
          const response = await fetch("/data/library.json").catch(() => null);
          if (response?.ok) {
            const seed = parseImport(await response.json());
            let records: VectorRecord[] = [];
            const vectorResponse = await fetch("/data/vectors.json").catch(
              () => null,
            );
            if (vectorResponse?.ok) {
              const seedVectors = (await vectorResponse.json()) as {
                modelKey: string;
                vectors: VectorRecord[];
              };
              if (
                seedVectors.modelKey === MODEL_KEY &&
                Array.isArray(seedVectors.vectors)
              )
                records = seedVectors.vectors;
            }
            await store.import(seed, records);
          }
        }
      })
      .catch((error) => {
        if (mounted.current)
          setNotice({
            kind: "error",
            message: `L'initialisation n'a pas abouti : ${error instanceof Error ? error.message : "erreur inconnue"}. Vous pouvez importer votre JSON.`,
          });
      })
      .finally(async () => {
        try {
          await refresh();
        } catch {
          if (mounted.current)
            setNotice({
              kind: "error",
              message:
                "La bibliothèque locale ne peut pas être ouverte. Vérifiez le stockage disponible.",
            });
        }
        if (mounted.current) setLoading(false);
      });
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => {
      mounted.current = false;
      cancelRef.current = true;
      channel.close();
      clientRef.current?.dispose();
      clientRef.current = null;
      window.removeEventListener("keydown", shortcut);
    };
  }, [refresh, store]);

  const getClient = useCallback(() => {
    if (!clientRef.current)
      clientRef.current = new EmbeddingClient((status) => {
        if (mounted.current)
          setModelMessage(
            status.phase === "loading" ? "Chargement du modèle local…" : "",
          );
      });
    return clientRef.current;
  }, []);

  const parsed = useMemo(() => parseQuery(query), [query]);
  useEffect(() => {
    let active = true;
    if (!parsed.text || vectors.size === 0) {
      setSearching(false);
      return;
    }
    const cached = cacheRef.current.get(parsed.text);
    if (cached) {
      setQueryEmbedding({ text: parsed.text, vector: cached });
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(() => {
      void getClient()
        .embed([parsed.text], "query")
        .then(([vector]) => {
          if (!vector) throw new Error("Le modèle a renvoyé un résultat vide.");
          if (cacheRef.current.size > 100) cacheRef.current.clear();
          cacheRef.current.set(parsed.text, vector);
          if (active) setQueryEmbedding({ text: parsed.text, vector });
        })
        .catch((error) => {
          if (active)
            setNotice({
              kind: "error",
              message: `La recherche par mots-clés reste disponible. Le modèle local n'a pas démarré : ${error instanceof Error ? error.message : "erreur inconnue"}`,
            });
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [parsed.text, vectors.size, getClient]);

  const filters = useMemo<SearchFilters>(
    () => ({
      playlistId: playlistId || undefined,
      sort,
      minDuration:
        duration === "long"
          ? 3600
          : duration === "medium"
            ? 600
            : duration === "custom" &&
                minMinutes !== "" &&
                Number(minMinutes) >= 0
              ? Number(minMinutes) * 60
              : undefined,
      maxDuration:
        duration === "short"
          ? 600
          : duration === "medium"
            ? 3600
            : duration === "custom" &&
                maxMinutes !== "" &&
                Number(maxMinutes) >= 0
              ? Number(maxMinutes) * 60
              : undefined,
    }),
    [playlistId, duration, sort, minMinutes, maxMinutes],
  );
  const semanticVector =
    queryEmbedding?.text === parsed.text ? queryEmbedding.vector : undefined;
  const results = useMemo(
    () =>
      searchLibrary(
        library.videos,
        library.memberships,
        query,
        filters,
        vectors,
        semanticVector,
      ),
    [library, query, filters, vectors, semanticVector],
  );
  const identifiable = useMemo(
    () => library.videos.filter((v) => buildDocument(v)),
    [library.videos],
  );
  const missing = identifiable.length - vectors.size;
  useEffect(() => setLimit(48), [query, filters]);

  async function importFile(file?: File) {
    if (!file) return;
    setImporting(true);
    try {
      if (file.size > 30 * 1024 * 1024)
        throw new Error("Le fichier dépasse 30 Mo.");
      const data = parseImport(JSON.parse(await file.text()));
      await store.import(data);
      await refresh();
      channelRef.current?.postMessage("changed");
      setPlaylistId(
        data.playlists.length === 1 ? (data.playlists[0]?.id ?? "") : "",
      );
      setNotice({
        kind: "info",
        message: `${number(data.memberships.length)} entrées importées. Lancez l'indexation pour activer la recherche par souvenir sur les nouvelles vidéos.`,
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Import impossible. Vérifiez le fichier JSON.",
      });
    } finally {
      setImporting(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function indexMissing() {
    if (indexing) return;
    cancelRef.current = false;
    setIndexing(true);
    setNotice(null);
    try {
      await navigator.locks.request(
        "playlist-recall-indexing",
        { ifAvailable: true },
        async (lock) => {
          if (!lock) {
            setNotice({
              kind: "info",
              message:
                "Une autre fenêtre indexe déjà votre bibliothèque. La progression sera conservée.",
            });
            return;
          }
          const [current, currentVectors] = await Promise.all([
            store.read(),
            store.vectors(MODEL_KEY),
          ]);
          const pending = current.videos.filter(
            (v) => buildDocument(v) && !currentVectors.has(v.id),
          );
          setIndexProgress({ done: 0, total: pending.length });
          for (let i = 0; i < pending.length && !cancelRef.current; i += 4) {
            const batch = pending.slice(i, i + 4);
            const texts = batch.map(buildDocument);
            const embeddings = await getClient().embed(texts, "passage");
            await store.putVectors(
              batch.map((v, j) => {
                const vector = embeddings[j];
                if (!vector)
                  throw new Error("Le modèle a renvoyé un lot incomplet.");
                return {
                  id: v.id,
                  text: buildDocument(v),
                  modelKey: MODEL_KEY,
                  vector,
                };
              }),
            );
            if (mounted.current) {
              setIndexProgress({
                done: Math.min(i + batch.length, pending.length),
                total: pending.length,
              });
              await refresh();
            }
            channelRef.current?.postMessage("indexed");
          }
          if (mounted.current)
            setNotice({
              kind: "info",
              message: cancelRef.current
                ? "Indexation en pause. Les vidéos déjà traitées sont enregistrées."
                : "Indexation terminée. La recherche par souvenir est disponible.",
            });
        },
      );
    } catch (error) {
      if (mounted.current)
        setNotice({
          kind: "error",
          message: `Indexation interrompue : ${error instanceof Error ? error.message : "erreur inconnue"}. Les lots terminés sont conservés.`,
        });
    } finally {
      if (mounted.current) {
        setIndexing(false);
        await refresh();
      }
    }
  }

  function downloadBackup() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(exportLibrary(library), null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "playlist-recall-sauvegarde.json";
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const chooseExample = (value: string) => {
    setQuery(value);
    searchRef.current?.focus();
  };
  const expand = () =>
    window.open(chrome.runtime.getURL("library.html"), "_blank", "noopener");
  const countFor = (id: string) =>
    library.memberships.filter((m) => m.playlistId === id).length;
  const statusLabel = searching
    ? modelMessage || "Recherche par souvenir…"
    : vectors.size > 0
      ? `${number(vectors.size)} vidéos indexées`
      : "Recherche par mots-clés";

  return (
    <div className="app">
      <aside className="sidebar" aria-label="Navigation de la bibliothèque">
        <ProductBrand mode="local" />
        <nav>
          <p className="nav-label">VOTRE ESPACE</p>
          <button
            className={`nav-item ${!playlistId ? "active" : ""}`}
            onClick={() => setPlaylistId("")}
          >
            <Library size={17} />
            <span>Bibliothèque</span>
            <small>{number(library.videos.length)}</small>
          </button>
        </nav>
        <nav>
          <p className="nav-label">PLAYLISTS</p>
          {library.playlists.map((p) => (
            <button
              key={p.id}
              className={`nav-item playlist-nav ${playlistId === p.id ? "active" : ""}`}
              onClick={() => setPlaylistId(p.id)}
              title={p.title}
            >
              <FolderHeart size={16} />
              <span>{p.title}</span>
              <small>{number(countFor(p.id))}</small>
            </button>
          ))}
          <button
            className="nav-item playlist-nav"
            onClick={() => inputRef.current?.click()}
            disabled={importing || loading}
          >
            <Plus size={15} />
            <span>Importer une playlist</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="local-note">
            <ShieldCheck size={16} />
            Votre bibliothèque reste ici
          </div>
          <p className="muted">
            Recherche et indexation sur cet ordinateur. Aucun compte à
            connecter.
          </p>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">Votre espace / Bibliothèque</div>
          <ProductBrand compact />
          <div className="toolbar">
            <button
              className="btn"
              onClick={downloadBackup}
              disabled={!library.playlists.length || loading}
              title="Exporter une sauvegarde JSON"
              aria-label="Exporter une sauvegarde JSON"
            >
              <Download size={15} />
              <span>Exporter</span>
            </button>
            <button
              className="btn primary"
              onClick={() => inputRef.current?.click()}
              disabled={importing || loading}
            >
              {importing ? (
                <Loader2 size={15} className="spinner" />
              ) : (
                <Upload size={15} />
              )}
              <span>Importer</span>
              <span className="sr-only"> une playlist JSON</span>
            </button>
            <button
              className="btn icon"
              onClick={expand}
              title="Ouvrir la bibliothèque dans un onglet"
              aria-label="Ouvrir la bibliothèque dans un onglet"
            >
              <Maximize2 size={15} />
            </button>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".json,application/json"
            hidden
            aria-label="Fichier playlist JSON"
            onChange={(e) => void importFile(e.target.files?.[0])}
          />
        </header>
        <section className="intro">
          <p className="eyebrow">LES VIDÉOS QUE VOUS AVEZ GARDÉES</p>
          <h1>Retrouver une vidéo.</h1>
          <p>
            Un titre, une ambiance, un souvenir. Cherchez dans toute votre
            bibliothèque.
          </p>
        </section>
        <div className="search-box">
          <Search size={21} />
          <label className="sr-only" htmlFor="search">
            Rechercher dans les playlists
          </label>
          <input
            id="search"
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jazz romantique, un mix de plus d'une heure…"
            autoComplete="off"
            spellCheck={false}
          />
          {query ? (
            <button
              className="clear-search"
              onClick={() => setQuery("")}
              aria-label="Effacer la recherche"
            >
              <X size={16} />
            </button>
          ) : (
            <span className="breadcrumb">⌘ K</span>
          )}
        </div>
        <div className="search-hint">
          <span>Par exemple</span>
          <button
            className="chip"
            onClick={() => chooseExample("jazz romantique de plus d'une heure")}
          >
            Jazz romantique &gt; 1 h
          </button>
          <button
            className="chip"
            onClick={() =>
              chooseExample("musique douce pour un dîner en amoureux")
            }
          >
            Un dîner en amoureux
          </button>
          <button
            className="chip"
            onClick={() => chooseExample("tutoriel de programmation")}
          >
            Apprendre à coder
          </button>
        </div>
        {notice && (
          <div
            role={notice.kind === "error" ? "alert" : "status"}
            className={`notice ${notice.kind}`}
          >
            <span>{notice.message}</span>
            <button
              className="dismiss"
              onClick={() => setNotice(null)}
              aria-label="Fermer le message"
            >
              <X size={14} />
            </button>
          </div>
        )}
        <div className="filterbar">
          <div className="filter-group">
            <SlidersHorizontal size={15} color="#89967f" />
            <label className="select-wrap">
              <span className="sr-only">Playlist</span>
              <select
                aria-label="Playlist"
                value={playlistId}
                onChange={(e) => setPlaylistId(e.target.value)}
              >
                <option value="">Toutes les playlists</option>
                {library.playlists.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="select-wrap">
              <Clock3 size={13} />
              <span className="sr-only">Durée</span>
              <select
                aria-label="Durée"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              >
                <option value="all">Toute durée</option>
                <option value="long">Plus d'une heure</option>
                <option value="short">Moins de 10 min</option>
                <option value="medium">Entre 10 min et 1 h</option>
                <option value="custom">Durée personnalisée</option>
              </select>
            </label>
          </div>
          <div className="index-state" role="status">
            {searching ? (
              <Loader2 size={12} className="spinner" />
            ) : (
              <span className="status-dot" />
            )}
            {statusLabel}
            {missing > 0 && !indexing && (
              <button
                className="chip"
                onClick={() => void indexMissing()}
                disabled={loading || importing}
              >
                <Sparkles size={11} /> Indexer {number(missing)}
              </button>
            )}
          </div>
        </div>
        {duration === "custom" && (
          <div className="custom-duration">
            <label>
              Plus de
              <input
                aria-label="Durée minimum en minutes"
                type="number"
                min="0"
                value={minMinutes}
                onChange={(e) => setMinMinutes(e.target.value)}
              />
              min
            </label>
            <label>
              Moins de
              <input
                aria-label="Durée maximum en minutes"
                type="number"
                min="0"
                value={maxMinutes}
                onChange={(e) => setMaxMinutes(e.target.value)}
              />
              min
            </label>
          </div>
        )}
        {(parsed.minDuration !== undefined ||
          parsed.maxDuration !== undefined) && (
          <p className="constraint">
            Filtre détecté dans votre recherche :{" "}
            {parsed.minDuration !== undefined
              ? `plus de ${parsed.minDuration / 60} min`
              : ""}
            {parsed.minDuration !== undefined &&
            parsed.maxDuration !== undefined
              ? " · "
              : ""}
            {parsed.maxDuration !== undefined
              ? `moins de ${parsed.maxDuration / 60} min`
              : ""}
          </p>
        )}
        {indexing && (
          <div className="progress-panel">
            <div className="progress-row">
              <span>
                {modelMessage ||
                  `Indexation locale · ${number(indexProgress.done)} / ${number(indexProgress.total)} vidéos`}
              </span>
              <button
                className="chip"
                onClick={() => {
                  cancelRef.current = true;
                }}
              >
                <Pause size={11} /> Pause
              </button>
            </div>
            <div className="progress-track">
              <span
                style={{
                  width: `${indexProgress.total ? (100 * indexProgress.done) / indexProgress.total : 0}%`,
                }}
              />
            </div>
            <p className="muted">
              Vous pouvez continuer à chercher. Chaque lot terminé est
              sauvegardé.
            </p>
          </div>
        )}
        <div className="results-heading">
          <p>
            <strong>
              {loading
                ? "Chargement de votre bibliothèque…"
                : `${number(results.length)} ${query ? (results.length === 1 ? "résultat" : "résultats") : results.length === 1 ? "vidéo" : "vidéos"}`}
            </strong>
            {!query && !loading && (
              <span> · {number(library.memberships.length)} entrées</span>
            )}
          </p>
          <label className="select-wrap compact">
            Trier par
            <select
              aria-label="Trier les résultats"
              value={sort}
              onChange={(e) => setSort(e.target.value as SearchFilters["sort"])}
            >
              <option value="relevance">Pertinence</option>
              <option value="position">Ordre de playlist</option>
              <option value="duration">Durée décroissante</option>
            </select>
          </label>
        </div>
        {loading ? (
          <div className="empty">
            <Loader2 size={28} className="spinner" />
            <p>Ouverture de l'index enregistré sur cet ordinateur.</p>
          </div>
        ) : results.length ? (
          <div className="video-grid">
            {results.slice(0, limit).map((result) => (
              <VideoCard
                key={result.video.id}
                result={result}
                showSemantic={Boolean(semanticVector && parsed.text)}
              />
            ))}
          </div>
        ) : (
          <div className="empty">
            <Search size={32} />
            <h2>
              {library.videos.length
                ? "Aucune vidéo ne correspond"
                : "Votre bibliothèque vous attend"}
            </h2>
            <p>
              {library.videos.length
                ? "Essayez une autre description ou élargissez le filtre de durée. Les durées inconnues sont exclues des filtres."
                : "Importez une playlist JSON pour retrouver vos vidéos ici."}
            </p>
            {!library.videos.length && (
              <button
                className="btn primary"
                onClick={() => inputRef.current?.click()}
              >
                <Upload size={15} />
                Importer ma playlist
              </button>
            )}
          </div>
        )}
        {results.length > limit && (
          <div className="load-more">
            <button className="btn" onClick={() => setLimit((n) => n + 48)}>
              Afficher plus de vidéos <ChevronDown size={13} />
            </button>
          </div>
        )}
        {!loading && (
          <footer className="footer">
            <ShieldCheck size={11} /> Recherche sur cet ordinateur ·{" "}
            {number(library.videos.length - identifiable.length)} vidéos sans
            titre disponible.
            {query && semanticVector
              ? " Les résultats sémantiques sont des suggestions classées."
              : ""}
            <br />
            Les miniatures et la lecture YouTube nécessitent Internet. La
            bibliothèque ne contient pas votre historique d'écoute.
          </footer>
        )}
      </main>
    </div>
  );
}

export function VideoCard({
  result,
  showSemantic,
}: {
  result: SearchResult;
  showSemantic: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const { video } = result;
  return (
    <a
      className="video-card"
      href={video.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${video.title ?? "Vidéo sans titre disponible"} — ${formatDuration(video.durationSeconds)} — ouvrir sur YouTube`}
    >
      <div className="thumb">
        {!failed && video.title ? (
          <img
            src={video.thumbnailUrl}
            alt=""
            loading="lazy"
            className={loaded ? "loaded" : ""}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        ) : null}
        {(!loaded || failed || !video.title) && (
          <div className="thumb-placeholder">
            <Disc3 size={35} />
          </div>
        )}
        <span className="duration">
          {video.durationSeconds === null
            ? "—"
            : formatDuration(video.durationSeconds)}
        </span>
        <div className="play-overlay">
          <Play size={24} />
        </div>
      </div>
      <div>
        <h2 title={video.title ?? undefined}>
          {video.title ?? "Titre non disponible"}
        </h2>
        <div className="video-meta">
          <span className="channel">
            {video.channel ?? "Chaîne non disponible"}
          </span>
          <span className="position">
            #{Math.min(...result.memberships.map((m) => m.position))}
          </span>
        </div>
        {showSemantic && result.semantic && (
          <p className="result-tag">
            <Sparkles size={10} />
            Proche de votre recherche
          </p>
        )}
      </div>
    </a>
  );
}

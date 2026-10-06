import { useRef, useState } from "react";
import { App } from "./App";
import { ConnectedApp } from "./connected-app";
import {
  api,
  saveConnection,
  storedConnection,
  validateConnection,
  type Connection,
} from "./server-client";
export function RootApp() {
  const [connection, setConnection] = useState<Connection | null>(
    storedConnection,
  );
  const [local, setLocal] = useState(
    () => localStorage.getItem("playlist-recall-mode") === "local",
  );
  const [settings, setSettings] = useState(false);
  const [url, setUrl] = useState(
    connection?.url ?? "https://recall.stoa.solutions",
  );
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const isLocal = local || !connection;
  const mode = (next: boolean) => {
    setLocal(next);
    localStorage.setItem("playlist-recall-mode", next ? "local" : "server");
  };
  async function connect(value: unknown) {
    setBusy(true);
    setError("");
    try {
      const next = validateConnection(value);
      await api(next, "status");
      saveConnection(next);
      setConnection(next);
      mode(false);
      setSettings(false);
      setToken("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connexion impossible.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="modebar">
        <span>
          {isLocal
            ? "Bibliothèque locale · dernière importation sur cet ordinateur"
            : "Bibliothèque synchronisée sur votre serveur"}
        </span>
        <div>
          {connection && (
            <button onClick={() => mode(!local)}>
              {isLocal ? "Revenir au serveur" : "Utiliser le mode local"}
            </button>
          )}
          <button onClick={() => setSettings(!settings)}>
            {connection ? "Connexion serveur" : "Connecter mon serveur"}
          </button>
        </div>
      </div>
      {settings && (
        <section className="connection-panel" aria-label="Connexion au serveur">
          <h2>Connecter Playlist Recall</h2>
          <p>
            Importez votre fichier de connexion privé ou renseignez l’adresse et
            le jeton fournis pour votre serveur.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void connect({ url, token });
            }}
          >
            <label>
              Adresse du serveur
              <input
                type="url"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <label>
              Jeton personnel
              <input
                type="password"
                required
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </label>
            <div className="toolbar">
              <button className="btn primary" disabled={busy}>
                Connecter
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                Importer la connexion
              </button>
              {connection && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    saveConnection(null);
                    setConnection(null);
                    mode(true);
                    setSettings(false);
                  }}
                >
                  Déconnecter
                </button>
              )}
              <button
                type="button"
                className="btn"
                onClick={() => setSettings(false)}
              >
                Fermer
              </button>
            </div>
          </form>
          <input
            type="file"
            accept=".json,application/json"
            hidden
            ref={fileRef}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file)
                void file
                  .text()
                  .then((text) => connect(JSON.parse(text)))
                  .catch(() => setError("Fichier de connexion illisible."));
              e.target.value = "";
            }}
          />
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
        </section>
      )}
      {isLocal ? <App /> : <ConnectedApp connection={connection!} />}
    </>
  );
}

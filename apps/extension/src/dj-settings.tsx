import { useEffect, useState } from "react";
import { api, type Connection } from "./server-client";
import type { DjStatus as Status } from "@playlist-recall/core/dj";
export function DjSettings({
  connection,
  onSaved,
}: {
  connection: Connection;
  onSaved(): void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gemini-4-argon");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void api<Status>(connection, "dj/status", undefined, controller.signal)
      .then((value) => {
        setStatus(value);
        if (value.model) setModel(value.model);
      })
      .catch(() => {
        if (!controller.signal.aborted) setNotice("Réglages indisponibles.");
      });
    return () => controller.abort();
  }, [connection]);
  async function save(reset = false) {
    setBusy(true);
    setNotice("");
    try {
      await api(
        connection,
        reset ? "dj/settings/reset" : "dj/settings",
        reset ? {} : { ...(apiKey ? { apiKey } : {}), model },
      );
      setApiKey("");
      const value = await api<Status>(connection, "dj/status");
      setStatus(value);
      if (value.model) setModel(value.model);
      setNotice(
        reset
          ? "Configuration personnelle retirée."
          : "Clé enregistrée. Elle sera utilisée à la prochaine demande au DJ.",
      );
      onSaved();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Enregistrement impossible.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="connection-panel" aria-label="Réglages du DJ">
      <h2>Ton IA musicale</h2>
      <p>
        Ta clé Gemini est chiffrée sur le serveur connecté. Elle ne sera jamais
        réaffichée ni incluse dans un export de bibliothèque.
      </p>
      <p>
        {status?.personal
          ? "Ta clé personnelle est active."
          : "Configuration du serveur utilisée."}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label>
          Modèle Gemini
          <select
            value={model}
            onChange={(event) => setModel(event.target.value)}
          >
            <option value="gemini-4-argon">
              Gemini 4 Argon · qualité maximale
            </option>
            <option value="gemini-3.8-flash">Gemini 3.8 Flash · rapide</option>
            <option value="gemini-3.5-flash-lite">
              Gemini 3.5 Flash-Lite · économique
            </option>
          </select>
        </label>
        <label>
          Clé API Gemini
          <input
            type="password"
            autoComplete="off"
            required={!status?.personal}
            placeholder={
              status?.personal
                ? "Laisser vide pour conserver ta clé"
                : "Clé Gemini"
            }
            minLength={20}
            maxLength={256}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
        <p>
          Les appels sont facturés par Google sur le projet associé à cette clé.
          Enregistrer ne garantit pas que le modèle est accessible avec ton
          quota.
        </p>
        <button
          className="btn primary"
          disabled={busy || !status?.settingsAvailable}
        >
          Enregistrer ma clé
        </button>
        {status?.personal && (
          <button
            className="btn"
            type="button"
            disabled={busy}
            onClick={() => void save(true)}
          >
            Utiliser la configuration du serveur
          </button>
        )}
      </form>
      {status && !status.settingsAvailable && (
        <p role="status">
          Le propriétaire du serveur doit activer le stockage sécurisé des clés.
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}

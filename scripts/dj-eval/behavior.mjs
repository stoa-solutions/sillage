/** HTTP contract oracle. This models response effects, not the native audio player. */
export function initialState(scenario) {
  return {
    current: scenario.current ?? null,
    queue: [...(scenario.queuedIds ?? [])],
    history: [],
    discoveries: [],
    rejected: [],
    played: [],
  };
}

export function requestFor(scenario, step, state) {
  const rejected = step.rejectPrevious
    ? [...state.rejected, ...state.discoveries.map((item) => item.id)]
    : state.rejected;
  return {
    scope: scenario.scope,
    message: step.message,
    history: state.history.slice(-12),
    playbackContext: { current: state.current, direction: scenario.direction ?? "" },
    discoveryContext: state.discoveries.slice(0, 8),
    rejectedIds: [...new Set(rejected)].slice(-100),
    excludeIds: [...new Set([
      ...state.played, ...(state.current ? [state.current.id] : []), ...state.queue,
    ])].slice(-100),
  };
}

export function validateResponse(response) {
  if (!response || typeof response !== "object" || Array.isArray(response)) return ["réponse JSON non objet"];
  const failures = [];
  if (!["keep", "append", "replace"].includes(response.action)) failures.push("action invalide");
  if (typeof response.reply !== "string" || !response.reply.trim()) failures.push("reply doit être une chaîne non vide");
  const validTrack = (track) => track && typeof track === "object"
    && typeof track.id === "string" && /^[\w-]{11}$/.test(track.id)
    && typeof track.title === "string" && track.title.trim()
    && (track.channel == null || typeof track.channel === "string");
  if (!Array.isArray(response.tracks) || response.tracks.some((track) => !validTrack(track))) failures.push("tracks invalide");
  if (response.discoveries !== undefined && (!Array.isArray(response.discoveries)
    || response.discoveries.some((item) => !item || !validTrack(item.video) || typeof item.inLibrary !== "boolean"))) {
    failures.push("discoveries invalide");
  }
  return failures;
}

export function checkResponse(step, request, response, state) {
  const failures = [];
  const expect = step.expect;
  const tracks = response.tracks ?? [];
  const cards = response.discoveries ?? [];
  const selected = [...tracks.map((track) => track.id), ...cards.map((item) => item.video.id)];
  if (response.action !== expect.action) failures.push(`action ${response.action}, attendue ${expect.action}`);
  if (!response.reply?.trim()) failures.push("réponse vide");
  for (const [label, values, min, max] of [
    ["titres", tracks, expect.minTracks, expect.maxTracks],
    ["cartes", cards, expect.minCards, expect.maxCards],
  ]) {
    if (min !== undefined && values.length < min) failures.push(`${values.length} ${label}, minimum ${min}`);
    if (max !== undefined && values.length > max) failures.push(`${values.length} ${label}, maximum ${max}`);
  }
  if (new Set(selected).size !== selected.length) failures.push("identifiants répétés");
  if (request.scope === "library" && cards.some((item) => !item.inLibrary)) failures.push("résultat externe dans Mes playlists");
  if (selected.some((id) => !/^[\w-]{11}$/.test(id))) failures.push("identifiant vidéo invalide");
  const excluded = new Set([
    ...(expect.excludes ?? []), ...request.rejectedIds,
    ...(expect.noPreviousCards ? state.discoveries.map((item) => item.id) : []),
    ...(response.action === "append" ? request.excludeIds : []),
  ]);
  if (selected.some((id) => excluded.has(id))) failures.push("titre exclu ou déjà présent réintroduit");
  if (expect.includes?.some((id) => !selected.includes(id))) failures.push("titre attendu absent");
  if (expect.artistAliases?.length) {
    const normalize = (value) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    const aliases = expect.artistAliases.map(normalize);
    if ([...tracks, ...cards.map((item) => item.video)].some((track) => {
      const text = normalize([track.title, track.channel, ...(track.artists ?? [])].join(" "));
      return !aliases.some((alias) => text.includes(alias));
    })) failures.push("artiste demandé non retrouvé dans les métadonnées de chaque résultat");
  }
  if (expect.exactIds && JSON.stringify(tracks.map((track) => track.id)) !== JSON.stringify(expect.exactIds)) {
    failures.push("titres ou ordre différents de la demande");
  }
  if (response.action === "keep" && tracks.length) failures.push("keep contient une opération de lecture");
  if (["append", "replace"].includes(response.action) && !tracks.length) failures.push("opération de lecture vide");
  if (expect.preserveCurrent && response.action === "replace") failures.push("lecture courante remplacée");
  return failures;
}

export function applyResponse(request, response, state) {
  const tracks = response.tracks ?? [];
  if ((response.action === "replace" || (response.action === "append" && !state.current && !state.queue.length)) && tracks.length) {
    if (state.current) state.played.push(state.current.id);
    const track = tracks[0];
    state.current = { id: track.id, title: track.title, channel: track.channel ?? "", artists: [], genres: [] };
    state.queue = tracks.slice(1).map((track) => track.id);
  } else if (response.action === "append") {
    state.queue.push(...tracks.map((track) => track.id));
  }
  state.discoveries = (response.discoveries ?? []).map(({ video }) => ({
    id: video.id, title: video.title, channel: video.channel ?? "",
  }));
  state.rejected = request.rejectedIds;
  state.history = [...state.history,
    { role: "user", content: request.message },
    { role: "assistant", content: response.reply.slice(0, 2000) },
  ].slice(-12);
}

export function classifyFailure(status, response) {
  const message = String(response?.error || response?.reply || "");
  if (status === 401 || status === 403) return "authentication";
  // A partial-source warning is not a failed turn if the requested operation
  // still has candidates; behavioral assertions below decide whether enough exist.
  const hasCandidates = (response?.tracks?.length ?? 0) + (response?.discoveries?.length ?? 0) > 0;
  if (status === 429 || (!hasCandidates && /quota|limite de débit/i.test(message))) return "quota_or_busy";
  if (/source.*(?:pas pu|indisponible)|sources.*joindre/i.test(message)) return "source_unavailable";
  if (status >= 500) return "server_or_provider";
  return null;
}

/** Do not persist raw envelopes, headers, credentials or provider diagnostics. */
export function safeResponse(response, secrets = []) {
  response = response && typeof response === "object" ? response : {};
  const clean = (value) => {
    let text = String(value ?? "").slice(0, 4000);
    for (const secret of secrets.filter(Boolean)) text = text.split(secret).join("[secret masqué]");
    return text.replace(/AIza[\w-]{20,}/g, "[clé masquée]");
  };
  const track = (value) => ({ id: clean(value?.id), title: clean(value?.title), channel: clean(value?.channel),
    artists: Array.isArray(value?.musicMetadata?.artists)
      ? value.musicMetadata.artists.flatMap((artist) => typeof artist?.name === "string" ? [clean(artist.name)] : []) : [],
  });
  return {
    action: clean(response.action), reply: clean(response.reply), error: clean(response.error),
    tracks: Array.isArray(response.tracks) ? response.tracks.map(track) : [],
    discoveries: Array.isArray(response.discoveries)
      ? response.discoveries.map((item) => ({ video: track(item?.video ?? {}), inLibrary: item?.inLibrary === true })) : [],
  };
}

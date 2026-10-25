export interface MusicMetadata {
  source: "MusicBrainz";
  status: "matched" | "ambiguous" | "not_found";
  checkedAt: string;
  recordingId?: string;
  confidence?: number;
  reason?: string;
  artists: { id: string; name: string; role: "primary" | "featured" }[];
  albums: { id: string; title: string }[];
  genres: string[];
  /** Artist-level genres are context, never asserted as this recording's genres. */
  artistGenres: string[];
  searchText: string;
}
export interface Video {
  musicMetadata?: MusicMetadata | null;
  id: string;
  title: string | null;
  channel: string | null;
  durationSeconds: number | null;
  description: string;
  tags: string[];
  thumbnailUrl: string;
  url: string;
  publishedAt: string | null;
  /** Channel photo from YouTube; present in server search results once known. */
  channelAvatarUrl?: string | null;
}
export interface Playlist { id: string; title: string; sourceUrl: string; importedAt: string }
export interface Membership { key: string; playlistId: string; videoId: string; position: number }
export interface LibraryImport { playlists: Playlist[]; videos: Video[]; memberships: Membership[] }
export interface VectorRecord { id: string; modelKey: string; text: string; vector: number[] }
export interface SearchFilters { playlistId?: string; minDuration?: number; maxDuration?: number; sort?: 'relevance'|'position'|'duration' }
export interface SearchResult { video: Video; memberships: Membership[]; score: number; semantic: boolean }

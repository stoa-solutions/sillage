export interface Video {
  id: string;
  title: string | null;
  channel: string | null;
  durationSeconds: number | null;
  description: string;
  tags: string[];
  thumbnailUrl: string;
  url: string;
  publishedAt: string | null;
}
export interface Playlist { id: string; title: string; sourceUrl: string; importedAt: string }
export interface Membership { key: string; playlistId: string; videoId: string; position: number }
export interface LibraryImport { playlists: Playlist[]; videos: Video[]; memberships: Membership[] }
export interface VectorRecord { id: string; modelKey: string; text: string; vector: number[] }
export interface SearchFilters { playlistId?: string; minDuration?: number; maxDuration?: number; sort?: 'relevance'|'position'|'duration' }
export interface SearchResult { video: Video; memberships: Membership[]; score: number; semantic: boolean }

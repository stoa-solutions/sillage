/** Small public-music fixture: no account data or provider credentials. */
export const current = {
  id: "acidcoco001",
  title: "El Amor De Mis Amores",
  channel: "Acid Coco",
  artists: ["Acid Coco"],
  genres: ["cumbia"],
};
export const library = Array.from({ length: 6 }, (_, index) => ({
  id: `libtrack00${index + 1}`,
  title: `Cumbia selection ${index + 1}`,
  channel: `Library artist ${index + 1}`,
  duration_seconds: 180,
}));
export const external = Array.from({ length: 6 }, (_, index) => ({
  id: `yttrack000${index + 1}`,
  title: `External selection ${index + 1}`,
  channel: `YouTube artist ${index + 1}`,
  durationSeconds: 200,
  url: `https://www.youtube.com/watch?v=yttrack000${index + 1}`,
}));
export const collaboration = {
  id: "C7vVkdPEun8",
  title: "Incapable (feat. HEDGES)",
  channel: "Jewel Usain",
  duration_seconds: 213,
  music_metadata: {
    source: "MusicBrainz",
    status: "matched",
    artists: [
      { name: "Jewel Usain", role: "primary" },
      { name: "Béesau", role: "featured" },
      { name: "Hedges", role: "featured" },
    ],
    albums: [{ title: "Où les garçons grandissent" }],
    genres: ["hip hop"],
  },
};

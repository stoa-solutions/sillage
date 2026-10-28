import { expect, it, vi } from "vitest";
import { parseSongs } from "../src/integrations/youtube-music/index.ts";
import { Discovery } from "../src/modules/discovery/index.ts";
import type { Database } from "../src/db/index.ts";

const artist = (text: string) => ({
  text,
  navigationEndpoint: {
    browseEndpoint: {
      browseEndpointContextSupportedConfigs: {
        browseEndpointContextMusicConfig: { pageType: "MUSIC_PAGE_TYPE_ARTIST" },
      },
    },
  },
});
const row = (videoId: string, title: string, details: object[]) => ({
  musicResponsiveListItemRenderer: {
    playlistItemData: { videoId },
    flexColumns: [
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: title }] } } },
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: details } } },
    ],
  },
});
/** The shape of a « Titres » search answer, shelves around the song rows. */
const answer = {
  contents: {
    tabbedSearchResultsRenderer: {
      tabs: [
        {
          content: {
            sectionListRenderer: {
              contents: [
                {
                  musicShelfRenderer: {
                    contents: [
                      row("gritar00001", "Gritar", [artist("Pahua"), { text: " • Gritar • 3:00" }]),
                      row("espanta0001", "Espantapájaros", [
                        artist("Pahua"),
                        { text: " et " },
                        artist("La Perla"),
                        { text: " • 2:53" },
                      ]),
                      row("plain000001", "Sans lien", [{ text: "Someone et Pahua • 3:10" }]),
                    ],
                  },
                },
              ],
            },
          },
        },
      ],
    },
  },
};

it("reads songs and their credited artists from a YouTube Music answer", () => {
  expect(parseSongs(answer)).toEqual([
    { videoId: "gritar00001", title: "Gritar", artists: ["Pahua"] },
    { videoId: "espanta0001", title: "Espantapájaros", artists: ["Pahua", "La Perla"] },
    { videoId: "plain000001", title: "Sans lien", artists: ["Someone", "Pahua"] },
  ]);
});

it("keeps an artist's credited songs a day, checked by YouTube, and recomputes ownership", async () => {
  const video = (id: string, title: string) => ({
    id,
    title,
    channel: "Pahua - Topic",
    channelId: null,
    durationSeconds: 180,
    thumbnailUrl: "https://i.ytimg.com/x",
    url: `https://youtube.com/watch?v=${id}`,
  });
  const source = {
    search: vi.fn(),
    videos: vi.fn().mockResolvedValue([video("gritar00001", "Gritar"), video("espanta0001", "Espantapájaros")]),
  };
  const music = {
    songs: vi.fn().mockResolvedValue([
      { videoId: "gritar00001", title: "Gritar", artists: ["Pahua"] },
      { videoId: "other000001", title: "Autre", artists: ["Quelqu’un"] },
      { videoId: "espanta0001", title: "Espantapájaros", artists: ["Pahua", "La Perla"] },
    ]),
  };
  const owned = vi.fn().mockResolvedValue(new Set(["espanta0001"]));
  const discovery = new Discovery({} as Database, source as never, owned, music);
  const page = await discovery.songs("alice", "Pahua");
  // Only songs credited to Pahua are checked, in YouTube Music's order, named with their credits.
  expect(source.videos).toHaveBeenCalledWith(["gritar00001", "espanta0001"], true);
  expect(page.results.map((item) => [item.video.title, item.inLibrary])).toEqual([
    ["Pahua - Gritar", false],
    ["Pahua, La Perla - Espantapájaros", true],
  ]);
  expect(discovery.songsCached("pahua")).toBe(true);
  await discovery.songs("bob", "Pahua");
  expect(music.songs).toHaveBeenCalledTimes(1);
  expect(owned).toHaveBeenCalledTimes(2);
});

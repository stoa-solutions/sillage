import { expect, it } from "vitest";
import { approximateLookupPatterns, lookupTokens, matchesLookup, isDescriptiveQuery, genreNameCollision } from "../src/search-relevance.ts";
it("accepts complete artist/title matches and bounded typos, rejects partial or invented requests", () => {
 const song={title:"Self Care",channel:"Mac Miller - Topic"};
 expect(matchesLookup("Mac Miller Self Care",song)).toBe(true);
 expect(matchesLookup("Mac Miler Self Car",song)).toBe(true);
 expect(matchesLookup("Mac Miller Missing Song 987654",song)).toBe(false);
 expect(matchesLookup("zzzxqv chanson inexistante 987654",song)).toBe(false);
});
it("recognizes credited apostrophes and adjacent transpositions without artist aliases", () => {
 expect(lookupTokens("M’Dee")).toEqual(["mdee"]);
 expect(matchesLookup("Madee basquany", { title: "basqany :( M’Dee", channel: "Ayau" })).toBe(true);
 expect(matchesLookup("MDee baqsany", { title: "basqany :( M’Dee", channel: "Ayau" })).toBe(true);
 expect(matchesLookup("M Dee basquany", { title: "basqany :( M’Dee", channel: "Ayau" })).toBe(true);
 expect(matchesLookup("MDee completelydifferent", { title: "basqany :( M’Dee" })).toBe(false);
});
it("bounds approximate retrieval patterns and strips regex operators from user words", () => {
 expect(approximateLookupPatterns("basquany")).toHaveLength(1);
 expect(approximateLookupPatterns("ab")).toEqual([]);
 expect(approximateLookupPatterns("one two three four five")).toEqual([]);
 expect(approximateLookupPatterns("a".repeat(33))).toEqual([]);
 expect(approximateLookupPatterns("basquany.*")).toEqual(approximateLookupPatterns("basquany"));
});
it("distinguishes descriptive requests from artist and title lookups", () => {
 expect(isDescriptiveQuery("jazz doux pour une soirée calme")).toBe(true);
 expect(isDescriptiveQuery("quiet evening")).toBe(true);
 expect(isDescriptiveQuery("un morceau avec un saxophone dans la nuit")).toBe(true);
 expect(isDescriptiveQuery("romantic piano")).toBe(true);
 expect(isDescriptiveQuery("zzzxqv chanson inexistante 987654")).toBe(false);
 expect(isDescriptiveQuery("Mac Miller Self Care")).toBe(false);
});
it("does not confuse an artist name with genre evidence", () => {
 expect(genreNameCollision("jazz doux",{title:"Jazz Cartier - Tempted",description:"New song from Jazz Cartier"})).toBe(true);
 expect(genreNameCollision("jazz doux",{title:"Art Blakey - Moanin'",description:"Jazz session"})).toBe(false);
 expect(genreNameCollision("Jazz Cartier",{title:"Jazz Cartier - Tempted"})).toBe(true); // Only used for descriptive requests.
});

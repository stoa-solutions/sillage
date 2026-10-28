import Foundation
import SillageKit

func checkEnrichmentProgress() throws {
  var data: [String: Any] = [
    "total": 100, "processed": 10, "matched": 4, "ambiguous": 3, "not_found": 3,
    "unavailable": 2, "awaiting_youtube": 1, "queued": 9, "running": 1,
    "retrying": 1, "failed": 0, "enabled": true, "batchSize": 10,
    "checkedAt": "2026-10-25T12:00:00Z",
  ]
  let progress = try EnrichmentProgress.decode(data)
  try expect(
    progress.remaining == 88 && progress.matched == 4 && progress.processed == 10,
    "Processed was confused with enriched, or unavailable tracks remain pending")
  try expect(abs(progress.fraction - 0.12) < 0.001, "Progress ratio excludes skipped tracks")
  data["enabled"] = false
  try expect(
    try EnrichmentProgress.decode(data).title.contains("pilote"),
    "Disabled rollout presented as running")
  data["matched"] = 10
  try expectFailure { _ = try EnrichmentProgress.decode(data) }
  data["matched"] = 4
  data["total"] = 5
  try expectFailure { _ = try EnrichmentProgress.decode(data) }
  print(
    "Enrichment progress checks passed: partial matches, skips, disabled rollout, malformed counters"
  )
}

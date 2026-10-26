// Run from the Computer Use REPL, passing the bound Sillage app and a private evidence callback.
// Exercises the installed UI only; never starts playback or sends a DJ message.
export async function verifyDiscoverPanel(app, { nowPlaying, record = async () => {} } = {}) {
  const state = () => app.getAXState({ emit: false, disableDiffing: true })
  const lineFor = (ax, pattern) => ax.split('\n').filter(line => /^\s*\d+ /.test(line) && pattern.test(line))
  const check = (condition, message) => {
    if (!condition) throw new Error(message)
  }
  const click = async pattern => {
    const ax = await state()
    const lines = lineFor(ax, pattern)
    check(lines.length === 1, `Expected one UI control for ${pattern}, found ${lines.length}`)
    await app.click(Number(lines[0].trim().match(/^\d+/)[0]))
    return state()
  }
  const discover = /radio button Description: Découvrir, Value:/
  const collapse = /button Description: Replier le panneau,/
  const reopen = /button Afficher le panneau DJ et la file/
  const search = /text field .*Description: Rechercher un morceau,/
  const queryValue = ax => {
    const line = lineFor(ax, search)[0] ?? ''
    return line.match(/Value: (.*?)(?:, (?:Placeholder|Help|ID):|$)/)?.[1] ?? ''
  }
  const setQuery = async value => {
    const lines = lineFor(await state(), search)
    check(lines.length === 1, 'Expected one Discover search field')
    await app.setValue(Number(lines[0].trim().match(/^\d+/)[0]), value)
    return state()
  }
  const playback = ax => ax.match(/button(?: \(disabled\))? Description: (Lecture|Pause),/)?.[1]
  let ax = await click(discover)
  const originalQuery = queryValue(ax)
  const originallyCollapsed = lineFor(ax, reopen).length === 1
  const playbackBefore = playback(ax)
  const trackMarker = `text ${nowPlaying ?? 'Prêt quand tu l’es'}`
  check(playbackBefore !== undefined, 'Playback controls are missing')
  check(ax.includes(trackMarker), 'Pass the current title and artist as nowPlaying when music is selected')
  const unchanged = current => {
    check(queryValue(current) === 'Mac Miller', 'Collapsing or navigating cleared the search')
    check(playback(current) === playbackBefore, 'Panel navigation changed the playback state')
    check(current.includes(trackMarker), 'Panel navigation changed the current track')
  }
  try {
    if (originallyCollapsed) ax = await click(reopen)
    await setQuery('Mac Miller')
    ax = await click(collapse)
    await record('collapsed', ax, await app.getScreenshot({ emit: false }))
    check(lineFor(ax, collapse).length === 0, 'Discover still shows the panel after Collapse')
    check(lineFor(ax, reopen).length === 1, 'Discover has no control to reopen the panel')
    unchanged(ax)

    ax = await click(reopen)
    check(lineFor(ax, collapse).length === 1, 'Discover did not reopen the panel')
    unchanged(ax)
    await record('reopened', ax, await app.getScreenshot({ emit: false }))

    await click(/radio button Description: Bibliothèque, Value:/)
    ax = await click(discover)
    check(lineFor(ax, collapse).length === 1, 'Returning to Discover changed the open panel state')
    unchanged(ax)

    await click(collapse)
    ax = await click(/radio button Description: DJ, Value:/)
    check(lineFor(ax, reopen).length === 1, 'DJ did not keep the shared collapsed panel state')
    ax = await click(discover)
    check(lineFor(ax, reopen).length === 1, 'Returning to Discover reopened the collapsed panel')
    unchanged(ax)
    await record('returned-collapsed', ax, await app.getScreenshot({ emit: false }))
    return { passed: true, checks: ['collapse', 'reopen', 'navigation', 'query', 'playback'] }
  } finally {
    ax = await state()
    if (!/radio button Description: Découvrir, Value: 1/.test(ax)) ax = await click(discover)
    await setQuery(originalQuery)
    ax = await state()
    if (originallyCollapsed && lineFor(ax, collapse).length === 1) await click(collapse)
    if (!originallyCollapsed && lineFor(ax, reopen).length === 1) await click(reopen)
  }
}

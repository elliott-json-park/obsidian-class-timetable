# Contributing

Bug reports, feature requests and pull requests are all welcome. This file is
the short version of what will make any of them go smoothly.

## Reporting a bug

Open an issue at
[github.com/elliott-json-park/obsidian-class-timetable/issues](https://github.com/elliott-json-park/obsidian-class-timetable/issues).

The useful things are: your Obsidian version, desktop or mobile (and which
OS), the plugin version, and what you did immediately before it happened. If a
class shows at the wrong time or on the wrong day, paste the frontmatter of
that class's note — times live there, so it usually shows the cause at once.
If it came from a pasted timetable or an `.ics` import, a few lines of what you
pasted (with anything private removed) help too.

## Suggesting a feature

Say what you were trying to do, and how your school's timetable works, not
only what you would like added. Timetables differ a lot between schools and
countries, and much of the design here came from someone describing theirs.

Two things are deliberately out of scope, so it saves time to say so:

- **Anything that reaches the network.** The plugin makes no network requests
  and collects nothing; school portals are imported by pasting or by `.ics`
  files, not by logging in.
- **Changing how data is stored per language.** What is written to your files
  never depends on the interface language (weekdays are always stored as
  `월 화 수 목 금 토 일`), so a vault keeps working when the language changes.

## Pull requests

### How the code is laid out

`main.js` in the repository root **is** the source — there is no build step
and no npm dependency. `styles.css` is hand-written as well. The demo page is
built from the same `main.js` by `scripts/build-demo.mjs`.

### Before you open the PR

1. **It works on mobile too.** The plugin is not desktop-only; check the
   change on a phone-sized window at least, and on the mobile app if you can.
2. **New text exists in every language.** The interface is in English,
   Korean, Chinese and Japanese. Add your strings for all four — a machine
   translation is fine as a start, say so in the PR.
3. **Old notes still read correctly.** Anything that changes the frontmatter
   format needs to keep reading notes written by earlier versions.

### Commit messages

A sentence in the imperative that says what the change does for the user:
"Show online classes without a meeting time in the To-do tab". Not "fix bug".

## Releases

Maintainer only. Bump `manifest.json` and `versions.json`, commit, then
`git tag <version> && git push origin <version>`. The workflow in
`.github/workflows/release.yml` checks that the tag matches `manifest.json`,
attaches `main.js`, `manifest.json` and `styles.css`, and mints a provenance
attestation so anyone can verify with `gh attestation verify` that the assets
came from this repository.

## License

By contributing you agree that your contribution is licensed under the MIT
licence, the same as the rest of the project. See [LICENSE](LICENSE).

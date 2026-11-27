# Design

How the app looks and why. The screens use [Atlas UI](https://github.com/leonfpontes/design-system-mcp)
(`@leonfpontes/atlas-ui` 0.3.0 from npm) as it is; this file lists only what this product adds and
the rules the screens follow.

## Style

- **Minimalism** first: hierarchy from size, weight and space; one primary action per screen; the
  numbers carry the page. **Flat** second: 1 px borders, solid fills, shadows only on overlays.
- Light and dark, with the Atlas tokens. No glass, gradients, glow, bloom or particles: the 3D graph
  is content, flat shapes with no lighting.
- The readers are engineers who check whether the retrieval is honest: quiet, dense, aligned screens.

## Type and controls

- IBM Plex Sans; IBM Plex Mono for code, ids, file names and every number (tabular, the `n` utility).
- Sizes: 28 note title, 24 page title, 16 answer and note body (line height 1.7), 14 interface,
  13 numbers, 12 labels and graph labels (never smaller).
- Controls are 40 px with a mouse and 44 px on touch; the focus ring is 3 px in `--ring`.

## Color roles

One new color with one job, in `apps/web/src/styles.css`:

| Token                   | Light     | Dark      | Job                                                                                                 |
| ----------------------- | --------- | --------- | --------------------------------------------------------------------------------------------------- |
| `--evidence`            | `#0F766E` | `#2DD4BF` | What an answer used, only: citation chips, cited source numbers, the lit path, rings, the chunk bar |
| `--evidence-subtle`     | `#E2F4F1` | `#0F2E2B` | The citation chip's background and the highlighted words of an excerpt                              |
| `--evidence-foreground` | `#FFFFFF` | `#11151C` | Text on solid `--evidence` (a hovered chip, a citation number on the graph)                         |

- `--evidence` on the background: 5.47 : 1 light, 9.83 : 1 dark. Evidence and success green are close,
  so success green never appears in Ask, Note or the graph, and the best value on the Evaluation is a
  ✓ in ink.
- Atlas colors keep their jobs: `--primary` for actions, links and focus; `--warning` for example data,
  superseded notes and stale results (always dashed); `--destructive` for errors. A removed sentence is
  neutral, never amber.

## Note types: shape, color and word

| Type     | Shape       | Light     | Dark      |
| -------- | ----------- | --------- | --------- |
| Person   | circle      | `#0B63B5` | `#6FB3F5` |
| Project  | square      | `#A35F00` | `#F2A93B` |
| Decision | diamond     | `#9D3F86` | `#E59AD0` |
| Meeting  | triangle    | `#5C6B00` | `#C9D45C` |
| Customer | hexagon     | `#C0430A` | `#FF8A5C` |
| Document | folded page | `#5B6475` | `#A3ACBD` |

Six hues cannot all stay apart for color-blind vision (project × customer and project × meeting fall
under ΔE 2 in deuteranopia and protanopia), so **the shape carries the type**, every legend writes
the word, and the color only helps.

## Graph

- **3D** on desktop with Three.js, loaded only when Explore or Ask shows it (its own chunk); until it
  loads, and without WebGL, a 2D canvas draws the same projection. **2D** on phones and in the Note
  page. **List** for keyboards and screen readers. The canvas is an image with a text label that names
  the selection and points to the List.
- **Constellations:** every note joins its nearest project (breadth-first over the links); projects
  spread on a sphere and their notes gather around them. The layout has a fixed seed: every visit draws
  the same graph. With nothing selected, the canvas names the biggest constellations (12 on desktop,
  6 on phones) and the side card lists them.
- **Phones open on a map:** one bubble per constellation, its size and count from the notes, its name
  under it; a tap opens that constellation in 2D. 3D is not offered on phones (Map · 2D · List).
- **Selection:** 1 hop at full opacity, 2 hops at half, the rest at 12%; a ring in ink.
- **Answer path:** only the links the answer walked, in `--evidence` at 2.5 px, each with its type
  written on it in 12 px mono; cited notes ringed and numbered like the citations; the rest gray. The
  links come from two records only: the search's `link` reasons (a two-hop reason lights both links)
  and the answer's citations of a note's links passage (a quote that names a linked note lights that
  link). The 3D view turns to the angle that spreads the path's notes the most, and frames them.
  "The path, as text" writes the same links as a tree from the note most links touch.
- **Labels** are 12 px or more with a halo, placed to avoid each other, the canvas controls and every
  visible note; a label that finds no room is left out (the List and the side card carry the names).
- Line contrast: path links 5.11 : 1 light and 10.17 : 1 dark on `--canvas`; context links are
  background on purpose. Under `prefers-reduced-motion`, the 3D view does not turn.

## Screens

- **Shell:** the mark, `graph-rag-vault / tarnwick-vault`, the tabs Explore, Ask and Evaluation, the
  mode (what runs in the browser and what needs a key), GitHub and the theme. Phones move the tabs to a
  bottom bar. Note opens from a node, a source or a link.
- **Explore:** filters (note and link types, with counts) | graph | the selected note (type, file,
  updated, status, neighbors by link, Open note, Ask about this note). Below 1180 px the selected note
  moves under the graph, so the way to the note stays on screen at 1024 px. States: loading (the index
  download in MB), error (what failed, Try again), nothing matches (clear the search and filters).
- **Ask:** the question lives in its box; under it, the recorded questions (open before the first
  answer). Each sentence ends with its source numbers; hover or focus shows the exact passage the
  answer read, with the quote marked (a bottom sheet with Close on phones), and a click jumps to the
  source. Sources show the rank, type, title, the excerpt with the matched words and why the search
  brought each one; the fused score is in the rank's tooltip. Vectors or Graph show which expected notes
  the variant misses. States: start, loading the search model (MB, Cancel; only for the first typed
  question), searching (skeleton), "I don't know" (the closest notes, and whether that is the expected
  reply), a typed question in the demo (the search results and the steps to answer it locally), a
  model or API error (what failed, Try again). The recorded answers carry no per-source reason for an
  "I don't know", so the page lists the closest notes without one.
- **Note:** breadcrumb with the file, type, title, updated, links, chunks and its constellation; the
  frontmatter as a table that folds; the body in its chunks, each with the recorded questions whose
  answers cite it (cited chunks carry the evidence bar); aside: the notes one link away, the links by
  type and direction, and the evaluation questions that expect this note.
- **Evaluation:** the sentence (below), recall@5 by question kind, the scoreboard with ✓ on the best
  value and a hybrid − vectors column, the faithfulness judge and how it was checked, every test
  question with the rank of its first expected note per variant, the run's own notes, and the commands.

## The sentence

`headline()` (`apps/web/src/lib/headline.ts`) writes it from the verdict in `latest.json`: hybrid
search against the **best other variant** on recall@5, under 5 points is a **tie**
(`verdict.outcomeVsBestOther`). Recall@5 is the share of the expected notes found in the top 5, so the
words are "of the expected notes" or "recall@5", never "of questions". Whenever the best other variant
is not vectors only, a second line says what the graph adds to vectors. The judge card says the person's
review was not blind and the sample is stratified, never random.

## Writing

Sentence case everywhere. The same names everywhere: Vectors only, Graph only, Hybrid; Recall@5, MRR,
Faithfulness, Citation precision, Correct "I don't know". Verbs on buttons, numbers instead of
adjectives, and errors that say what failed and what to do next.

## Decided in the design review (27/11/2026)

Accepted deviations from the prototype:

1. From 761 to 1180 px, the selected note moves under the graph in Explore (the prototype hid it at
   1024 px, with no way left to the note).
2. "I don't know" lists the closest notes without "Why it is not enough": the recorded answers carry
   no such text, so none is written by hand.
3. Explore shows no "indexed" date: the index file stores none.
4. The lit path can pass through a note below the top 5 when the answer cited the link that reaches
   it (Keep Ampcore on q-022).
5. In 3D, with nothing framed, the cloud widens with the canvas; with a lit path the view turns to
   spread the path's notes.
6. Ask has no separate "searching" state for a recorded question: the search takes about 2 ms.

Rules from the same review: a graph label that finds no free spot is left out, never drawn over a note,
a ring or another label; links inside text or lists read as links (primary, underlined); a ✓ goes to
every variant whose shown value ties with the best; a file path breaks only after a "/".

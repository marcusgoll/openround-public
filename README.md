# OpenRound

Open golf shot tracking, a deterministic caddy, scorecards, and portable round data.
OpenRound combines a local Python data pipeline, browser GPS capture, an iPhone
prototype with a native location journal, and experimental sensor hardware.

**Status: experimental.** Browser capture is foreground-only. Native background
tracking needs signed-device and on-course validation; automated tests do not
establish field reliability. Firmware and mechanical designs are prototypes.
See the [release verification](docs/open-source-readiness.md) for checks and
known limitations. This is a clean public snapshot; private development history
and unverified template/artwork are not included.

## Try it locally

No vendor account, API key, or hardware is required to run the demos or test suite.
Use Python 3.11+, [uv](https://docs.astral.sh/uv/), and Node.js 24 for the iPhone
prototype (`.nvmrc` is provided).

```sh
git clone https://github.com/marcusgoll/openround-public.git
cd openround-public
uv sync --locked
uv run pytest
```

### iPhone prototype

```sh
cd prototypes/openround-iphone
npm ci
npm run dev -- --host 127.0.0.1
```

Open the localhost URL printed by Vite. The prototype includes course selection,
round scoring, club evidence, and a responsive browser interface. Dependencies and course
bundles are pinned. Optional browser configuration is documented in
[.env.example](prototypes/openround-iphone/.env.example); copy it to `.env.local`
only if you need overrides. Browser keys are public configuration.

For native iOS setup, permissions, and device validation, see
[ios/README.md](prototypes/openround-iphone/ios/README.md). This requires macOS,
Xcode, and appropriate device signing. No signing credentials are distributed.

### Small GPS-capture PWA

From the repository root:

```sh
python3 -m http.server 8876 --bind 127.0.0.1
```

Open `http://localhost:8876/app/?demo=1` for synthetic GPS fixes and events.
Real phone GPS requires an HTTPS origin reachable from the phone and permission.
This PWA records only while visible and exports `openround.capture.v1` JSON.

### Python pipeline

From the repository root:

```sh
uv run python -m openround --help
uv run python -m openround import rounds/      # your normalized JSON files
uv run python -m openround stats
uv run python -m openround clubs
uv run python -m openround shotmap             # writes data/shotmap.html
```

The optional `shotscope` command prompts for your own Shot Scope credentials
(or reads `OPENROUND_SS_EMAIL` / `OPENROUND_SS_PASSWORD`) and downloads your rounds.
`shotscope --offline` rebuilds from an existing raw archive. The importer uses
Shot Scope's dashboard endpoints and can break when that service changes.

Generated data stays under `data/` by default and is ignored by Git. The optional
`roadmap --path /path/to/note.md` command previews changes to your own Markdown
roadmap; add `--write` to apply them with a backup. Its legacy default path is
maintainer-specific, so contributors should always supply `--path`.

Local storage is not a claim of zero network traffic: maps, weather, course refresh,
vendor imports, and generated-map fonts contact external services. Read
[privacy notes](docs/privacy.md) before using real location or account data.

## Repository map

| Path | Purpose |
| --- | --- |
| `src/openround/`, `tests/` | Python imports, capture validation, statistics, caddy, tests |
| `app/` | Small foreground GPS PWA and demo |
| `prototypes/openround-iphone/` | React/TypeScript iPhone prototype and Capacitor iOS project |
| `firmware/phase1/` | Experimental Zephyr sensor firmware |
| `cad/`, `mechanical/` | Hardware design sources and design records |
| `docs/` | Data formats, provenance, design history, and operations |

## Contribute

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, tests, and pull-request guidance,
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community expectations, and
[SECURITY.md](SECURITY.md) for private vulnerability reporting. Use synthetic data
in issues and tests. CI checks Python, web models, browser flows, builds, and secrets.

Useful references: [data format](docs/data-format.md), [project plan](docs/plan.md),
[hardware review](docs/hardware-review.md), and
[strokes-gained provenance](docs/sg-baseline-provenance.md).
Historical design documents can describe unfinished or superseded work.

## License and third-party material

Original OpenRound code is offered under the [MIT License](LICENSE). Third-party
code, data, and artwork retain their own terms; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). In particular, the course database
is ODbL-1.0, not MIT. Unverified template/artwork and published benchmark tables have been excluded.
Strokes-gained calculations require your own authorized benchmark; see
[benchmark setup](docs/sg-baseline-provenance.md). OpenRound is not affiliated with Shot Scope, Apple,
Google, or the PGA Tour.

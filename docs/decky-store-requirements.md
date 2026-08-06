# Decky store requirements

What the Decky plugin store mechanically requires of this repository, where each requirement comes
from, and where it is enforced. This is a requirements register, not advice: every row is either a
check that runs in `make check` / `make build`, a standing property of the repository that no check
inside it can assert, or an explicit deferral with a reason.

Sources, in decreasing authority:

- **CLI**: [`SteamDeckHomebrew/cli`](https://github.com/SteamDeckHomebrew/cli), `src/plugin.rs` and
  `src/cli/plugin/build.rs`. The store's CI invokes `decky plugin build -b -o /tmp/output -s
  directory plugins/<name>`, so this code *is* the packaging contract.
- **DB CI**: [`decky-plugin-database`](https://github.com/SteamDeckHomebrew/decky-plugin-database),
  `.github/workflows/build-plugins.yml` (what the store reads off a built zip when submitting) and
  `builder/entrypoint.sh` (the frontend build container).
- **Wiki**: [`SteamDeckHomebrew/wiki`](https://github.com/SteamDeckHomebrew/wiki),
  `plugin-dev/getting-started.md`, `plugin-dev/submitting-plugins.md`,
  `plugin-dev/review-and-testing.md`. (The rendered wiki at wiki.deckbrew.xyz does not serve its body
  to plain fetches; the markdown source in that repo is the readable form.)
- **PR template**: `decky-plugin-database/.github/PULL_REQUEST_TEMPLATE/plugin_addition.md`.

## Enforced

| # | Requirement | Source | Enforced by |
| - | ----------- | ------ | ----------- |
| R1 | `plugin.json` exists at the repo root and deserializes into `{name: string, author: string, flags: string[]}`. The CLI hard-fails on a missing field. | CLI `plugin.rs::find_pluginfile`, `PluginFile` | `make repo-check` → `check_plugin.py repo` |
| R2 | `package.json` exists at the repo root. The CLI refuses to build a plugin without one. | CLI `plugin.rs::find_frontend` | `make repo-check` |
| R3 | `package.json.name` is lowercase, dash-separated (npm-conformant). | Wiki getting-started; DB CI review step 2 | `make repo-check` |
| R4 | `package.json.version` is the version the store publishes (`version_name`), read straight off the built zip. It must be bumped before every update PR. | DB CI `query_package_json '.version'`; wiki getting-started | `make version-check`, release-please owns the bump |
| R5 | `plugin.json.publish` carries `tags` (non-empty array of strings), `description` (non-empty), and `image` (absolute `http(s)` URL to a PNG). The store's upload step fails loudly on a bad URL scheme. | DB CI upload step; wiki getting-started | `make repo-check` |
| R6 | `flags` uses only values Decky understands (`debug`, `root`/`_root`). | Wiki getting-started; template `plugin.json` | `make repo-check` |
| R7 | A `LICENSE` (or `LICENSE.MD`) is present, and `package.json.license` agrees with it. Submissions without a license are rejected. | Wiki submitting-plugins ("All plugins submitted must include a license"); PR template | `make repo-check` |
| R8 | `README.md` is present; the CLI packages it as one of the expected root files. | CLI `build.rs::zip_plugin` `expected_files` | `make repo-check`, `make bundle-check` |
| R9 | `pnpm-lock.yaml` is committed and on `lockfileVersion: '9.0'`; `pnpm i --frozen-lockfile` must succeed against it. | DB CI review step 3; `builder/entrypoint.sh` | `make repo-check` (version), `make frontend-check` (`pnpm install --frozen-lockfile`) |
| R10 | `pnpm run build` must exist and succeed; it is literally what the store's builder container runs. | `builder/entrypoint.sh` | `make build` (via `frontend-build` → `pnpm run build`) |
| R11 | The build produces a `dist/` directory. It is the only **mandatory** directory in the packaged zip. | CLI `build.rs` `DirDirective { path: "dist", mandatory: true }` | `make bundle-check` |
| R12 | The packaged zip contains exactly one top-level directory, named for the plugin, holding `plugin.json`, `package.json`, `main.py`, `dist/`, `py_modules/`, `LICENSE`, `README.md`. | CLI `build.rs::zip_plugin` (`expected_files` + `directories` + `zip_path` prefixing) | `make bundle-check` |
| R13 | No `src/`, `node_modules/`, or `__pycache__` in the shipped tree. | `builder/entrypoint.sh` rsync excludes; CLI `copy_py_modules` skips `__pycache__` | `make bundle-check` |
| R14 | Unused `backend/`, `assets/`, and `defaults/` directories must not exist: reviewers ask for their removal and the CLI treats a bare `backend/` without a Dockerfile as an error. | Wiki review-and-testing step 7; CLI `plugin.rs::find_custom_backend` | `make repo-check` |
| R15 | The version appears in exactly one authoritative place. `plugin.json` must carry no `version` key, and `pyproject.toml`'s version must equal `package.json`'s. | Derived: DB CI reads only `package.json.version`, so any second copy is silent drift | `make version-check` |
| R16 | The zip's own `package.json` / `plugin.json` must agree with the repo's, because the store reads its metadata out of the artifact, not out of the checkout. | DB CI `query_package_json` / `query_plugin_json` read from inside the zip | `make bundle-check` |
| R17 | `plugin.json` carries `api_version`, the plugin API generation Decky loads against. | Template `plugin.json`; loader `plugin.json` schema | `make repo-check` |

## Met outside CI

| Requirement | Source | How it is met |
| ----------- | ------ | ------------- |
| The plugin repository must be public: "we do not allow private repositories". | Wiki submitting-plugins | `lutyjj/perigee` is public. A property of the repository's visibility setting, which no check running inside the repository can assert. |
| `plugin.json.publish.image` points at artwork for *this* plugin rather than the template's `opengraph.githubassets.com/1/SteamDeckHomebrew/PluginLoader` placeholder. | Wiki getting-started; DB CI upload step | The field holds `https://opengraph.githubassets.com/1/lutyjj/perigee`, the social-preview PNG GitHub generates for the repository. R5 keeps the URL well-formed; that it resolves follows from the repository being public, which is the row above. |

## Deferred

| Requirement | Source | Why deferred |
| ----------- | ------ | ------------ |
| Third-party testing on SteamOS Stable/Beta, and testing two other plugins' PRs. | PR template; wiki review-and-testing | Human process, off-CI by construction. |
| Store-side upload (`SUBMIT_AUTH_KEY`, `STORE_URL`). | DB CI upload step | Owned by the database repo's CI, not by a plugin repo. A plugin repo has nothing to run. |
| Signed/attested release artifacts (provenance, SBOM). | House practice, not a Decky requirement | The store rebuilds from source and ignores our release assets, so attestation buys nothing here yet. Revisit if the release zip becomes the distribution channel. |
| Dependency advisory scanning (osv-scanner). | House practice, not a Decky requirement | Deferred for MVP: the frontend dependency set is small and pinned by a lockfile, and the backend has zero runtime dependencies (`pyproject.toml` `dependencies = []`). Cheap to add later as a scheduled workflow. |

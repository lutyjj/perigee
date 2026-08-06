# Development

Every toolchain runs in a digest-pinned container; the host needs Docker (or Podman) and `make`,
nothing else. `make check` and `make build` are the exact targets CI runs; there is no separate
CI recipe to drift. CI runs on demand (`gh workflow run ci.yml --ref <branch>`), typically once
a PR is ready for its gate: local runs of the same targets carry the same weight.

```sh
make check         # ruff, mypy --strict, pytest, tsc, vitest, store metadata, workflow lint, secret scan
make format        # apply ruff fixes and formatting
make build         # produce out/perigee/ and out/perigee.zip
make bundle-check  # prove the zip matches the store's packaging contract
make deploy        # rsync the build to your device, restart plugin_loader, wait for a clean load
make verify        # run the on-device CLI harness against the device's Moonlight config
```

## Device profile

`deploy` and `verify` target a real SteamOS device described only by the gitignored `device.env`
(start from `device.env.example`). The Makefile defines no fallbacks and the scripts refuse to
run with a value missing, so a fresh checkout cannot deploy anywhere and device details never
enter the repository.

## Gates

- Python (`python:3.11-slim`): ruff with `select = ["ALL"]` and a short justified ignore list
  (ruff's `I` rules replace isort), `ruff format --check`, `mypy --strict`, pytest. 3.11 is the
  floor because Decky's frozen plugin runtime is CPython 3.11.
- TypeScript (`node:22-bookworm-slim`, pnpm pinned via `packageManager`): strict `tsc --noEmit`,
  vitest, the template rollup build. `tsc --noEmit` runs this repository's `typescript`, while the
  rollup template emits through the compiler `@decky/rollup` depends on. The checker therefore runs
  ahead of the emitter, and `make build` is what proves the bundle still compiles.
- Repository: `scripts/check_plugin.py` enforces every row of
  [decky-store-requirements.md](decky-store-requirements.md), plus actionlint and a gitleaks
  scan.

## Versioning

`package.json.version` is the single source of truth: it is what the Decky store reads off a
submitted plugin. Every other copy is derived and drift-checked by `make version-check`:

| File             | Role |
| ---------------- | ---- |
| `package.json`   | owner: the version the store publishes |
| `pyproject.toml` | derived; release-please bumps it in lockstep |
| `plugin.json`    | carries **no** version field; a second copy would drift |

`make version-check VERSION=X.Y.Z` additionally requires the tree to carry that exact version;
the release job uses it to pin a tag to its tree.

## Releases

[release-please](https://github.com/googleapis/release-please) drives versioned releases from
conventional commits: it maintains a release PR that bumps the version files and `CHANGELOG.md`;
merging that PR tags `vX.Y.Z`, and the chained release job checks out the tag, verifies it is a
promoted `main` commit, runs the same `make build` and `make bundle-check`, and publishes the
release with `out/perigee.zip` attached.

The rolling `nightly` pre-release is re-cut on demand (`gh workflow run nightly.yml`) through
the same build targets: one release whose tag is re-pointed and whose single asset is replaced,
so `releases/download/nightly/perigee-nightly.zip` always serves the most recently cut build.
The release title and body name the commit. A nightly is not a version: the tag is not `v*`,
release-please ignores it, and the release is never marked latest. Dispatch it without a new
commit.

## Store submission

The store builds a submitted plugin from the repository itself (added as a git submodule to
[decky-plugin-database](https://github.com/SteamDeckHomebrew/decky-plugin-database)), so the
repository layout, not the release zip, is what must be right. `make repo-check` and
`make bundle-check` encode the store's mechanical expectations;
[decky-store-requirements.md](decky-store-requirements.md) lists each requirement, its source,
and its enforcement.

## A change is done when

1. `make check` is green and `make build` + `make bundle-check` produce a store-valid zip.
2. `make deploy` and `make verify` have run against a real device with clean loader logs.
3. Anything only a human at the screen can confirm (the panel, a sync, a launched stream) is
   confirmed there, and the pull request says which results came from a gate and which came
   from that human check.
4. Every document the change made stale is corrected in the same change.

Steps 2 and 3 need a SteamOS device. Without one, open the pull request on steps 1 and 4 and say
so: the container gates travel with the change and are the same ones CI runs, and a maintainer
with a device runs the device half before the change ships.

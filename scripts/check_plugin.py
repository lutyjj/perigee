#!/usr/bin/env python3
# Mechanical half of docs/decky-store-requirements.md. Every rule here traces to
# a numbered requirement (R1..R16) derived from the Decky CLI, the plugin
# database CI, and the plugin-dev wiki. Two modes:
#
#   repo                     the checkout the store builds from (make repo-check)
#   bundle out/perigee.zip   the artifact that layout must produce (make bundle-check)
#
# Both refuse to guess: an unreadable or malformed file is a failure, never a skip.
from __future__ import annotations

import json
import re
import sys
import tomllib
import zipfile
from collections.abc import Mapping
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# R3: npm-conformant, lowercase and dash-separated.
NPM_NAME = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
# R4: the store publishes this verbatim as version_name.
SEMVER = re.compile(r"^\d+\.\d+\.\d+$")
# R5: the store's upload step fails on "invalid or missing URL scheme".
ABSOLUTE_URL = re.compile(r"^https?://[^\s]+$")

# R17: the plugin API generation Decky loads against.
KNOWN_API_VERSIONS = frozenset({1})
# R6: the only flags decky-loader documents. `_root` is the template's spelling.
KNOWN_FLAGS = frozenset({"debug", "root", "_root"})
# R9: the lockfile version the database CI requires.
LOCKFILE_VERSION = "lockfileVersion: '9.0'"
# R7: either spelling the wiki accepts.
LICENSE_NAMES = ("LICENSE", "LICENSE.MD", "LICENSE.md")
# R14: reviewers require these gone unless actually used.
UNUSED_DIRS = ("backend", "assets", "defaults")

# R12: what the CLI's zip_plugin packages under the single top-level directory.
BUNDLE_FILES = ("LICENSE", "README.md", "main.py", "package.json", "plugin.json")
BUNDLE_DIRS = ("dist", "py_modules")
# R13: build inputs and caches that must never ship.
FORBIDDEN_PARTS = frozenset({".git", "__pycache__", "node_modules", "src"})


def _load_json(path: Path, problems: list[str]) -> dict[str, object] | None:
    if not path.is_file():
        problems.append(f"{path.name} is missing")
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        problems.append(f"{path.name} is not valid JSON: {error}")
        return None
    if not isinstance(data, dict):
        problems.append(f"{path.name} must contain a JSON object")
        return None
    return data


def _require_str(
    data: Mapping[str, object], key: str, source: str, problems: list[str]
) -> str | None:
    value = data.get(key)
    if not isinstance(value, str) or not value.strip():
        problems.append(f"{source}: `{key}` must be a non-empty string")
        return None
    return value


def _require_str_list(
    data: Mapping[str, object], key: str, source: str, problems: list[str]
) -> list[str] | None:
    value = data.get(key)
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        problems.append(f"{source}: `{key}` must be an array of strings")
        return None
    return [item for item in value if isinstance(item, str)]


def check_plugin_json(problems: list[str]) -> None:
    data = _load_json(REPO_ROOT / "plugin.json", problems)
    if data is None:
        return

    # R1: the CLI deserializes exactly these three and hard-fails without them.
    _require_str(data, "name", "plugin.json", problems)
    _require_str(data, "author", "plugin.json", problems)
    flags = _require_str_list(data, "flags", "plugin.json", problems)
    if flags is not None:
        unknown = sorted(set(flags) - KNOWN_FLAGS)
        if unknown:  # R6
            problems.append(f"plugin.json: unknown flags {unknown}")

    # R15: a version here would be a second copy nothing reads.
    if "version" in data:
        problems.append("plugin.json: must not carry a `version` field; package.json owns it")

    publish = data.get("publish")
    if not isinstance(publish, Mapping):
        problems.append("plugin.json: `publish` must be an object")
        return

    # R5: every field the database CI lifts out of plugin.json at upload time.
    _require_str(publish, "description", "plugin.json publish", problems)
    tags = _require_str_list(publish, "tags", "plugin.json publish", problems)
    if tags is not None and not tags:
        problems.append("plugin.json publish: `tags` must not be empty")
    image = _require_str(publish, "image", "plugin.json publish", problems)
    if image is not None and not ABSOLUTE_URL.match(image):
        problems.append(f"plugin.json publish: `image` must be an absolute URL, got {image}")


def check_package_json(problems: list[str]) -> None:
    data = _load_json(REPO_ROOT / "package.json", problems)  # R2
    if data is None:
        return

    name = _require_str(data, "name", "package.json", problems)
    if name is not None and not NPM_NAME.match(name):  # R3
        problems.append(f"package.json: `name` must be lowercase and dash-separated, got {name}")

    version = _require_str(data, "version", "package.json", problems)
    if version is not None and not SEMVER.match(version):  # R4
        problems.append(f"package.json: `version` must be X.Y.Z, got {version}")

    scripts = data.get("scripts")
    # R10: the store's builder runs `pnpm run build` and nothing else.
    if not isinstance(scripts, Mapping) or "build" not in scripts:
        problems.append("package.json: `scripts.build` is what the store's builder runs")

    license_id = _require_str(data, "license", "package.json", problems)  # R7
    if license_id is not None and license_id != "BSD-3-Clause":
        problems.append(f"package.json: `license` should match the LICENSE file, got {license_id}")


def check_repo_layout(problems: list[str]) -> None:
    if not any((REPO_ROOT / name).is_file() for name in LICENSE_NAMES):  # R7
        problems.append("a LICENSE file is required for store submission")
    if not (REPO_ROOT / "README.md").is_file():  # R8
        problems.append("README.md is required; the CLI packages it into the plugin zip")

    lockfile = REPO_ROOT / "pnpm-lock.yaml"
    if not lockfile.is_file():  # R9
        problems.append("pnpm-lock.yaml is required; the store builds with --frozen-lockfile")
    elif LOCKFILE_VERSION not in lockfile.read_text(encoding="utf-8")[:200]:
        problems.append(f"pnpm-lock.yaml must be on {LOCKFILE_VERSION}")

    problems.extend(  # R14
        f"unused `{name}/` directory: reviewers require it removed"
        for name in UNUSED_DIRS
        if (REPO_ROOT / name).is_dir()
    )


def _package_version(problems: list[str]) -> str | None:
    data = _load_json(REPO_ROOT / "package.json", problems)
    if data is None:
        return None
    return _require_str(data, "version", "package.json", problems)


def _pyproject_version(problems: list[str]) -> str | None:
    path = REPO_ROOT / "pyproject.toml"
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError) as error:
        problems.append(f"pyproject.toml is unreadable: {error}")
        return None
    project = data.get("project")
    version = project.get("version") if isinstance(project, Mapping) else None
    if not isinstance(version, str):
        problems.append("pyproject.toml: `project.version` must be a string")
        return None
    return version


def check_versions(expected: str | None, problems: list[str]) -> None:
    owner = _package_version(problems)
    derived = _pyproject_version(problems)
    # R15: package.json owns the version; every other copy is checked against it.
    if owner is not None and derived is not None and owner != derived:
        problems.append(
            f"version drift: package.json is {owner} but pyproject.toml is {derived}",
        )
    if expected is not None and owner is not None and expected != owner:
        problems.append(f"expected version {expected} but the tree carries {owner}")


def _bundle_names(archive: zipfile.ZipFile) -> list[str]:
    return [name for name in archive.namelist() if name and not name.endswith("/")]


def _bundle_root(names: list[str], problems: list[str]) -> str | None:
    roots = sorted({name.split("/")[0] for name in names})
    if len(roots) != 1:
        problems.append(f"the zip must hold exactly one top-level directory, found {roots}")
        return None
    return roots[0]


def _check_bundle_contents(root: str, names: list[str], problems: list[str]) -> None:
    entries = frozenset(names)
    problems.extend(  # R12
        f"bundle is missing {root}/{filename}"
        for filename in BUNDLE_FILES
        if f"{root}/{filename}" not in entries
    )
    for directory in BUNDLE_DIRS:  # R11, R12
        prefix = f"{root}/{directory}/"
        if not any(name.startswith(prefix) for name in names):
            problems.append(f"bundle is missing a non-empty {root}/{directory}/")
    for name in names:  # R13
        offending = FORBIDDEN_PARTS.intersection(name.split("/"))
        if offending:
            problems.append(f"bundle ships {name}, which must not be packaged")


def _check_bundle_metadata(
    archive: zipfile.ZipFile, root: str, names: list[str], problems: list[str]
) -> None:
    # R16: the store reads its metadata out of the artifact, so the artifact's
    # copies must be the ones the repository checks passed on.
    repo_package = _load_json(REPO_ROOT / "package.json", problems)
    repo_plugin = _load_json(REPO_ROOT / "plugin.json", problems)
    if repo_package is None or repo_plugin is None:
        return
    for filename, expected in (("package.json", repo_package), ("plugin.json", repo_plugin)):
        entry = f"{root}/{filename}"
        if entry not in frozenset(names):
            continue
        shipped = json.loads(archive.read(entry).decode("utf-8"))
        if shipped != expected:
            problems.append(f"bundle {entry} differs from the repository copy")
    name = repo_package.get("name")
    if isinstance(name, str) and root != name:
        problems.append(f"bundle directory is `{root}` but package.json names it `{name}`")


def check_bundle(zip_path: Path, problems: list[str]) -> None:
    if not zip_path.is_file():
        problems.append(f"{zip_path} does not exist; run `make build` first")
        return
    with zipfile.ZipFile(zip_path) as archive:
        names = _bundle_names(archive)
        root = _bundle_root(names, problems)
        if root is None:
            return
        _check_bundle_contents(root, names, problems)
        _check_bundle_metadata(archive, root, names, problems)


def _report(mode: str, problems: list[str]) -> int:
    if problems:
        print(f"{mode}: {len(problems)} problem(s)")
        for problem in problems:
            print(f"  - {problem}")
        return 1
    print(f"{mode}: ok")
    return 0


def main(argv: list[str]) -> int:
    problems: list[str] = []
    match argv:
        case ["repo"]:
            check_plugin_json(problems)
            check_package_json(problems)
            check_repo_layout(problems)
            check_versions(None, problems)
            return _report("repo-check", problems)
        case ["version"] | ["version", ""]:
            check_versions(None, problems)
            return _report("version-check", problems)
        case ["version", expected]:
            check_versions(expected, problems)
            return _report("version-check", problems)
        case ["bundle", zip_path]:
            check_bundle(Path(zip_path), problems)
            return _report("bundle-check", problems)
        case _:
            print("usage: check_plugin.py repo | version [X.Y.Z] | bundle <zip>")
            return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

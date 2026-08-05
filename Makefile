# Every toolchain runs in a digest-pinned container: the host installs nothing.
# The version tag names the image, the digest fixes what is actually pulled.
CONTAINER ?= $(shell command -v docker >/dev/null 2>&1 && echo docker || echo podman)
# Decky Loader runs plugins in a frozen CPython 3.11, so 3.11 is the floor the
# gates must hold; the device's own python3 for the CLI harness is newer.
PYTHON_IMAGE := python:3.11-slim@sha256:94c50be2dc994b873b55bc123e95e6dbade08095b3dfd790f51c34de3f08cbb7
NODE_IMAGE := node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436
PNPM_VERSION := 10.34.5

PYTHON_DEV_IMAGE := perigee-python-dev
NODE_DEV_IMAGE := perigee-node-dev

# The device `make deploy` and `make verify` target. Deliberately given no
# defaults: every DEVICE_* value comes from device.env, which is gitignored, so no
# checkout carries anyone's device details. Copy device.env.example to start, or
# pass the variables on the command line. The scripts fail naming the missing
# variable rather than falling back to someone else's device.
-include device.env
DEVICE_ENV := DEVICE='$(DEVICE)' PLUGIN_DIR='$(DEVICE_PLUGIN_DIR)' PLUGIN_USER='$(DEVICE_PLUGIN_USER)'

# Repository hygiene runs maintained linters in the same digest-pinned way: the
# version tag names the tool, the digest fixes what is actually pulled.
ACTIONLINT_IMAGE := rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667
GITLEAKS_IMAGE := zricethezav/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f

# The release tag pins the tree: `make version-check VERSION=X.Y.Z` additionally
# requires the checkout to carry that exact version. Left empty, the target only
# proves the copies agree with each other.
VERSION ?=

# Containers run as the caller so nothing lands in the repo owned by root, with
# every cache redirected into the checkout or a throwaway home.
HOST_USER := $(shell id -u):$(shell id -g)
CONTAINER_BASE := $(CONTAINER) run --rm --user "$(HOST_USER)" --env HOME=/tmp \
	--volume "$(CURDIR):/workspace" --workdir /workspace
CONTAINER_BASE_OUT := $(CONTAINER) run --rm --user "$(HOST_USER)" --env HOME=/tmp \
	--volume "$(CURDIR)/out:/out" --workdir /out
PYTHON_RUN := $(CONTAINER_BASE) \
	--env RUFF_CACHE_DIR=/tmp/ruff --env MYPY_CACHE_DIR=/tmp/mypy \
	--env PYTHONDONTWRITEBYTECODE=1 --env PYTHONPYCACHEPREFIX=/tmp/pycache \
	$(PYTHON_DEV_IMAGE)
# Same image, rooted at the build output so archive paths stay relative to out/.
PYTHON_RUN_OUT := $(CONTAINER_BASE_OUT) $(PYTHON_DEV_IMAGE)
NODE_RUN := $(CONTAINER_BASE) \
	--env npm_config_store_dir=/workspace/.pnpm-store \
	--env npm_config_update_notifier=false --env CI=true \
	$(NODE_DEV_IMAGE)

.PHONY: help check backend-check frontend-check repo-check version-check bundle-check \
	workflow-lint secret-scan format deps build deploy verify \
	images python-dev-image node-dev-image frontend-build stage archive clean

help:
	@echo "make check          lint, type-check and test both components, plus repository hygiene"
	@echo "make repo-check     validate plugin metadata, version drift, workflows and secrets"
	@echo "make version-check  require one version across every file that carries it"
	@echo "                    (VERSION=X.Y.Z additionally pins the tree to that version)"
	@echo "make format         apply ruff fixes and formatting"
	@echo "make build          produce out/perigee/ and out/perigee.zip"
	@echo "make bundle-check   verify out/perigee.zip matches the Decky store's layout"
	@echo "make deploy         deploy the build to the device in device.env and restart plugin_loader"
	@echo "make verify         run the on-device CLI harness against the device's Moonlight config"
	@echo "                    (both read DEVICE_* from device.env; see device.env.example)"

check: repo-check backend-check frontend-check

images: python-dev-image node-dev-image

IMAGE_ARGS := --build-arg PYTHON_IMAGE=$(PYTHON_IMAGE) --build-arg NODE_IMAGE=$(NODE_IMAGE) \
	--build-arg PNPM_VERSION=$(PNPM_VERSION)

python-dev-image:
	$(CONTAINER) build $(IMAGE_ARGS) --target python-dev --tag $(PYTHON_DEV_IMAGE) .

node-dev-image:
	$(CONTAINER) build $(IMAGE_ARGS) --target node-dev --tag $(NODE_DEV_IMAGE) .

backend-check: python-dev-image
	$(PYTHON_RUN) sh -c 'ruff check . && ruff format --check . && mypy && pytest'

# Everything the repository owes the Decky store or itself, none of it component
# specific. Each rule in check_plugin.py cites the requirement it encodes in
# docs/decky-store-requirements.md.
repo-check: python-dev-image version-check workflow-lint secret-scan
	$(PYTHON_RUN) python3 scripts/check_plugin.py repo

version-check: python-dev-image
	$(PYTHON_RUN) python3 scripts/check_plugin.py version $(VERSION)

workflow-lint:
	$(CONTAINER) run --rm --user "$(HOST_USER)" --env HOME=/tmp \
		--volume "$(CURDIR):/repo:ro" --workdir /repo $(ACTIONLINT_IMAGE) -color

# Scan the current contents of every tracked path, without mounting ignored local
# files such as build output or the pnpm store. The tmpfs dies with the
# container, so nothing is left on the host.
secret-scan:
	@git ls-files -z | tar -C "$(CURDIR)" --null -T - -cf - | \
		$(CONTAINER) run --rm -i --user "$(HOST_USER)" --env HOME=/tmp --entrypoint sh \
			--tmpfs /scan:rw,noexec,nosuid,size=32m,mode=1777 \
			$(GITLEAKS_IMAGE) -ec 'tar -xf - -C /scan; exec gitleaks dir /scan --config /scan/.gitleaks.toml --no-banner --no-color --redact'

# The artifact side of the same requirements register: prove out/perigee.zip has
# the shape the store's builder would have produced from this checkout.
bundle-check: python-dev-image
	$(PYTHON_RUN) python3 scripts/check_plugin.py bundle out/perigee.zip

format: python-dev-image
	$(PYTHON_RUN) sh -c 'ruff check --fix . && ruff format .'

deps: node-dev-image
	$(NODE_RUN) pnpm install --frozen-lockfile

frontend-check: deps
	$(NODE_RUN) pnpm run check

frontend-build: deps
	$(NODE_RUN) pnpm run build

build: frontend-build stage archive

stage: python-dev-image
	$(PYTHON_RUN) python3 scripts/stage_bundle.py

archive: python-dev-image
	rm -f out/perigee.zip
	$(PYTHON_RUN_OUT) python3 -m zipfile --create perigee.zip perigee

deploy:
	$(DEVICE_ENV) scripts/deploy.sh

verify:
	$(DEVICE_ENV) MOONLIGHT_CONF='$(DEVICE_MOONLIGHT_CONF)' \
		ONLINE_UUID='$(DEVICE_ONLINE_UUID)' STALE_UUID='$(DEVICE_STALE_UUID)' \
		PLUGIN_SETTINGS_DIR='$(DEVICE_PLUGIN_SETTINGS_DIR)' \
		DISPLAY_MAX_REFRESH_HZ='$(DEVICE_DISPLAY_MAX_REFRESH_HZ)' \
		SHORTCUTS_VDF='$(DEVICE_SHORTCUTS_VDF)' \
		scripts/verify-on-device.sh

clean:
	rm -rf out dist

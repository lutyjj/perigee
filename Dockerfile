ARG PYTHON_IMAGE
ARG NODE_IMAGE
ARG PNPM_VERSION

FROM ${PYTHON_IMAGE} AS python-dev
COPY requirements-dev.txt /tmp/requirements-dev.txt
RUN pip install --no-cache-dir --root-user-action=ignore -r /tmp/requirements-dev.txt
WORKDIR /workspace

FROM ${NODE_IMAGE} AS node-dev
ARG PNPM_VERSION
# Bake the package manager into a world-readable corepack home so the container
# still resolves it when it runs as the caller with a throwaway HOME.
ENV COREPACK_HOME=/opt/corepack
RUN mkdir -p "$COREPACK_HOME" && corepack enable \
    && corepack prepare pnpm@${PNPM_VERSION} --activate \
    && chmod -R a+rX "$COREPACK_HOME"
WORKDIR /workspace

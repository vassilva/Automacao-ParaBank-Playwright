# Jenkins agent for this project: the pinned Playwright image (Node, Chromium and its system
# dependencies, matching @playwright/test 1.63.0 in package.json) plus the Docker CLI, so stages
# can build the ParaBank image and run its environments through the Jenkins host's Docker daemon
# (the socket is mounted by the Jenkinsfile).
#
# Keep the Playwright version in step with package.json, as in the other QA projects.
FROM docker:29.7.2-cli@sha256:3f4743208d2338c934d7b8bcfbe1bb54c0b2355c510ad5e0f31c0c4a54bd704e AS docker-cli

FROM mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27

# Statically linked binaries: the CLI, plus buildx (BuildKit features used by
# docker/parabank/Dockerfile: cache mounts, ADD --checksum) and compose.
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-buildx
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose

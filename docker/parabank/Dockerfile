# ParaBank built from a recorded commit of the official source, as an immutable runtime image.
#
#   source commit (docker/parabank/source.env)
#     -> Maven build with the project's own tests (mvn clean install)
#     -> parabank.war
#     -> Tomcat runtime image labelled with the commit
#
# Build it with `npm run app:build` (scripts/build-parabank-image.ts), not by hand: the script
# passes the pinned commit, refuses to overwrite an existing tag and records provenance.
# The build context is this directory only, so nothing from the QA repository (node_modules, .env,
# reports) can end up in the image.

# Toolchains pinned by digest. Maven >= 3.9.0 and Java 21 are what the ParaBank POM requires;
# the runtime base is the one named by ParaBank's own Dockerfile.
ARG MAVEN_IMAGE=maven:3.9.16-eclipse-temurin-21-noble@sha256:99e61abcff91a9b1333463bd8451fb18495d6eba9250ac66a338b518f8278320
ARG TOMCAT_IMAGE=tomcat:11.0.26-jre25-temurin-noble@sha256:8c40d472c7f65041a8735e241ab31ddcb73c11576bcdf19305a81308cb12bd25

# --- toolchain: everything the build needs except the source. Rarely changes, stays cached.
FROM ${MAVEN_IMAGE} AS toolchain

# Prerequisite of the official build: ParaBank's integration tests (ParabankDemoIT) drive a
# headless Chrome through Selenium. Build stage only: none of this reaches the runtime image.
# The browser and driver are a pinned Chrome for Testing release, verified by checksum, and
# Selenium Manager is kept offline so it uses them instead of downloading whatever is current.
ARG CHROME_FOR_TESTING_VERSION=154.0.8037.92
ADD --checksum=sha256:ff43322f335e436b2f4dcdfeeec5db032299e335a7e8c1c618b326e100ce8732 \
    https://storage.googleapis.com/chrome-for-testing-public/${CHROME_FOR_TESTING_VERSION}/linux64/chrome-linux64.zip \
    /tmp/chrome-linux64.zip
ADD --checksum=sha256:cc99c87cfd10e1da1b7d42ea9800a211df279f5a47c19a55b02c927cb9f606c2 \
    https://storage.googleapis.com/chrome-for-testing-public/${CHROME_FOR_TESTING_VERSION}/linux64/chromedriver-linux64.zip \
    /tmp/chromedriver-linux64.zip
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      unzip \
      ca-certificates fonts-liberation libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 \
      libcairo2 libcups2t64 libdbus-1-3 libdrm2 libexpat1 libfontconfig1 libgbm1 \
      libglib2.0-0t64 libgtk-3-0t64 libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 \
      libvulkan1 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 \
      libxfixes3 libxi6 libxkbcommon0 libxrandr2 libxrender1 libxshmfence1 libxss1 libxtst6 \
 && rm -rf /var/lib/apt/lists/* \
 && unzip -q /tmp/chrome-linux64.zip -d /opt \
 && unzip -q /tmp/chromedriver-linux64.zip -d /opt \
 && ln -s /opt/chromedriver-linux64/chromedriver /usr/local/bin/chromedriver \
 && rm /tmp/chrome-linux64.zip /tmp/chromedriver-linux64.zip
# Chrome's sandbox needs unprivileged user namespaces, which the build container's seccomp
# profile blocks ("No usable sandbox!"), and ParaBank's DriverFactory does not pass --no-sandbox.
# Instead of modifying the upstream test, the system "google-chrome" that Selenium discovers is a
# wrapper adding that flag. The browser only ever visits the build-time Tomcat on localhost.
RUN printf '#!/bin/sh\nexec /opt/chrome-linux64/chrome --no-sandbox "$@"\n' > /usr/bin/google-chrome \
 && chmod 0755 /usr/bin/google-chrome
ENV SE_OFFLINE=true

# Build as an unprivileged user (least privilege for the whole Maven build).
RUN groupadd --gid 10001 builder \
 && useradd --create-home --uid 10001 --gid 10001 builder \
 && mkdir -p /src /out && chown builder:builder /src /out
USER builder
ENV MAVEN_CONFIG=/home/builder/.m2
WORKDIR /src

# --- build: source checkout + official Maven build with ParaBank's tests. CI forces this stage
# to run on every pipeline build (`--no-cache-filter build`), so the application tests really run.
FROM toolchain AS build
ARG PARABANK_SOURCE_REPO
ARG PARABANK_SOURCE_COMMIT

# Fetch exactly the pinned commit and prove that is what was checked out.
RUN test -n "${PARABANK_SOURCE_REPO}" && test -n "${PARABANK_SOURCE_COMMIT}" \
 && git init -q . \
 && git remote add origin "${PARABANK_SOURCE_REPO}" \
 && git fetch -q --depth 1 origin "${PARABANK_SOURCE_COMMIT}" \
 && git checkout -q FETCH_HEAD \
 && test "$(git rev-parse HEAD)" = "${PARABANK_SOURCE_COMMIT}" \
 && echo "Building ParaBank at $(git rev-parse HEAD)"

# The official build command, with the project's unit and integration tests (no -DskipTests).
# The cache mount only reuses downloaded dependencies between builds; it is not part of the image.
# sharing=locked: concurrent builds on one Docker host wait for each other instead of corrupting it.
RUN --mount=type=cache,target=/home/builder/.m2,uid=10001,gid=10001,sharing=locked \
    mvn --batch-mode --no-transfer-progress clean install

# Explode the WAR as ParaBank's own Dockerfile does (its embedded HSQLDB writes under WEB-INF/db),
# and record the artifact checksum for provenance.
# The application test totals are taken from Maven's own JUnit XML reports and travel with the
# image, so the evidence is the same whether or not the Maven layer came from the build cache.
RUN mkdir -p /out/parabank /out/provenance \
 && cd /out/parabank && jar xf /src/target/parabank.war \
 && cd /src/target && sha256sum parabank.war > /out/provenance/parabank.war.sha256 \
 && for kind in surefire failsafe; do \
      cat ${kind}-reports/TEST-*.xml | awk -v kind="${kind}" ' \
        match($0, /<testsuite [^>]*>/) { s = substr($0, RSTART, RLENGTH); \
          n = split("tests failures errors skipped", k, " "); \
          for (i = 1; i <= n; i++) if (match(s, " " k[i] "=\"[0-9]+\"")) { \
            v = substr(s, RSTART, RLENGTH); gsub(/[^0-9]/, "", v); t[k[i]] += v } } \
        END { printf "%s tests=%d failures=%d errors=%d skipped=%d\n", kind, \
              t["tests"], t["failures"], t["errors"], t["skipped"] }'; \
    done > /out/provenance/application-tests.txt \
 && printf 'repository=%s\ncommit=%s\n' "${PARABANK_SOURCE_REPO}" "${PARABANK_SOURCE_COMMIT}" \
      > /out/provenance/source.txt

FROM ${TOMCAT_IMAGE}
ARG TOMCAT_IMAGE
ARG PARABANK_SOURCE_REPO
ARG PARABANK_SOURCE_COMMIT

LABEL org.opencontainers.image.title="ParaBank (source-built)" \
      org.opencontainers.image.description="ParaBank built from the recorded official source commit for controlled QA environments" \
      org.opencontainers.image.source="${PARABANK_SOURCE_REPO}" \
      org.opencontainers.image.revision="${PARABANK_SOURCE_COMMIT}" \
      org.opencontainers.image.version="${PARABANK_SOURCE_COMMIT}" \
      org.opencontainers.image.base.name="${TOMCAT_IMAGE}"

COPY --from=build /out/parabank /usr/local/tomcat/webapps/parabank
# Outside webapps/, so it is never served over HTTP.
COPY --from=build /out/provenance /opt/parabank/provenance

# Only the web port is needed by consumers; JMS (61616) and HSQLDB (9001) stay internal.
EXPOSE 8080

#!/bin/sh
# Builds the ParaBank serial-queue plugin in a Maven container (no local JDK or Maven needed):
#   sh jenkins/parabank-serial-queue-plugin/build.sh   ->   target/parabank-serial-queue.hpi
# Maven downloads go to MAVEN_REPO (default: ~/.m2/repository), never into the repository.
set -eu
export MSYS_NO_PATHCONV=1
HERE=$(cd "$(dirname "$0")" && { pwd -W 2>/dev/null || pwd; })
M2=${MAVEN_REPO:-$HOME/.m2/repository}
mkdir -p "$M2"
M2=$(cd "$M2" && { pwd -W 2>/dev/null || pwd; })
IMAGE=${MAVEN_IMAGE:-maven:3.9.16-eclipse-temurin-21-noble}
docker run --rm -v "$HERE:/src" -v "$M2:/root/.m2/repository" -w /src "$IMAGE" \
  mvn -B -q -ntp package -Dmaven.test.skip=true
ls -l "$HERE/target/parabank-serial-queue.hpi"

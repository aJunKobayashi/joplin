#! /bin/bash
# shellcheck shell=bash
set -eu

gSwaggerFile="swagger.yaml"
gSwaggerPath="../yaml/${gSwaggerFile}"

main() {
  set +eu
  mkdir output
  set -eu
  docker run --rm -v "$(pwd)/${gSwaggerPath}:/local/swagger.yaml" -v "$(pwd)/output:/tmp" swaggerapi/swagger-codegen-cli generate \
    -i /local/swagger.yaml \
    -l typescript-fetch \
    -DsupportsES6=true \
    -o /tmp
}

main

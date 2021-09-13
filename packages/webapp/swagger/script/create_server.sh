#! /bin/bash
# shellcheck shell=bash
set -eu

gSwaggerFile="swagger.yaml"
gSwaggerPath="../yaml/${gSwaggerFile}"

main() {
  set +eu
  mkdir ../server_src
  set -eu
  docker run --rm -v "$(pwd)/${gSwaggerPath}:/local/swagger.yaml" -v "$(pwd)/../server_src:/tmp" swaggerapi/swagger-codegen-cli generate \
    -i /local/swagger.yaml \
    -l nodejs-server \
    -DsupportsES6=true \
    -o /tmp

  #   docker run --rm -v "$(pwd)/${gSwaggerPath}:/local/swagger.yaml" -v "$(pwd)/output:/tmp" swaggerapi/swagger-codegen-cli help generate
}

main

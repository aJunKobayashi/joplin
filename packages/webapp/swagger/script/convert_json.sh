#! /bin/bash
# shellcheck shell=bash
set -eu

gSwaggerFile="swagger.yaml"
gSwaggerPath="../yaml/${gSwaggerFile}"
gTmpFolder="./tmp"
gDataJs="data.js"

main() {
  echo "converting swagger.yaml to json...."

  set +eu
  mkdir "${gTmpFolder}"
  set -eu

  cp -f "${gSwaggerPath}" "${gTmpFolder}"
  docker run -v "$(pwd)/${gTmpFolder}:/docs/tmp" swaggerapi/swagger-codegen-cli generate -i /docs/tmp/${gSwaggerFile} -l swagger -o /docs/tmp
  cp -f "${gTmpFolder}/swagger.json" "."
  echo "restAPIDefinition = " >"${gDataJs}"
  cat "${gTmpFolder}/swagger.json" >>"${gDataJs}"
  mv "${gDataJs}" "../html/${gDataJs}"
  rm -rf "${gTmpFolder}"
}
main

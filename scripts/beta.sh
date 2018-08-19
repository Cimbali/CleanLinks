#!/bin/bash
set -e

# use GNU sed to 1) increment version by one and add -beta0 if there is no beta, 2) increment -betaN
sed -ri addon/manifest.json \
	-e "s/(\s*\"version\"\s*:\s*\")([0-9.]+\.)([0-9]+)(\"[,} ]*)/echo '\1\2'\$((\3+1))'-beta0\4'/e" \
	-e "s/(\s*\"version\"\s*:\s*\"[0-9.]+-beta)([0-9]+)(\"[,} ]*)/echo '\1'\$((\2+1))'\3'/e"

# get name: ${addon name, to lower, _ between words}-${version}
fname=$( (
grep -m1 "name" addon/manifest.json | tr '[:upper:] ' '[:lower:]_'
grep -m1 '"version"' addon/manifest.json
) | cut -d'"' -f4 | paste -sd-)

# build the extension
web-ext -s ./addon -a ./dist build

# rename it to xpi
mv dist/${fname}.zip dist/${fname}.xpi

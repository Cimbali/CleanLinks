#!/bin/bash

cd `git rev-parse --show-toplevel`
trap 'rm -f "$tmp"' INT QUIT TERM EXIT

tmp="${TMPDIR:-/tmp}/messages_$$.json"

add_placeholders='with_entries(
	([.value.message // "" | match("\\$([A-Z_]+)\\$"; "gi").captures[].string | ascii_downcase] |
		with_entries({key: .value, value: {"content": (.key + 1) | tostring | ("$" + .)}})) as $placeholders |
		.value += if $placeholders | length != 0 then {placeholders: $placeholders} else {} end)'

addon_msg='{"addon_description": {"message": "Converts obfuscated/nested links to genuine clean links"}'
to_poeditor='to_entries | map({term: .key, definition: .value.message})'
from_poeditor='map({key: .term, value: {message: .definition}}) | map(.value.message = (.value.message // empty)) | from_entries'

extract() {
	{
	# Also add the texts from addons.mozilla.org
	echo This Extension converts obfuscated/nested links to genuine/normal plain clean links. For example:
	echo CleanLinks protects your private life, by automatically detecting and skipping redirect pages, that track you on your way to the link you really wanted. Tracking parameters \(e.g. utm_\* or fbclid\) are also removed.
	echo For maximum privacy, rules are maintained and editable locally \(with decent defaults distributed in the add-on\). \<strong\>CleanLinks will break some websites\</strong\> and you will need to \<strong\>manually whitelist\</strong\> these URLs for them to work. This can be done easily via the menu from the CleanLinks icon.

	find addon/ -name '*.js' -exec grep -hPo "(?<=_\\((['\"])).*(?=\\1\\s*[,\\)])" {} +
	find addon/ -name '*.html' -exec grep -hPo '\bi18n_(text|title|placeholder)\="\K([^"]|\\")+(?=")' {} +
	find addon/ -name '*.html' -exec grep -zhPo '\bi18n_html\="\K([^"]|\\")+(?=")' {} + |
		sed -zE 's/\s+/ /g;s/&lt;/</g;s/&gt;/>/g;s/&quot;/"/g;s/^\s*//;s/\s*$//' | xargs -0 -L1
	} | sort -u | sed 's/"/\\&/g;s/.*/"&",/;1s/^/[/;$s/,$/]/' |
		jq  -S 'map({key: ., value: {message: .}}) | from_entries' | jq  --argjson desc "$addon_msg" '$desc + .' |
		jq "$add_placeholders" > addon/_locales/en_US/messages.json
}
#
upload() {
    printf 'Uploading new strings to poeditor: '
	jq -S "$to_poeditor" addon/_locales/en_US/messages.json > "$tmp"
    curl -sX POST https://api.poeditor.com/v2/projects/upload \
          -F api_token="$poeditor_api_token" \
          -F id="323337" -F updating="terms" -F file=@"$tmp" \
          | jq -r '.response.message'
}

languages() {
    curl -sX POST https://api.poeditor.com/v2/languages/list \
          -F api_token="$poeditor_api_token" \
          -F id="323337" | jq -r 'select(.response.code == "200") | .result.languages[].code'
}

download() {
    lang=$1
    printf "Updating %s:\n" "$lang"

    url=`curl -sX POST https://api.poeditor.com/v2/projects/export \
          -F api_token="$poeditor_api_token" \
          -F id="323337" -F language="$lang" -F type="json" \
        | jq -r 'select(.response.code == "200") | .result.url'`

	if test -d addon/_locales/${lang/-/_}; then
		f="addon/_locales/${lang/-/_}/messages.json"
	else
		f="`find addon/_locales/ -maxdepth 1 -type d -name "${lang}_*"`/messages.json"
	fi

    test -n "$url" && curl -s "$url" | jq "$from_poeditor" | jq "$add_placeholders" > "$f"
}

getpass() {
    if test -z "$poeditor_api_token"; then
        poeditor_api_token=`$SSH_ASKPASS "Password for 'https://api.poeditor.com/projects/v2/': "`
    fi
}


if [ $# -eq 0 ]; then
    echo "Usage: $0 <command>"
    echo "Where command is one of: upload, languages, download, progress, contributors"
    echo "requires curl and jq"
fi

while [ $# -gt 0 ]; do
    if test "$1" = "upload"; then
        getpass
		extract
        upload
    elif test "$1" = "languages"; then
        getpass
        languages
    elif test "$1" = "download"; then
        getpass
        for lang in `languages`; do
            download $lang
        done
    else
        echo "Unrecognised command $1 use one of: upload, languages, download, progress, contributors"
        exit 1
    fi
    shift
done

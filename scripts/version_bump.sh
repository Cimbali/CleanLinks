#!/bin/bash
set -e

# get current version and line number from json packages
IFS=: read n_pack l_pack < <(git show HEAD:package.json        | grep -nm1 '\"version\"')
IFS=: read n_mnfs l_mnfs < <(git show HEAD:addon/manifest.json | grep -nm1 '\"version\"')

# parse version (from package) and increment its last item
IFS=. read -a version < <(echo "$l_pack" | cut -d'"' -f4)
last=$(( ${#version[*]} - 1 ))
new_version="${version[*]::$last} $(( version[$last] + 1 ))"

while :; do
	read -p "New version number? Empty means v${new_version// /.}: " prompted_version
	if [[ "$prompted_version" =~ ^(v?[0-9]+[ .][0-9]+[ .][0-9]+)?$ ]]; then
		[[ -n "$prompted_version" ]] && new_version=${prompted_version#v}
		break
	fi
done

# make a patch that replaces the current version with the newer one
patch=$(cat << EOF
diff --git a/addon/manifest.json b/addon/manifest.json
index b2243fa..a5ece0d 100644
--- a/addon/manifest.json
+++ b/addon/manifest.json
@@ -$n_mnfs +$n_mnfs @@
-$l_mnfs
+$(echo "$l_mnfs" | cut -d: -f1): "${new_version// /.}",
diff --git a/package.json b/package.json
index 168f72c..ab8983e 100644
--- a/package.json
+++ b/package.json
@@ -$n_pack +$n_pack @@
-$l_pack
+$(echo "$l_pack" | cut -d: -f1): "${new_version// /.}",
EOF
)

# try to apply patch to files (might fail)
echo "$patch" | patch -fp1 --no-backup-if-mismatch -r- || echo "... continuing anyway"

# apply patch staged (should always work)
echo "$patch" | git apply --cached --unidiff-zero -

git commit

git tag v${new_version// /.}

#git push origin && git push --tags

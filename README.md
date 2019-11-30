# CleanLinks Mozilla Firefox Extension

## What does it do?
This Extension automatically detects and converts obfuscated/nested links to genuine/normal plain clean links.

_Eg:_

- <http://www.foobar.com/track=ftp://gnu.org> ➠ <ftp://gnu.org/>

- <http://example.com/aHR0cDovL3d3dy5nb29nbGUuY29t> ➠ <http://www.google.com>

- javascript:window.open('http://somesite.com') ➠ <http://somesite.com/>

It also allows to remove affiliate/tracking tags from URLs by the use of configurable patterns, being the most common used ones defined by default (ie, UTM, AFF, REF, etc)

You can [test the current (master) link cleaning code online](https://cimbali.github.io/CleanLinks/), by pasting a link in the text area and clicking the "Clean it!" button.

## More details

This add-on protects your private life, by skipping intermediate pages that track you while redirecting you to your destination, or that divulge your current page while making requests. Any request that contains another URL is considered fishy, and skipped in favor of the target page (for foreground requests) or dropped (for background requests). A whitelist manages the pages and websites that have legitimate uses of such redirects. On links cleaned, tracking parameters (e.g. utm_* or fbclid) are also removed,


Currently, the whitelist is populated with a few sensible defaults, and must be maintained manually by each user as they encounter pages that break. A quick access to the last requests that were cleaned is available by clicking on the add-on icon. In this popup, all recently cleaned links for the tab appear, and these can be added to the whitelist definitively (“Whitelist Selection” button) or for once only (“Open Un-cleaned Link” button).

Another important configuration option is the choice of cleaning only links that are top-level (i.e. the main page being visited, for example from a clicked link) or whether all the traffic must be analyzed.


In the future, a set of rules will be maintained centrally, possibly in collaboration with other similar addon communities, so you may submit whitelist suggestions as issues.

## Where can you get it?
### From the AMO page:

<https://addons.mozilla.org/addon/clean-links-webext/>

### Straight from this repo:

Useful if you want to help testing for example.

- Either get [web-ext](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/Getting_started_with_web-ext), and run `web-ext run` in the source code directory.

- Alternately, [temporarily load the add-on from `about:debugging#addons`](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/Temporary_Installation_in_Firefox), by ticking "Enable add-on debugging", clicking "Load Temporary Add-on" and selecting the `manifest.json` file from the source code directory.

- Finally, you can build the add-on using `yarn bundle` or `web-ext -s ./addon -a ./dist build` in this repository’s top-level directory, and [install the add-on from the file that was generated](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Distribution_options/Sideloading_add-ons#Using_Install_Add-on_From_File).

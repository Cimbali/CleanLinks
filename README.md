## CleanLinks Mozilla Firefox Extension

This Extension is designed to convert obfuscated/nested links to genuine/normal plain clean links.

_Eg:_

- <http://www.foobar.com/track=ftp://gnu.org> ➠ <ftp://gnu.org/>

- <http://example.com/aHR0cDovL3d3dy5nb29nbGUuY29t> ➠ <http://www.google.com>

- javascript:window.open('http://somesite.com') ➠ <http://somesite.com/>

It also allows to remove affiliate/tracking tags from URLs by the use of configurable patterns, being the most common used ones defined by default (ie, UTM, AFF, REF, etc)

You can [test the current (master) link cleaning code online](https://cimbali.github.io/CleanLinks/), by pasting a link in the text area and clicking the "Clean it!" button.

#### Get it from the AMO page:

<https://addons.mozilla.org/addon/clean-links-webext/>


#### If you want to help testing by installing Clean Links straight from this repo:

- Either get [web-ext](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/Getting_started_with_web-ext), and run `web-ext run` in the source code directory.

- Alternately, [temporarily load the add-on from `about:debugging#addons`](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/Temporary_Installation_in_Firefox), by ticking "Enable add-on debugging", clicking "Load Temporary Add-on" and selecting the `manifest.json` file from the source code directory.

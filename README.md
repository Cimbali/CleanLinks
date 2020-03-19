# CleanLinks Mozilla Firefox Extension ![rating on addons.mozilla.org via shields.io][amo_stars] ![users on addons.mozilla.org via shields.io][amo_users]

[![Install it from addons.mozilla.org][get_addon_image]][addon]


## What does it do?
CleanLinks protects your private life, by automatically detecting and skipping redirect pages, that track you on your way to the link you really wanted. Tracking parameters (e.g. utm\_\* or fbclid) are also removed.

_Eg:_
- <http://www.foobar.com/track=ftp://gnu.org> ➠ <ftp://gnu.org/>
- <http://example.com/aHR0cDovL3d3dy5nb29nbGUuY29t> ➠ <http://www.google.com>
- javascript:window.open('http://somesite.com') ➠ <http://somesite.com/>

For maximum privacy, rules are maintained and editable locally (with decent defaults distributed in the add-on). CleanLinks will break some websites and you will need to manually whitelist these URLs for them to work. This can be done easily via the menu from the CleanLinks icon.

You can [test the current (master) link cleaning code online](https://cimbali.github.io/CleanLinks/), by pasting a link in the text area and clicking the "Clean it!" button.

## More details

This add-on protects your private life, by skipping intermediate pages that track you while redirecting you to your destination (1), or that divulge your current page while making requests (2). Any request that contains another URL is considered fishy, and skipped in favor of the target page (for foreground requests) or dropped (for background requests). A whitelist manages the pages and websites that have legitimate uses (3) of such redirects.

Some illustrative examples are:
1. Facebook tracks all the outgoing links by first sending you to the page `https://l.facebook.com/l.php?u=<the actual link here>` which then redirects you to the URL.
2. Analytics report the page you are on, for example google analystics uses `https://www.google-analytics.com/collect?dl=<your current page>&<more info on what you do>`
3. Logging in through openid requires to pass the original URL so you can return to that page once the login is performed, e.g. `https://github.com/login/oauth/authorize?redirect_uri=<URL to the previous page>&<more parameters for the request>`

All these embedded links are detected automatically. Links of type 1 should be redirected to their destination, those of type 2 (identified by the fact they are not “top-level” requests) should be dropped, and those of type 3 allowed through a witelist.

The whitelist is populated with a few sensible defaults, and must be maintained manually by each user as they encounter pages that break. A quick access to the last requests that were cleaned is available by clicking on the add-on icon. In this popup, all recently cleaned links for the tab appear, and these can be added to the whitelist definitively (“Whitelist Embedded URL” button) or for once only (“Open Un-cleaned Link” button).

Other tracking data can be added to the URLs to follow your behaviour online. These can be for example `fbclid=` or `utm_campain=` query parameters, or `/ref=` in the pathname of the URL on amazon.
Those can not be detected automatically, so CleanLinks has a set of rules (the same that maintains the embedded URL whitelist) that specifies which data is used for tracking and should be removed from URLs.


## How can I help?

Be part of the open-source community that helps each other browse safer and more privately !

Bing part of a community means being respectful of everyone and keeping this environment friendly, welcoming, and harrasment-free.
Abusive behaviour will not be tolerated, and can be reported by email at me@cimba.li − wrongdoers may be permanently banned from interacting with CleanLinks.

### You can help by reporting issues!

Any reports are welcome, including suggestions to improve and maintain the default rules that CleanLinks uses.

### You can help by contributing to the code!

Maintaining even a small addon like CleanLinks is in fact very time consuming, so every little bit helps!

### You can help by contributing to translations!

You can improve translations or add a new language [on CleanLink’s POEditor page](https://poeditor.com/join/project/H3u6Cttc4j), where the strings will directly be imported into the add-on at the next release.

This is the current status of translations:

![Chinese: 22%](https://img.shields.io/badge/%F0%9F%87%A8%F0%9F%87%B3%20Chinese-22%25-f60)
![Chinese (TW): 22%](https://img.shields.io/badge/%F0%9F%87%B9%F0%9F%87%BC%20Chinese%20%28TW%29-22%25-f60)
![French: 92%](https://img.shields.io/badge/%F0%9F%87%AB%F0%9F%87%B7%20French-92%25-3f0)
![German: 22%](https://img.shields.io/badge/%F0%9F%87%A9%F0%9F%87%AA%20German-22%25-f60)
![Spanish: 22%](https://img.shields.io/badge/%F0%9F%87%AA%F0%9F%87%B8%20Spanish-22%25-f60)


## Why are the requested permissions required?

The permissions are listed [in the manifest file](https://github.com/Cimbali/CleanLinks/blob/master/addon/manifest.json#L14)
and [described in the API documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/permissions#API_permissions).
Here is a breakdown of why we need each of the requested permissions:

| Permission                                             | Show (on addons.mozilla.org) as     | Needed for                                      |
| ------------------------------------------------------ | ----------------------------------- | ----------------------------------------------- |
| clipboardWrite                                         | _Input data to the clipboard_       | Copying cleaned links from the context menu     |
| contextMenus                                           | Not shown                           | Copying cleaned links from the context menu     |
| alarms                                                 | Not shown                           | Automatically saving options                    |
| webRequest                                             | _Access your data for all websites_ | Clean links while they are accessed             |
| webRequestBlocking                                     | _Access your data for all websites_ | Clean links while they are accessed             |
| \<all\_urls\>                                          | _Access your data for all websites_ | Clean javascript links, highlight cleaned links |
| storage                                                | Not shown                           | Store rules and preferences                     |
| <https://publicsuffix.org/list/public_suffix_list.dat> | Not shown                           | Identifying public suffixes (e.g. `.co.uk`)     |



## In which other ways can you get it?

Except from the AMO page <https://addons.mozilla.org/addon/clean-links-webext/>, you can also get the addon straight from this repo.
This is useful if you want to help testing for example.

- Either get [web-ext](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/Getting_started_with_web-ext), and run `web-ext run` in the `addon/` source code directory.

- Alternately, [temporarily load the add-on from `about:debugging#addons`](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/Temporary_Installation_in_Firefox), by ticking "Enable add-on debugging", clicking "Load Temporary Add-on" and selecting the `manifest.json` file from the source code directory.

- Finally, you can build the add-on using `yarn bundle` or `web-ext -s ./addon -a ./dist build` in this repository’s top-level directory, and [install the add-on from the file that was generated](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Distribution_options/Sideloading_add-ons#Using_Install_Add-on_From_File).



[addon]: https://addons.mozilla.org/addon/clean-links-webext/
[license]: https://img.shields.io/github/license/Cimbali/CleanLinks.svg?style=popout-square&logo=mozilla&colorA=333333&colorB=coral
[amo_stars]: https://img.shields.io/amo/stars/clean-links-webext.svg?style=popout-square&logo=mozilla-firefox
[amo_users]: https://img.shields.io/amo/users/clean-links-webext.svg?style=popout-square&logo=mozilla-firefox&colorB=blue
[get_addon_image]: https://cimbali.github.io/CleanLinks/get-the-addon-small.png

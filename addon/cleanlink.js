/* ***** BEGIN LICENSE BLOCK *****
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/
 *
 * The Original Code is CleanLinks Mozilla Extension.
 *
 * The Initial Developer of the Original Code is
 * Copyright (C)2012 Diego Casorran <dcasorran@gmail.com>
 * All Rights Reserved.
 *
 * ***** END LICENSE BLOCK ***** */

const _ = browser.i18n.getMessage
const attr_cleaned_count = 'data-cleanedlinks';
const attr_cleaned_link = 'data-cleanedlink';
const str_cleanlink_touch = "\n\n- " + _("browser_touch");

const title = browser.runtime.getManifest().name;
const version = browser.runtime.getManifest().version;
const homepage = browser.runtime.getManifest().homepage_url;
const copyright = browser.runtime.getManifest().author;

const icon_default = '';
const icon_disabled = '-';
const icon_fire = '~';
const icon_green = '!';

const same_tab = 0;
const new_tab = 1;
const new_window = 2;

const javascript_link = /^javascript:.+(["'])(.*?https?(?:\:|%3a).+?)\1/
const decoded_scheme_url = /(?:\b|=)([a-z]{2,}:\/\/.+)$/i					// {word-break or "="}[a-z]+://{more stuff}
const decoded_www_url = /(?:^|[^\/]\/)(www\..+)$/i							// {begin or [not-slash]/}www.{more stuff}
const base64_encoded_url = /\b(?:aHR0|d3d3)[A-Z0-9+=\/]+/i					// {base64-encoded http or www.}{more valid base64 chars}
const trailing_invalid_chars = /([^-a-z0-9~$_.+!*'(),;:@&=\/?%]|%(?![0-9a-fA-F]{2})).*$/i

var prefValues = {
	enabled   : true,
	skipwhen  : new RegExp('/ServiceLogin|imgres\\?|searchbyimage\\?|watch%3Fv|auth\\?client_id|signup|bing\\.com/widget|'
		+ 'oauth|openid\\.ns|\\.mcstatic\\.com|sVidLoc|[Ll]ogout|submit\\?url=|magnet:|google\\.com/recaptcha/|'
		+ '\\.google\\.[a-z.]+\\/search\\?(.+&)?q=http|^https?:\\/\\/www\\.amazon\\.[a-z.]+\\/.*\\/voting\\/cast\\/'),
	remove    : /\b((?:ref|aff)\w*|utm_\w+|(?:merchant|programme|media)ID)|fbclid/,
	skipdoms  : ['accounts.google.com', 'docs.google.com', 'translate.google.com',
				'login.live.com', 'plus.google.com', 'twitter.com',
				'static.ak.facebook.com', 'www.linkedin.com', 'www.virustotal.com',
				'account.live.com', 'admin.brightcove.com', 'www.mywot.com',
				'webcache.googleusercontent.com', 'web.archive.org', 'accounts.youtube.com',
				'signin.ebay.com'],
	highlight : true,                                          // highlight cleaned links
	hlstyle   : 'background:rgba(252,252,0,0.6); color: #000', // style for highlighted cleaned links
	progltr   : true,                                          // http-on-examine-response: clean links on Location: redirect headers?
	httpall   : true,                                          // http capture all traffic, not just main frame
	cbc       : true,                                          // Context menus to clean links
	gotarget  : false,                                         // whether we respect target attributes on links that are being cleaned
	textcl    : false,                                         // search for & clean links in selected text
	ignhttp   : false,                                         // ignore non-http(s?) links
	cltrack   : true,                                          // whether we track the link cleaning
	switchToTab : true,                                        // Should be a copy of the browser preference: switch to a new tab when we open a link?
	notifications: false,                                      // Send notifications when tracking links?
	notiftime : 800,                                           // Duration of a notification in ms
	debug     : false
}


function log()
{
	if (prefValues.debug) console.log.apply(null, arguments)
}


function serializeOptions()
{
	return Object.keys(prefValues).reduce((serializedVals, param) =>
	{
		if (prefValues[param] instanceof RegExp)
			serializedVals[param] = prefValues[param].source;
		else if (Array.isArray(prefValues[param]))
			serializedVals[param] = prefValues[param].join(',');
		else
			serializedVals[param] = prefValues[param];

		return serializedVals;
	}, {});
}


function upgradeOptions(options)
{
	if ('httpomr' in options) {
		options['httpall'] = options['httpomr'];
		delete options['httpomr'];
	}
}


function loadOptions()
{
	var check_storages = key => new Promise(found =>
	{
		browser.storage.local.get(key).then(data =>
		{
			if (key in data)
			{
				browser.storage.local.clear();
				browser.storage.sync.set(data);
				found(data);
			}
			else
				browser.storage.sync.get(key).then(data => found(data))
		})
	});

	// return the promise so it can be chained
	return check_storages('configuration').then(data =>
	{
		if ('configuration' in data) {
			upgradeOptions(data.configuration);

			for (var param in data.configuration) {
				if (typeof prefValues[param] == 'number')
					prefValues[param] = parseInt(data.configuration[param]);
				else if (typeof prefValues[param] == 'boolean')
				{
					prefValues[param] = data.configuration[param] === true
									|| data.configuration[param] === 'true'
									|| data.configuration[param] === 'on';
				}
				else if (typeof prefValues[param] == 'string')
					prefValues[param] = data.configuration[param] || '';
				else if (prefValues[param] instanceof RegExp)
				{
					try {
						prefValues[param] = new RegExp(data.configuration[param] || '.^');
					} catch (e) {
						log('Error parsing regex', (data.configuration[param] || '.^'), ':', e.message);
					}
				}
				else if (Array.isArray(prefValues[param]))
					prefValues[param] = (data.configuration[param] || '').split(',').map(s => s.trim()).filter(s => s.length > 0);
			}
		}
	});
}


function highlightLink(node, remove)
{
	// parse and apply ;-separated list of key:val style properties
	('' + prefValues.hlstyle).split(';').forEach(function (r)
	{
		let [prop, val] = r.split(':').map(s => s.trim());
		node.style.setProperty(prop, remove ? '' : val, 'important');
	});
}


function skipLinkType(link)
{
	return (link.startsWith("view-source:") || link.startsWith("data:")
			|| (prefValues.skipwhen && prefValues.skipwhen.test(link)));
}


function getLinkSearchStrings(link, depth)
{
	// Safety for recursive calls
	if (typeof depth === 'undefined')
		depth = 0;
	else if (depth > 2)
		return [];

	var arr = [decodeURIComponent(link.pathname)], vals = [];
	if (link.search)
	{
		// NB searchParams.values() does not work reliably, probably because URLSearchParams are some kind of generator:
		// they need to be manually iterated.
		for (let [key, val] of link.searchParams)
		{
			if (key)
				arr.push(key);
			if (val)
				vals.push(val);
		}
		arr = arr.concat(vals);
	}

	if (link.hash.startsWith('#!'))
	{
		var noHashLink = new URL(link.href);
		noHashLink.hash = '';
		try
		{
			var hashLink = new URL(link.hash.slice(2), noHashLink.href);
			log('Parsing from hash-bang type URL: ' + hashLink.href);
		}
		catch (e)
		{
			return arr.concat(link.hash.slice(1));
		}

		var hashLinkSearchStrings = getLinkSearchStrings(hashLink, depth + 1);
		// remove common prefix of both arrays
		for (let item of arr)
		{
			if (hashLinkSearchStrings.length > 0 && item == hashLinkSearchStrings[0])
				hashLinkSearchStrings.shift();
			else
				break;
		}
		return arr.concat(hashLinkSearchStrings);
	}

	return link.hash ? arr.concat(link.hash.slice(1)) : arr;
}

function getBaseURL(base)
{
	if (typeof base === 'string')
	{
		try
		{
			base = new URL(base);
			base.hash = '';
			return base;
		}
		catch (e) {}
	}

	// fall back on window.location if it exists
	if (window)
	{
		base = new URL(window.location);
		base.hash = '';
	}

	return base;
}

function getLinkURL(link, base)
{
	// extract javascript arguments
	var [all, quote, linkParam] = link.match(javascript_link) || [];
	if (all)
		link = linkParam;

	// TODO: what if new URL() throws? return link?
	// Also check that it only happens in injected script
	return new URL(link, typeof base === 'undefined' ? base : base.href);
}


// pre-process base-64 matches, before decoding them
function domainRulesBase64(link, base, base64match)
{
	if (/\.yahoo.com$/.test(base.host))
		return base64match.replace(/\/RS.*$/, '');
	else
		return base64match;
}


// pre-process plain/url-encoded matches, before decoding them
function domainRulesGeneral(link, base)
{
	if (typeof base !== 'undefined')
	{
		switch (base.host)
		{
			case 'www.tripadvisor.com':
				if (link.indexOf('-a_urlKey') !== -1)
					return new URL(decodeURIComponent(link.replace(/_+([a-f\d]{2})/gi, '%$1')
						.replace(/_|%5f/ig, '')).split('-aurl.').pop().split('-aurlKey').shift());
		}


		if (/\.yahoo.com$/.test(base.host))
			link.path = link.path.replace(/\/R[KS]=\d.*$/, '');
	}

	switch (link.host) // alt: (link.match(/^\w+:\/\/([^/]+)/) || [])
	{
		case 'redirect.disqus.com':
			if (link.indexOf('/url?url=') !== -1)
				return new URL(link.match(/url\?url=([^&]+)/).pop().split(/%3a[\w-]+$/i).shift());
	}

	return link;
}


function decodeEmbeddedURI(link, base)
{
	// first try to find a base64-encoded link
	var base64match;
	for (let str of getLinkSearchStrings(link))
	{
		[base64match] = str.match(base64_encoded_url) || [];
		if (base64match)
		{
			base64match = domainRulesBase64(link, base, base64match);
			try
			{
				let decoded = decodeURIComponent(atob(base64match));
				if (!decoded)
					continue;

				if (decoded.startsWith('www.'))
					decoded = link.protocol + '//' + decoded;

				return new URL(decoded);
			}
			catch (e)
			{
				log('Invalid base64 data in link ' + link + ' : '  + decoded + ' -- error is ' + e);
			}
		}
	}

	var all, capture, lmt = 4;
	link = domainRulesGeneral(link, base);

	while (--lmt)
	{
		all = null;

		// try first raw: without encoding. If there is a https://, then use all the remaining part of the URL.
		[all, capture] = link.href.slice(link.origin.length).match(decoded_scheme_url) || [];
		if (all)
		{
			link = new URL(capture);
			continue;
		}

		// otherwise check every parsed (URL-decoded) substring
		for (let str of getLinkSearchStrings(link))
		{
			[all, capture] = str.match(decoded_scheme_url) || str.match(decoded_www_url) || [];
			if (!all)
				continue;

			if (capture.startsWith('www.'))
				capture = link.protocol + '//' + capture;

			// got the new link!
			link = new URL(capture);
			log('decoded URI Component = ' + capture + ' -> ' + link.origin + ' + ' + link.href.slice(link.origin.length))

			// trim of any non-link parts of the "capture" string, that appear after decoding the URI component,
			// but only in the (path + search params + hash) part.
			link = new URL(capture.slice(link.origin.length).replace(trailing_invalid_chars, '').replace(/&amp;/g, '&'), link.origin)

			log('cleaned URI Component =' + link.href)
			break;
		}

		if (!all)
			break;
	}

	return link;
}


function filterParams(link, base)
{
	if (prefValues.remove.test(link))
	{
		var cleanParams = new URLSearchParams();
		for (let [key, val] of link.searchParams)
		{
			if (!key.match(prefValues.remove))
				cleanParams.append(key, val);
		}
		link.search = cleanParams.toString();
	}

	return link;
}


function cleanLink(link, base)
{
	var origLink = link;

	if (!link || skipLinkType(link))
	{
		log('not cleaning', link, ': empty, source, or matches skipwhen');
		return link;
	}

	base = getBaseURL(base);
	link = getLinkURL(link, base);

	if (prefValues.skipdoms && prefValues.skipdoms.indexOf(link.host) !== -1)
	{
		log('not cleaning ' + link + ' : host in skipdoms');
		return link;
	}

	if (prefValues.ignhttp && !(/^https?:$/.test(link.protocol)))
	{
		log('not cleaning ' + link + ' : ignoring non-http(s) links');
		return link;
	}

	link = decodeEmbeddedURI(link, base)

	// This is inherited from the legacy code, but is it ever really used ?
	link.protocol = link.protocol.replace(/^h[\w*]+(ps?):$/i, 'htt$1:');

	// Should params be filtered only here, when no whitelist is applied? All the time? With a separate whitelist mechanism?
	link = filterParams(link, base);

	log('cleaning ' + origLink + ' : ' + link.href)

	// compare with pre-cleaning link, but canonicalize through URL() if possible
	// to ignore potential meaningless changes, i.e. "," -> "%2C"
	var changed;
	try { changed = (link != new URL(origLink)); }
	catch (e) { changed = (origLink != link.href); }

	return changed ? link.href : origLink;
}


function textFindLink(node)
{
	let pos, selection = node.ownerDocument && node.ownerDocument.defaultView.getSelection();

	// if selection has a node with data, and we can get the offset in that data
	if (selection && selection.isCollapsed && selection.focusNode && selection.focusNode.data && (pos = selection.focusOffset))
	{
		// unsanitized content of selection
		let content = selection.focusNode.data.substr(--pos);

		// sanitize selection: remove 0-space tags, replace other tags with spaces
		let text = node.innerHTML.replace(/<\/?wbr>/ig, '').replace(/<[^>]+?>/g, ' ');

		// recover position of selection in sanitized text
		pos = text.indexOf(content) + 1;
		if (pos === 0)
		{
			text = node.textContent;
			pos = text.indexOf(content) + 1;
		}

		// tools to modify boundaries of selection, until a reasonable url
		let boundaryChars = ' "\'<>\n\r\t()[]|',
			protectedBoundaryChars = boundaryChars.replace(/(.)/g, '\\$1'),
			trimEndRegex = RegExp("[" + protectedBoundaryChars + "]+$");

		// move start of selection backwards until start of data or a boundary character
		while (pos && boundaryChars.indexOf(text[pos]) === -1)
			--pos;

		text = (pos && text.substr(++pos) || text)
		text = text.match(/^\s*(?:\w+:\/\/|www\.)[^\s">]{4,}/)

		if (text)
		{
			text = text.shift().trim().replace(trimEndRegex, '');
			if (text.indexOf('://') === -1)
				text = 'http://' + text;
		}

		return text;
	}

	return undefined;
}

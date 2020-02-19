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

const decoded_scheme_url = /(?:\b|=)([a-z]{2,}:\/\/.+)$/i					// {word-break or "="}[a-z]+://{more stuff}
const decoded_www_url = /(?:^|[^\/]\/)(www\..+)$/i							// {begin or [not-slash]/}www.{more stuff}
const base64_encoded_url = /\b(?:aHR0|d3d3)[A-Z0-9+=\/]+/i					// {base64-encoded http or www.}{more valid base64 chars}
const trailing_invalid_chars = /([^-a-z0-9~$_.+!*'(),;:@&=\/?%]|%(?![0-9a-fA-F]{2})).*$/i
const encoded_param_chars = [['?', encodeURIComponent('?')], ['=', encodeURIComponent('=')], ['&', encodeURIComponent('&')]];


function skipLinkType(link)
{
	return link.startsWith("view-source:") || link.startsWith("blob:") || link.startsWith("data:")
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
	if (typeof window !== 'undefined')
	{
		base = new URL(window.location);
		base.hash = '';
	}

	return base;
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

	var lmt = 4;
	link = domainRulesGeneral(link, base);

	while (--lmt)
	{
		var capture = undefined, all;
		var haystack = link.href.slice(link.origin.length), needle;
		console.log(link.href)

		// check every parsed (URL-decoded) substring in the URL
		for (let str of getLinkSearchStrings(link))
		{
			[all, capture] = str.match(decoded_scheme_url) || str.match(decoded_www_url) || [];
			if (capture)
			{
				// got the new link!
				link = new URL((capture.startsWith('www.') ? link.protocol + '//' : '') + capture);
				log('decoded URI Component = ' + capture + ' → ' + link.origin + ' + ' + link.href.slice(link.origin.length))
				all = str;
				break;
			}
		}

		if (capture === undefined)
			break;

		// check if the URL appears unencoded or partially encoded in the URL
		if (capture.startsWith(link.protocol))
			needle = link.href.slice(0, link.origin.length);
		else
			needle = link.href.slice(link.protocol.length + 2, link.origin.length + 1);
		var raw_pos = haystack.indexOf(needle)

		if (raw_pos < 0)
		{
			// trim of any non-link parts of the "capture" string, that appear after decoding the URI component,
			// but only in the (path + search params + hash) part.
			// Only do this for properly encoded URLs.
			capture = capture.replace(trailing_invalid_chars, '').replace(/&amp;/g, '&')
			link = new URL(capture, link.origin);
			log('cleaned URI Component = ' + link.href)
		}
		else
		{
			// The URL is incorrectly encoded: either fully or partially unencoded.
			// We must decide what to do!
			// - "all" contains the string in which we matched the URL
			// - "haystack.slice(raw_pos)" contains the URL assuming it is fully unencoded
			// - "link" contains the URL assuming it is partially unencoded, i.e. with & and = properly encoded
			// => if we find indications that the encoding is indeed partial. do nothing. Otherwise, use "all" as the URL string.
			var raw_url = haystack.slice(raw_pos), semi_encoded = false;
			for (let [dec, enc] of encoded_param_chars)
				if (all.includes(dec) && raw_url.includes(enc))
					semi_encoded = true;

			if (!semi_encoded)
			{
				log('using raw URL: ' + raw_url)
				var qmark_pos = raw_url.indexOf('?')
				var qmark_end = raw_url.lastIndexOf('?')
				var amp_pos = raw_url.indexOf('&')

				if (amp_pos >= 0 && qmark_pos < 0)
					raw_url = raw_url.slice(0, amp_pos)
				else if (qmark_pos >= 0 && qmark_pos < qmark_end)
					raw_url = raw_url.slice(0, qmark_end)

				link = new URL((raw_url.startsWith('www.') ? link.protocol + '//' : '') + raw_url);
			}
		}
	}

	return link;
}


function filterParams(link, base)
{
	if (prefs.values.remove.test(link))
	{
		var cleanParams = new URLSearchParams();
		for (let [key, val] of link.searchParams)
		{
			if (!key.match(prefs.values.remove))
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
		log('not cleaning ' + link + ' : empty, source, or matches skipwhen');
		return link;
	}

	base = getBaseURL(base);
	link = new URL(link)

	let rules = find_rules(link, load_rules)
	// (prefs.values.skipwhen && prefs.values.skipwhen.test(link)));

	if (prefs.values.skipdoms && prefs.values.skipdoms.indexOf(link.host) !== -1)
	{
		log('not cleaning ' + link + ' : host in skipdoms');
		return link;
	}

	if (prefs.values.ignhttp && !(/^https?:$/.test(link.protocol)))
	{
		log('not cleaning ' + link + ' : ignoring non-http(s) links');
		return link;
	}

	link = decodeEmbeddedURI(link, base)

	if (link.href == new URL(origLink))
	{
		log('cleaning ' + origLink + ' : unchanged')
		return origLink;
	}

	// Should params be filtered only here, when no whitelist is applied? All the time? With a separate whitelist mechanism?
	link = filterParams(link, base);

	log('cleaning ' + origLink + ' : ' + link.href)

	return link.href;
}

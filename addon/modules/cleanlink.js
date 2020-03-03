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


function getSimpleLinkSearchStrings(link, skip)
{
	let arr = [decodeURIComponent(link.pathname)], vals = [];
	if (link.search)
	{
		// NB searchParams.values() does not work reliably, probably because URLSearchParams are some kind of generator:
		// they need to be manually iterated.
		for (let [key, val] of link.searchParams)
		{
			if (key.match(skip))
				continue;

			if (key)
				arr.push(key);
			if (val)
				vals.push(val);
		}
		arr = arr.concat(vals);
	}
	return arr;
}


function getLinkSearchStrings(link, skip)
{
	let arr = getSimpleLinkSearchStrings(link, skip)

	if (link.hash.startsWith('#!'))
	{
		let noHashLink = new URL(link.href), hashLink = null;
		noHashLink.hash = '';
		try
		{
			hashLink = new URL(link.hash.slice(2), noHashLink.href);
			log('Parsing from hash-bang type URL: ' + hashLink.href);

			arr.push(...getSimpleLinkSearchStrings(hashLink, skip));
		}
		catch (e)
		{
			return arr.push(link.hash.slice(1));
		}
	}
	else if (link.hash)
		arr.push(link.hash.slice(1))

	return arr
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


function decodeEmbeddedURI(link, base, rules)
{
	// first try to find a base64-encoded link
	let skip = 'whitelist' in rules && rules.whitelist.length ? new RegExp(rules.whitelist.join('|')) : null;
	for (let str of getLinkSearchStrings(link, skip))
	{
		let [base64match] = str.match(base64_encoded_url) || [];
		if (base64match)
		{
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

	var capture = undefined, all, embeddedLink;
	var haystack = link.href.slice(link.origin.length), needle;
	console.log(link.href)

	// check every parsed (URL-decoded) substring in the URL
	for (let str of getLinkSearchStrings(link, null))  // TODO: get the rules of the newly matched domain
	{
		[all, capture] = str.match(decoded_scheme_url) || str.match(decoded_www_url) || [];
		if (capture)
		{
			// got the new link!
			embeddedLink = new URL((capture.startsWith('www.') ? link.protocol + '//' : '') + capture);
			log('decoded URI Component = ' + capture + ' → ' + embeddedLink.origin +
				' + ' + embeddedLink.href.slice(embeddedLink.origin.length))
			all = str;
			break;
		}
	}

	if (capture === undefined)
		return link;

	// check if the URL appears unencoded or partially encoded in the URL
	if (capture.startsWith(embeddedLink.protocol))
		needle = embeddedLink.href.slice(0, embeddedLink.origin.length);
	else
		needle = embeddedLink.href.slice(embeddedLink.protocol.length + 2, embeddedLink.origin.length + 1);

	let raw_pos = haystack.indexOf(needle)
	if (raw_pos === -1)
	{
		// trim of any non-link parts of the "capture" string, that appear after decoding the URI component,
		// but only in the (path + search params + hash) part.
		// Only do this for properly encoded URLs.
		capture = capture.replace(trailing_invalid_chars, '').replace(/&amp;/g, '&')

		// TODO: ugly hardcoded case, as there is no post-cleaning rewriting or param rewriting yet.
		if (link.hostname.endsWith('disq.us'))
			capture = capture.replace(/:-[a-z0-9-]*$/i, '')

		return new URL(capture, embeddedLink.origin);
	}

	// The URL is incorrectly encoded: either fully or partially unencoded.
	// We must decide what to do!
	// - "all" contains the string in which we matched the URL
	// - "haystack.slice(raw_pos)" contains the URL assuming it is fully unencoded
	// - "link" contains the URL assuming it is partially unencoded, i.e. with & and = properly encoded
	// => if we find indications that the encoding is indeed partial, do nothing. Otherwise, use "all" as the URL string.
	var raw_url = haystack.slice(raw_pos), semi_encoded = false;
	for (let [dec, enc] of encoded_param_chars)
		if (all.includes(dec) && raw_url.includes(enc))
			semi_encoded = true;

	if (semi_encoded)
		return embeddedLink;

	log('using raw URL: ' + raw_url)
	var qmark_pos = raw_url.indexOf('?')
	var qmark_end = raw_url.lastIndexOf('?')
	var amp_pos = raw_url.indexOf('&')

	if (amp_pos >= 0 && qmark_pos < 0)
		raw_url = raw_url.slice(0, amp_pos)
	else if (qmark_pos >= 0 && qmark_pos < qmark_end)
		raw_url = raw_url.slice(0, qmark_end)

	return new URL((raw_url.startsWith('www.') ? embeddedLink.protocol + '//' : '') + raw_url);
}


function filterParamsAndPath(link, base, rules)
{
	if ('rewrite' in rules && rules.rewrite.length)
	{
		for (let {search, replace, flags} of rules.rewrite)
			link.pathname = link.pathname.replace(new RegExp(search, flags), replace)
	}

	if ('remove' in rules && rules.remove.length)
	{
		let cleanParams = new URLSearchParams();
		let strip = new RegExp(rules.remove.join('|')) || null;
		let keep = new RegExp('whitelist' in rules && rules.whitelist.length ? rules.whitelist.join('|') : '.^');

		for (let [key, val] of link.searchParams)
		{
			if (key.match(keep) || !key.match(strip))
				cleanParams.append(key, val);
		}
		link.search = cleanParams.toString();
	}

	return link;
}


async function cleanLink(link, base)
{
	let origLink = link;

	if (!link || skipLinkType(link))
	{
		log('not cleaning ' + link + ' : empty, source, or matches skipwhen');
		return link;
	}

	if (prefs.values.ignhttp && !(/^https?:$/.test(link.protocol)))
	{
		log('not cleaning ' + link + ' : ignoring non-http(s) links');
		return link;
	}

	if (prefs.values.skipwhen && prefs.values.skipwhen.test(link))
	{
		log('not cleaning ' + link + ' : in skip preferences');
		return link;
	}

	base = getBaseURL(base);
	link = new URL(link)

	let rules = await Rules.find(link)
	console.log('Rules found', rules)

	// first remove parameters or rewrite
	link = filterParamsAndPath(link, base, rules);

	for (let lmt = 4; lmt > 0; --lmt)
	{
		let embeddedLink = decodeEmbeddedURI(link, base, rules)
		if (embeddedLink.href === link.href)
			break;

		// remove parameters or rewrite again, if we redirected on an embedded URL
		rules = await Rules.find(embeddedLink)
		link = filterParamsAndPath(embeddedLink, base, rules);
	}

	if (link.href == new URL(origLink).href)
	{
		log('cleaning ' + origLink + ' : unchanged')
		return origLink;
	}

	log('cleaning ' + origLink + ' : ' + link.href)

	return link.href;
}

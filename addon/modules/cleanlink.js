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
const trailing_invalid_chars = /([^-a-z0-9~$_.+!*'(),;@&=\/?%#]|%(?![0-9a-fA-F]{2})).*$/i
const encoded_param_chars = [['?', encodeURIComponent('?')], ['=', encodeURIComponent('=')], ['&', encodeURIComponent('&')]];


function skip_link_type(link)
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

function get_base_url(base)
{
	if (typeof base === 'string')
	{
		try
		{
			base = new URL(base);
			base.hash = '';
			return base.href;
		}
		catch (e) {}
	}

	// fall back on window.location if it exists
	if (typeof window !== 'undefined')
	{
		base = new URL(window.location);
		base.hash = '';
		return base.href
	}

	return undefined;
}


function find_raw_embedded_link(haystack, embedded_link, matched_protocol)
{
	// get embedded_link.origin + username the way it is in the raw string
	let substr = [0, embedded_link.origin.length + (embedded_link.username ? 1 + embedded_link.username.length : 0)];

	if (!matched_protocol)
	{
		// if we did not match a protocol (e.g. a match starting with "www.") strip the protocol from the search string,
		// and add the first unencoded character of the path/query/hash (whichever is present) to ensure a raw URL match
		substr[0] += embedded_link.protocol.length + 2;
		substr[1] += 1;
	}

	let raw_pos = haystack.indexOf(embedded_link.href.slice(...substr));
	if (raw_pos === -1)
		return null;

	return haystack.slice(raw_pos);
}


function decode_embedded_uri(link, rules, original_string)
{
	let skip = 'whitelist' in rules && rules.whitelist.length ? new RegExp('^(' + rules.whitelist.join('|') + ')$') : null;

	// first try to find a base64-encoded link
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

				// found? return it, this is pretty much unambiguous
				return new URL(decoded);
			}
			catch (e)
			{
				log('Invalid base64 data in link ' + link + ' : '  + decoded + ' -- error is ' + e);
			}
		}
	}

	let capture = undefined, matchedString, embedded_link;

	// check every parsed (URL-decoded) substring in the URL
	for (let str of getLinkSearchStrings(link, skip))
	{
		[, capture] = str.match(decoded_scheme_url) || str.match(decoded_www_url) || [];
		if (capture)
		{
			// got the new link!
			embedded_link = new URL((capture.startsWith('www.') ? link.protocol + '//' : '') + capture);
			log('decoded URI Component = ' + capture + ' → ' + embedded_link.origin +
				' + ' + embedded_link.href.slice(embedded_link.origin.length))
			matchedString = str;
			break;
		}
	}

	if (capture === undefined)
		return link;

	// check if the embedded URL appears unencoded or partially encoded in the containing URL
	let raw_url = find_raw_embedded_link(original_string.slice(link.origin.length), embedded_link,
										 capture.startsWith(embedded_link.protocol))

	// No unencoded occurrence of the embedded URL in the parent URL: encoding was done correctly. 99% of the cases here.
	if (raw_url === null)
	{
		// Trim of any non-link parts of the "capture" string, that appear after decoding the URI component,
		// but only for properly encoded URLs, and in the (path + search params + hash) part.
		let prefix_length = embedded_link.origin.length;
		if (!capture.startsWith(embedded_link.protocol))
			prefix_length -= embedded_link.protocol.length;

		return new URL(capture.substring(prefix_length).replace(trailing_invalid_chars, '').replace(/&amp;/g, '&'),
						embedded_link.origin);
	}
	else
		log('raw url:', raw_url)

	// The URL is incorrectly encoded: either fully or partially unencoded.
	// embedded_link:  contains the embedded URL assuming it is partially encoded, i.e. & and = encoded but : and / not
	// matchedString: contains the string in which we matched embedded_link
	// raw_url:       contains the embedded URL assuming it is fully unencoded, i.e. until the end of the containing URL

	// => if we find indications that the encoding is indeed partial, return embedded_link
	let semi_encoded = false;
	for (let [dec, enc] of encoded_param_chars)
		if (matchedString.includes(dec) && raw_url.includes(enc))
			semi_encoded = true;

	if (semi_encoded)
		return embedded_link;

	// => Otherwise, use "raw_url" as the URL string. Use some heuristics on & and ? to remove garbage from the result.
	log('using raw URL: ' + raw_url)
	let qmark_pos = raw_url.indexOf('?')
	let qmark_end = raw_url.lastIndexOf('?')
	let amp_pos = raw_url.indexOf('&')

	if (amp_pos >= 0 && qmark_pos < 0)
		raw_url = raw_url.slice(0, amp_pos)
	else if (qmark_pos >= 0 && qmark_pos < qmark_end)
		raw_url = raw_url.slice(0, qmark_end)

	return new URL((raw_url.startsWith('www.') ? embedded_link.protocol + '//' : '') + raw_url);
}


function filter_params_and_path(link, rules)
{
	if ('rewrite' in rules && rules.rewrite.length)
	{
		for (let {search, replace, flags} of rules.rewrite)
			link.pathname = link.pathname.replace(new RegExp(search, flags), replace)
	}

	if ('remove' in rules && rules.remove.length && link.search.length > 1)
	{
		let params = new URLSearchParams(link.search.slice(1));
		let strip = new RegExp('^(' + rules.remove.join('|') + ')$');
		let keep = null;
		if ('whitelist' in rules && rules.whitelist.length)
			keep = new RegExp('^(' + rules.whitelist.join('|') + ')$')

		let changes = 0;
		for (let [key, val] of link.searchParams.entries())
			if ((!keep || !key.match(keep)) && key.match(strip))
			{
				params.delete(key)
				changes++;
			}

		// encoding is sometimes inconsistent:
		// - URL() uses + for spaces while we might encounter %20 in the wild
		// - some keys without values might get changed from &key=& to &key&
		if (changes !== 0)
			link.search = params.toString();
	}

	return link;
}


function clean_link(orig_link, base)
{
	if (!orig_link || skip_link_type(orig_link))
	{
		log('not cleaning ' + orig_link + ' : empty or ignored orig_link type');
		return orig_link;
	}

	if (Prefs.values.ignhttp && !(/^https?:$/.test(orig_link.protocol)))
	{
		log('not cleaning ' + orig_link + ' : ignoring non-http(s) links');
		return orig_link;
	}

	base = get_base_url(base);
	let link = new URL(orig_link, base)

	let rules = Rules.find(link)

	// first remove parameters or rewrite
	link = filter_params_and_path(link, rules);

	for (let lmt = 4; lmt > 0; --lmt)
	{
		let embedded_link = decode_embedded_uri(link, rules, orig_link)
		if (embedded_link.href === link.href)
			break;

		// remove parameters or rewrite again, if we redirected on an embedded URL
		rules = Rules.find(embedded_link)
		link = filter_params_and_path(embedded_link, rules);
	}

	if (link.href == new URL(orig_link, base).href)
	{
		log('cleaning ' + orig_link + ' : unchanged')
		return orig_link;
	}

	log('cleaning ' + new URL(orig_link, base).href + ' : ' + link.href)

	return link.href;
}

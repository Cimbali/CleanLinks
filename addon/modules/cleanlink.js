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
	return ['view-source:', 'blob:', 'data:', 'magnet:'].includes(link.protocol)
}


function get_simple_link_search_strings(link, skip, whitelist_path)
{
	let arr = [], vals = [];

	if (!whitelist_path)
		arr.push(decodeURIComponent(link.pathname));

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
		arr.push(...vals);
	}

	// look again with double decoding if nothing was found
	for (const token of arr.slice())
		try { arr.push(decodeURIComponent(token)); } catch (e) {}

	return arr;
}


function no_hash_url(url)
{
	url = new URL(url.href);
	url.hash = '';
	return url;
}


function get_link_search_strings(link, skip, whitelist_path)
{
	let arr = get_simple_link_search_strings(link, skip, whitelist_path)

	if (link.hash.startsWith('#!'))
	{
		try
		{
			const hash_link = new URL(link.hash.slice(2), no_hash_url(link).href);
			log('Parsing from hash-bang type URL: ' + hash_link.href);

			arr.push(...get_simple_link_search_strings(hash_link, skip));
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


function get_base_href(base)
{
	if (base instanceof URL)
		return no_hash_url(base);

	try
	{
		if (base)
			return no_hash_url(new URL(base));
	}
	catch (e) {}

	// fall back on window.location if it exists
	if (typeof window !== 'undefined')
		return no_hash_url(new URL(window.location));

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
	for (let str of get_link_search_strings(link, skip, rules.whitelist_path))
	{
		let [base64match] = str.match(base64_encoded_url) || [], decoded;
		if (base64match)
		{
			try
			{
				decoded = decodeURIComponent(atob(base64match));
				if (!decoded)
					continue;

				if (decoded.startsWith('www.'))
					decoded = link.protocol + '//' + decoded;

				// found? return it, this is pretty much unambiguous
				return new URL(decoded);
			}
			catch (e)
			{
				log(`Invalid base64 data in link ${link} : ${decoded} -- error is ${e}`);
			}
		}
	}

	let capture = undefined, matchedString, embedded_link;

	// check every parsed (URL-decoded) substring in the URL
	for (let str of get_link_search_strings(link, skip, rules.whitelist_path))
	{
		[, capture] = str.match(decoded_scheme_url) || str.match(decoded_www_url) || [];
		if (capture)
		{
			// got the new link!
			embedded_link = new URL((capture.startsWith('www.') ? link.protocol + '//' : '') + capture);
			log(`decoded URI Component = ${capture} → ${embedded_link.origin} + `
				+ embedded_link.href.slice(embedded_link.origin.length))
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
			prefix_length -= embedded_link.protocol.length + 2;

			log(`decoded URI Component = ${capture.substring(0, prefix_length)} → ${embedded_link.origin} + `
				+ capture.substring(prefix_length))
		return new URL(embedded_link.origin +
						capture.substring(prefix_length).replace(trailing_invalid_chars, '').replace(/&amp;/g, '&'));
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


function filter_params_and_path(link, rules, actions_taken)
{
	let { rewrite, remove } = { rewrite: false, remove: [], ...actions_taken };

	if ('rewrite' in rules && rules.rewrite.length)
	{
		let pathname = link.pathname;
		for (let {search, replace, flags} of rules.rewrite)
			pathname = pathname.replace(new RegExp(search, flags), replace)

		if (link.pathname !== pathname)
		{
			link.pathname = pathname;
			rewrite = true;
		}
	}

	if ('remove' in rules && rules.remove.length && link.search.length > 1)
	{
		let params = new URLSearchParams(link.search.slice(1));
		let strip = new RegExp('^(' + rules.remove.join('|') + ')$');
		let keep = null;
		if ('whitelist' in rules && rules.whitelist.length)
			keep = new RegExp('^(' + rules.whitelist.join('|') + ')$')

		for (let [key, val] of link.searchParams.entries())
			if ((!keep || !key.match(keep)) && key.match(strip))
			{
				remove.push(key);
				params.delete(key)
			}

		// encoding is sometimes inconsistent:
		// - URL() uses + for spaces while we might encounter %20 in the wild
		// - some keys without values might get changed from &key=& to &key&
		if (remove.length !== 0)
			link.search = params.toString();
	}

	return { ...actions_taken, link, rewrite, remove };
}


function clean_link(link)
{
	if (!link || skip_link_type(link))
	{
		log(`not cleaning ${link.href}: empty or ignored link type`);
		return {};
	}

	if (Prefs.values.ignhttp && link.protocol !== 'http:' && link.protocol !== 'https:')
	{
		log(`not cleaning ${link.href} : ignoring non-http(s) links`);
		return {};
	}

	let cleaned_link = new URL(link.href), rules = Rules.find(cleaned_link), nesting = -1, meta = {};

	// first remove parameters or rewrite
	({ link: cleaned_link, ...meta } = filter_params_and_path(cleaned_link, rules));

	while (++nesting !== 4)
	{
		const embedded_link = decode_embedded_uri(cleaned_link, rules, link.href)
		if (embedded_link.href === cleaned_link.href)
			break;

		// NB/TODO: before fetching new rules, apply post-cleaning rules here?

		// remove parameters or rewrite again, if we redirected on an embedded URL
		rules = Rules.find(embedded_link);
		({ link: cleaned_link, ...meta } = filter_params_and_path(embedded_link, rules, meta));
	}

	if (cleaned_link.href === link.href)
	{
		log(`cleaning ${link} : unchanged`)
		return {};
	}

	log('cleaning ' + link.href + ' : ' + cleaned_link.href)

	return { cleaned_link, embed: nesting, ...meta };
}

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

'use strict';

const decoded_scheme_url = /(?:\b|=)(?<protocol>[a-z]{2,}:\/\/.+)$/iu	// {word-break or "="}[a-z]+://{more stuff}
const decoded_www_url = /(?:^|[^/]\/)(?<web>www\..+)$/iu				// {begin or [not-slash]/}www.{more stuff}
const base64_encoded_url = /\b(?:aHR0|d3d3)[A-Z0-9+=/]+/iu				// {base64-encoded http or www.}{base64 data}
const trailing_invalid_chars = /(?:[^-a-z0-9~$_.+!*'(),:;@&=/?%#]|%(?![0-9a-fA-F]{2})).*$/iu
const encoded_param_chars = [
	['?', encodeURIComponent('?')],
	['=', encodeURIComponent('=')],
	['&', encodeURIComponent('&')],
];


function skip_link_type(link)
{
	return ['view-source:', 'blob:', 'data:', 'magnet:'].includes(link.protocol)
}


function get_simple_link_search_strings(link, test_skip_param, skip_path)
{
	const arr = [], vals = [];

	if (!skip_path)
		arr.push(decodeURIComponent(link.pathname));

	if (link.search)
	{
		// NB searchParams.values() does not work reliably, probably because URLSearchParams are some kind of generator:
		// they need to be manually iterated.
		for (const [key, val] of link.searchParams)
		{
			if (test_skip_param(key))
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
		try { arr.push(decodeURIComponent(token)); } catch (err) {}

	return arr;
}


function no_hash_url(url)
{
	url = new URL(url.href);
	url.hash = '';
	return url;
}


function get_link_search_strings(link, test_skip_param, skip_path)
{
	const arr = get_simple_link_search_strings(link, test_skip_param, skip_path)

	if (link.hash.startsWith('#!'))
	{
		try
		{
			const hash_link = new URL(link.hash.slice(2), no_hash_url(link).href);
			log(`Parsing from hash-bang type URL: ${hash_link.href}`);

			arr.push(...get_simple_link_search_strings(hash_link, test_skip_param));
		}
		catch (err)
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
	catch (err) {}

	// fall back on window.location if it exists
	if (typeof window !== 'undefined')
		return no_hash_url(new URL(window.location));

	return null;
}


function find_raw_embedded_link(haystack, embedded_link, matched_protocol)
{
	// get embedded_link.origin + username the way it is in the raw string
	const substr = [0, embedded_link.origin.length + (embedded_link.username ? 1 + embedded_link.username.length : 0)];

	if (!matched_protocol)
	{
		// if we did not match a protocol (e.g. a match starting with "www.") strip the protocol from the search string,
		// and add the first unencoded character of the path/query/hash (whichever is present) to ensure a raw URL match
		substr[0] += embedded_link.protocol.length + 2;
		substr[1] += 1;
	}

	const raw_pos = haystack.indexOf(embedded_link.href.slice(...substr));
	if (raw_pos === -1)
		return null;

	return haystack.slice(raw_pos);
}


function decode_embedded_uri(link, rules, original_string)
{
	const skip_whitelist = 'whitelist' in rules && rules.whitelist.length
		? new RegExp(`^(${rules.whitelist.join('|')})$`, 'iu')
		: {test: () => false};
	const is_in_redirect = 'redirect' in rules && rules.redirect.length
		? new RegExp(`^(${rules.redirect.join('|')})$`, 'iu')
		: {test: () => false};

	const test_skip_param = Prefs.values.auto_redir ? str => skip_whitelist.test(str)
													: str => !is_in_redirect.test(str) || skip_whitelist.test(str);
	const skip_path = Prefs.values.auto_redir ? rules.whitelist_path : !rules.redirect_path;

	// first try to find a base64-encoded link
	for (const str of get_link_search_strings(link, test_skip_param, skip_path))
	{
		const [base64match] = str.match(base64_encoded_url) || [];
		if (base64match)
		{
			let decoded;
			try
			{
				decoded = decodeURIComponent(atob(base64match));
				if (!decoded)
					continue;

				if (decoded.startsWith('www.'))
					decoded = `${link.protocol}//${decoded}`;

				// found? return it, this is pretty much unambiguous
				return new URL(decoded);
			}
			catch (err)
			{
				log(`Invalid base64 data in link ${link} : ${decoded} -- error is ${err.message}`);
			}
		}
	}

	let capture, matchedString, embedded_link;

	// check every parsed (URL-decoded) substring in the URL
	for (const str of get_link_search_strings(link, test_skip_param, skip_path))
	{
		[, capture] = str.match(decoded_scheme_url) || str.match(decoded_www_url) || [];
		if (capture)
		{
			// got the new link!
			embedded_link = new URL((capture.startsWith('www.') ? `${link.protocol}//` : '') + capture);
			log(`decoded URI Component = ${capture} → ${embedded_link.origin} + ${
				 embedded_link.href.slice(embedded_link.origin.length)}`)
			matchedString = str;
			break;
		}
	}

	if (typeof capture === 'undefined')
		return link;

	// check if the embedded URL appears unencoded or partially encoded in the containing URL
	let raw_url = find_raw_embedded_link(original_string.slice(link.origin.length), embedded_link,
										 capture.startsWith(embedded_link.protocol))

	// No unencoded occurrence of the embedded URL in the parent URL: encoding was done correctly. 99% of cases here.
	if (raw_url === null)
	{
		// Trim of any non-link parts of the "capture" string, that appear after decoding the URI component,
		// but only for properly encoded URLs, and in the (path + search params + hash) part.
		let prefix_length = embedded_link.origin.length;
		if (!capture.startsWith(embedded_link.protocol))
			prefix_length -= embedded_link.protocol.length + 2;

			log(`decoded URI Component = ${capture.substring(0, prefix_length)} → ${embedded_link.origin} + ${
				 capture.substring(prefix_length)}`)
		return new URL(embedded_link.origin +
						capture.substring(prefix_length).replace(trailing_invalid_chars, '').replace(/&amp;/gu, '&'));
	}
	else
		log('raw url:', raw_url)

	// The URL is incorrectly encoded: either fully or partially unencoded.
	// embedded_link:  contains the embedded URL assuming it is partially encoded, i.e. & and = encoded but : and / not
	// matchedString: contains the string in which we matched embedded_link
	// raw_url:       contains the embedded URL assuming it is fully unencoded, i.e. until the end of the containing URL

	// => if we find indications that the encoding is indeed partial, return embedded_link
	let semi_encoded = false;
	for (const [dec, enc] of encoded_param_chars)
		if (matchedString.includes(dec) && raw_url.includes(enc))
			semi_encoded = true;

	if (semi_encoded)
		return embedded_link;

	// => Otherwise, use "raw_url" as the URL string. Use some heuristics on & and ? to remove garbage from the result.
	log(`using raw URL: ${raw_url}`)
	const qmark_pos = raw_url.indexOf('?')
	const qmark_end = raw_url.lastIndexOf('?')
	const amp_pos = raw_url.indexOf('&')

	if (amp_pos >= 0 && qmark_pos < 0)
		raw_url = raw_url.slice(0, amp_pos)
	else if (qmark_pos >= 0 && qmark_pos < qmark_end)
		raw_url = raw_url.slice(0, qmark_end)

	return new URL((raw_url.startsWith('www.') ? `${embedded_link.protocol}//` : '') + raw_url);
}


function filter_params_and_path(link, rules, actions_taken)
{
	const { remove, ...other } = { rewrite: false, remove: [], ...actions_taken };
	let { rewrite } = other;

	if ('rewrite' in rules && rules.rewrite.length)
	{
		let {pathname} = link;
		for (const {search, replace, flags} of rules.rewrite)
			pathname = pathname.replace(new RegExp(search, flags), replace)

		if (link.pathname !== pathname)
		{
			link.pathname = pathname;
			rewrite = true;
		}
	}

	if ('remove' in rules && rules.remove.length && link.search.length > 1)
	{
		const params = new URLSearchParams(link.search.slice(1));
		const strip = new RegExp(`^(${rules.remove.join('|')})$`, 'u');
		const keep = 'whitelist' in rules && rules.whitelist.length
			? new RegExp(`^(${rules.whitelist.join('|')})$`, 'u')
			: {test: () => false};

		for (const [key, ] of link.searchParams.entries())
			if (!keep.test(key) && strip.test(key))
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


/* exported clean_link */
function clean_link(link)
{
	if (!link || skip_link_type(link))
	{
		log(`not cleaning ${link.href}: empty or ignored link type`);
		return {};
	}

	if (Prefs.values.only_http && link.protocol !== 'http:' && link.protocol !== 'https:')
	{
		log(`not cleaning ${link.href} : ignoring non-http(s) links`);
		return {};
	}

	let cleaned_link = new URL(link.href);
	let rules = Rules.find(cleaned_link);
	let nesting = -1;
	let meta = {};
	const previous_cleaned_links = [];

	// first remove parameters or rewrite
	({ link: cleaned_link, ...meta } = filter_params_and_path(cleaned_link, rules));

	while (++nesting !== 4)
	{
		const embedded_link = decode_embedded_uri(cleaned_link, rules, link.href)
		if (embedded_link.href === cleaned_link.href)
			break;

		// Keep track of the list of successive cleaned links here.
		// Useful for Prefs.values.drop_leaks===false, to get cleaned-without-redir link
		previous_cleaned_links.push({ cleaned_link, embed: nesting, ...meta });

		// NB/TODO: before fetching new rules, apply post-cleaning rules here?

		// remove parameters or rewrite again, if we redirected on an embedded URL
		rules = Rules.find(embedded_link);
		({ link: cleaned_link, ...meta } = filter_params_and_path(embedded_link, rules, meta));
	} // if (!Prefs.values.auto_redir)

	if (cleaned_link.href === link.href)
	{
		log(`cleaning ${link} : unchanged`)
		return {};
	}

	log(`cleaning ${link.href} : ${cleaned_link.href}`)

	return { cleaned_link, embed: nesting, previous_cleaned_links, ...meta };
}

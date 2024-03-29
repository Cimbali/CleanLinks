/* ***** BEGIN LICENSE BLOCK *****
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/
 *
 * The Original Code is CleanLinks Mozilla Extension.
 *
 * The Initial Developer of the Original Code is
 * Copyright (C)2020 Cimbali <me@cimba.li>
 * All Rights Reserved.
 *
 * ***** END LICENSE BLOCK ***** */

'use strict';


// N/A, stroke \u0336, low line \u0335, slashed through \u0338, double low line \u0333, overline \u305
const utf8_markers = {deleted: '\u0336', inserted: '\u0332', whitelist: '\u0338', embedded: '\u0333'};
const css_classes = {deleted: 'del', inserted: 'ins', whitelist: 'keep', embedded: 'url'};


function append_decorated_text(node, text, type)
{
	let child = document.createTextNode(text);
	if (type)
	{
		const span = document.createElement('span');
		span.appendChild(child);
		span.classList.add(css_classes[type]);
		child = span;

		text = text.split('').join(utf8_markers[type]) + utf8_markers[type];
	}

	node.setAttribute('title', node.getAttribute('title') + text);
	node.querySelector('span.original').appendChild(child);
}


// Find if the clean URL was embedded in the original URL
function embed_url_pos(haystack, clean_url)
{
	const clean_encoded = [
		// full origin with various possible encodings
		clean_url.origin,
		encodeURIComponent(clean_url.origin),
		encodeURIComponent(clean_url.origin).replace(/\./gu, '%2E'),
		btoa(clean_url.origin.substring(0, clean_url.origin.length - clean_url.origin.length % 3)),

		// full origin with various possible encodings
		clean_url.hostname,
		encodeURIComponent(clean_url.hostname),
		encodeURIComponent(clean_url.hostname).replace(/\./gu, '%2E'),
		btoa(clean_url.hostname.substring(0, clean_url.origin.length - clean_url.hostname.length % 3)),
	]

	for (const needle of clean_encoded)
	{
		let pos;
		if (needle !== '' && (pos = haystack.indexOf(needle)) !== -1)
			return [pos, pos + needle.length];
	}

	return []
}


function remove_js(orig)
{
	const js_cleaned_link = extract_javascript_link(orig);
	if (js_cleaned_link)
	{
		const start = orig.indexOf(js_cleaned_link.href);
		const end = start + js_cleaned_link.href.length;

		return [js_cleaned_link, orig.slice(0, start), orig.slice(end)];
	}
	else
		return [new URL(orig)];
}


function append_rewritten_path({link_elem, orig, clean}, rules, actions_to_whitelist)
{
	link_elem.classList.add('rewrite');
	const orig_node = link_elem.querySelector('.original');

	// Gather the matches, their replacements, and their offsets in the original URL.
	// NB: this might not work if successive rules overwrite at the same locations.
	const matches = [];
	let modified_path = orig.pathname;
	for (const {search, replace, flags} of rules.rewrite)
	{
		modified_path = modified_path.replace(new RegExp(search, flags), replace);

		const global = (flags || '').indexOf('g') !== -1
		const pattern = new RegExp(search, (flags || '').replace('g', ''));

		for (let pos = 0, match; (global || pos === 0) && (match = orig.pathname.substr(pos).match(pattern)) !== null;
				pos += match.index + match[0].length)
		{
			// Manually compute the replacements
			let replacement = replace.replace(/\\$&/gu, match[0]);
			for (let i = 1; i < match.length; i++)
				replacement = replacement.replace(new RegExp(`\\$${i}`, 'gu'), match[i]);

			matches.push([pos + match.index, pos + match.index + match[0].length, replacement])
		}
	}

	matches.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]))
	matches.push([orig.pathname.length, orig.pathname.length, '']);

	const [embed_start, embed_end] = embed_url_pos(modified_path, clean), embed_range = new Range();
	let pos = 0;
	let modified_pos = 0;

	for (const [start, end, replacement] of matches)
	{
		// add path part common to original and rewritten URL
		if (start > pos)
		{
			append_decorated_text(link_elem, orig.pathname.substring(pos, start));
			modified_pos += start - pos;
			pos = start;
		}

		// mark start and/or end of embedded URL if it happened in the last common URL section
		if (embed_range.startContainer === document && embed_start <= modified_pos)
			embed_range.setStart(orig_node.lastChild,
								 orig_node.lastChild.textContent.length + embed_start - modified_pos);
		if (embed_range.collapsed && embed_end <= modified_pos)
			embed_range.setEnd(orig_node.lastChild, orig_node.lastChild.textContent.length + embed_end - modified_pos);

		// add path part removed from original URL
		if (end > pos)
		{
			append_decorated_text(link_elem, orig.pathname.substring(pos, end), 'deleted')
			pos = end;
		}

		// add path part inserted into rewritten URL
		if (replacement)
		{
			append_decorated_text(link_elem, replacement, 'inserted')
			modified_pos += replacement.length;
		}

		// mark start and/or end of embedded URL if it happened in the last replaced URL section
		if (embed_range.startContainer === document && embed_start <= modified_pos)
			embed_range.setStartAfter(orig_node.lastChild)
		if (embed_range.collapsed && embed_end <= modified_pos)
			embed_range.setEndAfter(orig_node.lastChild)
	}

	if (!embed_range.collapsed)
	{
		const span = document.createElement('span');
		span.classList.add(css_classes.embedded);
		embed_range.surroundContents(span);

		link_elem.classList.add('embed');
		actions_to_whitelist.whitelist_path = true;
		actions_to_whitelist.path = `^${orig.pathname.slice(0, embed_start)}`;
	}
}


function append_normal_path({link_elem, orig, clean}, actions_to_whitelist)
{
	const [match_start, match_end] = embed_url_pos(orig.pathname, clean);
	if (typeof match_start !== 'undefined' && typeof match_end !== 'undefined')
	{
		append_decorated_text(link_elem, orig.pathname.substring(0, match_start))
		append_decorated_text(link_elem, orig.pathname.substring(match_start, match_end), 'embedded')
		append_decorated_text(link_elem, orig.pathname.substring(match_end))

		link_elem.classList.add('embed');
		actions_to_whitelist.whitelist_path = true;
		actions_to_whitelist.path = `^${orig.pathname.slice(0, match_start)}`;
	}
	else
		append_decorated_text(link_elem, orig.pathname)
}


function append_query_param({link_elem, key, val, sep, clean}, keep, strip, actions_to_whitelist)
{
	let decorate, embed_start, embed_end, embed_found = false;

	if (keep)
		decorate = 'whitelist';
	else if (strip)
	{
		decorate = 'deleted';
		link_elem.classList.add('remove');
	}

	for (const [pre, string] of [[sep, key], ['=', val]])
	{
		const [embed_start, embed_end] = embed_url_pos(string, clean);

		if (typeof decorate === 'undefined' && typeof embed_start !== 'undefined')
		{
			append_decorated_text(link_elem, `${pre}${string.substring(0, embed_start)}`)
			append_decorated_text(link_elem, string.substring(embed_start, embed_end), 'embedded')
			append_decorated_text(link_elem, string.substring(embed_end))
			embed_found = true;

			link_elem.classList.add('embed');
		}
		else
			append_decorated_text(link_elem, `${pre}${string}`, decorate)
	}

	if (embed_found) {
		if (!('whitelist' in actions_to_whitelist))
			actions_to_whitelist.whitelist = []

		actions_to_whitelist.whitelist.push(key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'));
	}
}


/* exported cleaned_link_item */
function cleaned_link_item(link_elem, raw_orig, raw_clean)
{
	link_elem.setAttribute('title', '');

	const [orig, prefix, suffix] = remove_js(raw_orig), clean = new URL(raw_clean);
	const rules = Rules.find(orig);
	const actions_to_whitelist = {domain: orig.hostname, path: `^${orig.pathname}$`};

	const origin_node = link_elem.appendChild(document.createElement('span'));
	origin_node.setAttribute('raw-url', orig.href);
	origin_node.classList.add('original');

	if (prefix)
		append_decorated_text(link_elem, prefix, 'deleted')

	append_decorated_text(link_elem, orig.origin)

	if (rules.whitelist_path)
		append_decorated_text(link_elem, orig.pathname, 'whitelist')
	else if ('rewrite' in rules && rules.rewrite.length)
		append_rewritten_path({link_elem, orig, clean}, rules, actions_to_whitelist);
	else
		append_normal_path({link_elem, orig, clean}, actions_to_whitelist);

	let sep = '?';
	const keep = rules.whitelist.length ? new RegExp(`^(${rules.whitelist.join('|')})$`, 'u') : /.^/u;
	const strip = rules.remove.length ? new RegExp(`^(${rules.remove.join('|')})$`, 'u') : /.^/u;

	for (const [key, val] of orig.searchParams)
	{
		append_query_param({link_elem, key, val, sep, clean}, key.match(keep), key.match(strip), actions_to_whitelist);
		sep = '&';
	}

	// treat hash-bank links
	let hash_link;
	try {
		hash_link = orig.hash.startsWith('#!') && new URL(orig.hash.slice(2), orig.origin);
	} catch (err) {}

	if (hash_link)
	{
		append_normal_path({link_elem, orig: has_link, clean}, actions_to_whitelist);
		sep = '?';
		for (const [key, val] of hash_link.searchParams)
		{
			append_query_param({link_elem, key, val, sep, clean}, key.match(keep), key.match(strip), actions_to_whitelist);
			sep = '&';
		}
	}
	else
		append_decorated_text(link_elem, orig.hash)

	if (suffix)
		append_decorated_text(link_elem, suffix, 'deleted');

	const clean_node = link_elem.appendChild(document.createElement('span'));
	clean_node.setAttribute('raw-url', clean.href);
	clean_node.classList.add('cleaned');

	link_elem.setAttribute('title', `Original link:\n${link_elem.getAttribute('title')}\nCleaned to:\n${clean.href}`);
	clean_node.append(document.createTextNode(clean.href));

	if (Object.keys(actions_to_whitelist).length !== 2)
		link_elem.setAttribute('actions', JSON.stringify(actions_to_whitelist));

	return link_elem;
}

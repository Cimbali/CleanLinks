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
		let span = document.createElement('span');
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
	let clean_encoded = [
		// full origin with various possible encodings
		clean_url.origin,
		encodeURIComponent(clean_url.origin),
		encodeURIComponent(clean_url.origin).replace(/\./g, '%2E'),
		btoa(clean_url.origin.substring(0, clean_url.origin.length - clean_url.origin.length % 3)),

		// full origin with various possible encodings
		clean_url.hostname,
		encodeURIComponent(clean_url.hostname),
		encodeURIComponent(clean_url.hostname).replace(/\./g, '%2E'),
		btoa(clean_url.hostname.substring(0, clean_url.origin.length - clean_url.hostname.length % 3)),
	]

	for (let needle of clean_encoded)
	{
		let pos;
		if (needle !== '' && (pos = haystack.indexOf(needle)) !== -1)
			return [pos, pos + needle.length];
	}

	return []
}


function remove_js(orig)
{
	let js_cleaned_link = extract_javascript_link(orig), prefix = null, suffix = null;
	if (js_cleaned_link && js_cleaned_link !== orig)
	{
		let start = orig.indexOf(js_cleaned_link);
		let end = start + js_cleaned_link.length;

		return [new URL(js_cleaned_link), orig.slice(0, start), orig.slice(end)];
	}
	else
		return [new URL(orig)];
}


function append_rewritten_path(link_elem, orig, clean, rules, actions_to_whitelist)
{
	link_elem.classList.add('rewrite');
	let matches = [], modified_path = orig.pathname;

	for (let {search, replace, flags} of rules.rewrite)
	{
		modified_path = modified_path.replace(new RegExp(search, flags), replace);

		let global = flags.indexOf('g') !== -1
		let pattern = new RegExp(search, flags.replace('g', ''));

		for (let pos = 0, match; (global || pos === 0) && (match = orig.pathname.substr(pos).match(pattern)) !== null;
				pos += match.index + match[0].length)
		{
			// Manually compute the replacements
			let replacement = replace.replace(new RegExp('\\$&', 'g'), match[0]);
			for (let i = 1; i < match.length; i++)
				replacement = replacement.replace(new RegExp('\\$' + i, 'g'), match[i]);

			matches.push([pos + match.index, pos + match.index + match[0].length, replacement])
		}
	}

	let [embed_start, embed_end] = embed_url_pos(modified_path, clean), embed_range = undefined;
	if (embed_start !== undefined && embed_end !== undefined)
	{
		embed_range = new Range()

		actions_to_whitelist.whitelist_path = true;
		link_elem.classList.add('embed');
	}

	matches.sort((a, b) => (a[0] - b[0]) || a[1] - b[1])

	let pos = 0, modified_pos = 0;
	for (let [start, end, replacement] of matches)
	{
		if (start >= pos)
		{
			append_decorated_text(link_elem, orig.pathname.substring(pos, start));
			let increment = start - pos;

			if (embed_start !== undefined && embed_start >= modified_pos && embed_start <= modified_pos + increment)
			{
				embed_range.setStart(link_elem.querySelector('.original').lastChild, embed_start - modified_pos)
				embed_start = undefined;
			}
			if (embed_end !== undefined && embed_end >= modified_pos && embed_end <= modified_pos + increment)
			{
				embed_range.setEnd(link_elem.querySelector('.original').lastChild, embed_end - modified_pos)
				embed_end = undefined;
			}

			pos += increment;
			modified_pos += increment;
		}
		if (end > pos)
		{
			append_decorated_text(link_elem, orig.pathname.substring(pos, end), 'deleted')
			pos = end;
		}
		if (replacement)
		{
			append_decorated_text(link_elem, replacement, 'inserted')
			modified_pos += replacement.length;
		}

		if (embed_start !== undefined && embed_start <= modified_pos)
		{
			embed_range.setStartAfter(link_elem.querySelector('.original').lastChild)
			embed_start = undefined;
		}
		if (embed_end !== undefined && embed_end <= modified_pos)
		{
			embed_range.setEndAfter(link_elem.querySelector('.original').lastChild)
			embed_end = undefined;
		}
	}

	if (pos < orig.pathname.length)
		append_decorated_text(link_elem, orig.pathname.substring(pos))

	let increment = orig.pathname.length - pos;
	let clip = val => val < 0 ? 0 : (val >= increment ? increment - 1 : val)

	if (embed_start !== undefined)
		embed_range.setStart(link_elem.querySelector('.original').lastChild, clip(embed_start - modified_pos))
	if (embed_end !== undefined)
		embed_range.setEnd(link_elem.querySelector('.original').lastChild, clip(embed_end - modified_pos))

	if (embed_range !== undefined)
	{
		let span = document.createElement('span');
		span.classList.add(css_classes['embedded']);
		embed_range.surroundContents(span);
	}
}


function append_normal_path(link_elem, orig, clean, actions_to_whitelist)
{
	let [match_start, match_end] = embed_url_pos(orig.pathname, clean);
	if (match_start !== undefined && match_end !== undefined)
	{
		append_decorated_text(link_elem, orig.pathname.substring(0, match_start))
		append_decorated_text(link_elem, orig.pathname.substring(match_start, match_end), 'embedded')
		append_decorated_text(link_elem, orig.pathname.substring(match_end))

		actions_to_whitelist.whitelist_path = true;
		link_elem.classList.add('embed');
	}
	else
		append_decorated_text(link_elem, orig.pathname)
}


function append_query_param(link_elem, keyval, clean, keep, strip, actions_to_whitelist)
{
	let decorate = undefined, embed_start = undefined, embed_end = undefined;

	if (keep)
		decorate = 'whitelist'
	else if (strip)
	{
		decorate = 'deleted';
		link_elem.classList.add('remove');
	}
	else
		[embed_start, embed_end] = embed_url_pos(keyval, clean);

	if (embed_start !== undefined && embed_end !== undefined)
	{
		append_decorated_text(link_elem, keyval.substring(0, embed_start))
		append_decorated_text(link_elem, keyval.substring(embed_start, embed_end), 'embedded')
		append_decorated_text(link_elem, keyval.substring(embed_end))

		if (!('whitelist' in actions_to_whitelist))
			actions_to_whitelist.whitelist = []

		link_elem.classList.add('embed');
		return keyval.substring(1, keyval.indexOf('=')).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}
	else
		append_decorated_text(link_elem, keyval, decorate)
}


function cleaned_link_item(link_elem, raw_orig, raw_clean, classes)
{
	link_elem.setAttribute('title', '');
	link_elem.classList.add(...classes);

	const [orig, prefix, suffix] = remove_js(raw_orig), clean = new URL(raw_clean);
	const rules = Rules.find(orig);
	let actions_to_whitelist = {};

	let origin_node = link_elem.appendChild(document.createElement('span'));
	origin_node.setAttribute('raw-url', orig.href);
	origin_node.classList.add('original');

	if (prefix || suffix)
		link_elem.classList.add('javascript');

	console.log('Prefixing with', prefix, orig.href, orig.protocol, orig.origin);
	if (prefix)
		append_decorated_text(link_elem, prefix, 'deleted')

	append_decorated_text(link_elem, orig.origin)

	if (rules.whitelist_path)
		append_decorated_text(link_elem, orig.pathname, 'whitelist')
	else if ('rewrite' in rules && rules.rewrite.length)
		append_rewritten_path(link_elem, orig, clean, rules, actions_to_whitelist);
	else
		append_normal_path(link_elem, orig, clean, actions_to_whitelist);

	let sep = '?';
	const keep = rules.whitelist.length ? new RegExp('^(' + rules.whitelist.join('|') + ')$') : /.^/;
	const strip = rules.remove.length ? new RegExp('^(' + rules.remove.join('|') + ')$') : /.^/;

	for (let [key, val] of orig.searchParams)
	{
		const keyval = sep + encodeURIComponent(key) + '=' + encodeURIComponent(val);
		append_query_param(link_elem, keyval, clean, key.match(keep), key.match(strip), actions_to_whitelist);
		sep = '&';
	}

	if (suffix)
		append_decorated_text(link_elem, suffix, 'deleted');

	let clean_node = link_elem.appendChild(document.createElement('span'));
	clean_node.setAttribute('raw-url', clean.href);
	clean_node.classList.add('cleaned');

	link_elem.setAttribute('title', link_elem.getAttribute('title') + '\n-> ' + clean.href);
	clean_node.append(document.createTextNode(clean.href));

	if (Object.entries(actions_to_whitelist).length !== 0)
		link_elem.setAttribute('actions', JSON.stringify(actions_to_whitelist));

	return link_elem;
}

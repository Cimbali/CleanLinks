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


// N/A, stroke \u0336, low line \u0335, slashed through \u0338, double low line \u0333, overline \u305
const utf8_markers = {deleted: '\u0336', inserted: '\u0332', whitelist: '\u0338', embedded: '\u0333'};
const css_classes = {deleted: 'del', inserted: 'ins', whitelist: 'keep', embedded: 'url'};


function set_selected(evt)
{
	var selected = document.querySelector('#history .selected');
	if (selected) selected.classList.remove('selected');

	var target = evt.target;
	while (target && target.tagName !== 'P')
		target = target.parentNode;

	if (target)
		target.classList.add('selected');

	document.querySelector('#openonce').disabled = !target;
	document.querySelector('#whitelist').disabled = !target || !target.hasAttribute('actions');
	document.querySelector('#open_editor').disabled = !target;
}


function append_decorated(node, text, type)
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
	node.querySelector('span:last-child').appendChild(child);
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


function add_option(orig, clean, classes)
{
	var history = document.querySelector('#history');
	let option = document.createElement('p');

	option.setAttribute('title', '');
	option.classList.add(...classes);
	option.onclick = set_selected

	orig = new URL(orig)
	clean = new URL(clean)

	let origin_node = document.createElement('span');
	origin_node.setAttribute('raw-url', orig.href);
	origin_node.classList.add('original');
	option.appendChild(origin_node);

	let rules = Rules.find(orig);
	let actions_to_whitelist = {};

	append_decorated(option, orig.origin)

	if (rules.whitelist_path)
		append_decorated(option, orig.pathname, 'whitelist')

	else if ('rewrite' in rules && rules.rewrite.length)
	{
		option.classList.add('rewrite');
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
			option.classList.add('embed');
		}

		matches.sort((a, b) => (a[0] - b[0]) || a[1] - b[1])

		let pos = 0, modified_pos = 0;
		for (let [start, end, replacement] of matches)
		{
			if (start >= pos)
			{
				append_decorated(option, orig.pathname.substring(pos, start));
				let increment = start - pos;

				if (embed_start !== undefined && embed_start >= modified_pos && embed_start <= modified_pos + increment)
				{
					embed_range.setStart(origin_node.lastChild, embed_start - modified_pos)
					embed_start = undefined;
				}
				if (embed_end !== undefined && embed_end >= modified_pos && embed_end <= modified_pos + increment)
				{
					embed_range.setEnd(origin_node.lastChild, embed_end - modified_pos)
					embed_end = undefined;
				}

				pos += increment;
				modified_pos += increment;
			}
			if (end > pos)
			{
				append_decorated(option, orig.pathname.substring(pos, end), 'deleted')
				pos = end;
			}
			if (replacement)
			{
				append_decorated(option, replacement, 'inserted')
				modified_pos += replacement.length;
			}

			if (embed_start !== undefined && embed_start <= modified_pos)
			{
				embed_range.setStartAfter(origin_node.lastChild)
				embed_start = undefined;
			}
			if (embed_end !== undefined && embed_end <= modified_pos)
			{
				embed_range.setEndAfter(origin_node.lastChild)
				embed_end = undefined;
			}
		}

		if (pos < orig.pathname.length)
			append_decorated(option, orig.pathname.substring(pos))

		let increment = orig.pathname.length - pos;
		let clip = val => val < 0 ? 0 : (val >= increment ? increment - 1 : val)

		if (embed_start !== undefined)
			embed_range.setStart(origin_node.lastChild, clip(embed_start - modified_pos))
		if (embed_end !== undefined)
			embed_range.setEnd(origin_node.lastChild, clip(embed_end - modified_pos))

		if (embed_range !== undefined)
		{
			let span = document.createElement('span');
			span.classList.add(css_classes['embedded']);
			embed_range.surroundContents(span);
		}
	}
	else
	{
		let [match_start, match_end] = embed_url_pos(orig.pathname, clean);
		if (match_start !== undefined && match_end !== undefined)
		{
			append_decorated(option, orig.pathname.substring(0, match_start))
			append_decorated(option, orig.pathname.substring(match_start, match_end), 'embedded')
			append_decorated(option, orig.pathname.substring(match_end))

			actions_to_whitelist.whitelist_path = true;
			option.classList.add('embed');
		}
		else
			append_decorated(option, orig.pathname)
	}

	let sep = '?';
	const keep = rules.whitelist.length ? new RegExp('^(' + rules.whitelist.join('|') + ')$') : /.^/;
	const strip = rules.remove.length ? new RegExp('^(' + rules.remove.join('|') + ')$') : /.^/;

	for (let [key, val] of orig.searchParams)
	{
		let decorate = undefined, embed_start = undefined, embed_end = undefined;
		let keyval = sep + encodeURIComponent(key) + '=' + encodeURIComponent(val);
		sep = '&';

		if (key.match(keep))
			decorate = 'whitelist'
		else if (key.match(strip))
		{
			decorate = 'deleted';
			option.classList.add('remove');
		}
		else
			[embed_start, embed_end] = embed_url_pos(keyval, clean);

		if (embed_start !== undefined && embed_end !== undefined)
		{
			append_decorated(option, keyval.substring(0, embed_start))
			append_decorated(option, keyval.substring(embed_start, embed_end), 'embedded')
			append_decorated(option, keyval.substring(embed_end))

			if (!('whitelist' in actions_to_whitelist))
				actions_to_whitelist.whitelist = []

			actions_to_whitelist.whitelist.push(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
			option.classList.add('embed');
		}
		else
			append_decorated(option, keyval, decorate)
	}

	let clean_node = document.createElement('span');
	clean_node.setAttribute('raw-url', clean.href);
	clean_node.classList.add('cleaned');
	option.appendChild(clean_node);

	option.setAttribute('title', option.getAttribute('title') + '\n-> ' + clean.href);
	clean_node.append(document.createTextNode(clean.href))

	if (Object.entries(actions_to_whitelist).length !== 0)
		option.setAttribute('actions', JSON.stringify(actions_to_whitelist));

	history.appendChild(option);
}


function filter_from_input(evt)
{
	let filter_cat = {}, filter_act = {};
	for (let input of document.querySelectorAll('#filter_categories input'))
		filter_cat[input.name] = input.checked;

	for (let input of document.querySelectorAll('#filter_actions input'))
		filter_act[input.name] = input.checked;

	for (let opt of document.querySelectorAll('#history p'))
	{
		// There is a single category per item, that must be selected, and there are a number of actions of which any one can be selected
		let category_selected = false, action_matched = false;

		for (let class_name of opt.classList)
		{
			if (class_name in filter_cat)
				category_selected = filter_cat[class_name]
			else if (class_name in filter_act)
				action_matched = action_matched || filter_act[class_name];
		}

		opt.style.display = category_selected && action_matched ? 'block' : 'none';
	}
}


function populate_popup()
{
	document.querySelector('#title').prepend(document.createTextNode(title + ' v' + version));
	document.querySelector('#homepage').setAttribute('href', homepage);
	document.querySelector('#homepage').setAttribute('title', title + ' homepage');

	if (!Prefs.values.cltrack)
	{
		document.querySelector('#history').classList.add('disabled')
		document.querySelector('button#whitelist').disabled = true;
		document.querySelector('button#clearlist').disabled = true;
		return;
	}

	browser.tabs.query({active: true, currentWindow: true}).then(tab_list =>
	{
		let tab_id = tab_list[0].id;

		browser.runtime.sendMessage({action: 'cleaned list', tab_id: tab_id}).then(response =>
		{
			for (let clean of response)
			{
				let classes = [clean.type];
				if ('dropped' in clean)
					classes.push('dropped')
				else if (clean.type === 'promoted')
					classes.push('clicked')

				add_option(clean.orig, clean.url, classes);
			}

			for (input of document.querySelectorAll('.filters input'))
				input.onchange = filter_from_input

			filter_from_input()

			document.querySelector('button#clearlist').disabled = response.length === 0;
		});

		browser.runtime.sendMessage({action: 'check tab enabled', tab_id: tab_id}).then(answer =>
		{
			document.querySelector('input#enabled').checked = answer.enabled;
		})

		document.querySelector('#toggle').onclick = () =>
		{
			browser.runtime.sendMessage({action: 'toggle', tab_id: tab_id});
			document.querySelector('input#enabled').checked = !document.querySelector('input#enabled').checked;
		}

		document.querySelector('#whitelist').onclick = () =>
		{
			let selected = document.querySelector('#history p.selected');
			let actions = JSON.parse(selected.getAttribute('actions'));
			let url = new URL(selected.querySelector('.original').getAttribute('raw-url'));

			Rules.add({domain: url.hostname, path: '^' + url.pathname + '$', ...actions}).then(() =>
				browser.runtime.sendMessage({action: 'rules'})
			)
		}

		document.querySelector('#clearlist').onclick = () =>
		{
			browser.runtime.sendMessage({action: 'clearlist', tab_id: tab_id});
			// remove cleared (all) elements (should be in sendMessage.then())
			document.querySelectorAll('#history p').forEach(opt => { opt.remove() });
		}

		document.querySelector('#openonce').onclick = () =>
		{
			var selected = document.querySelector('#history .selected');
			if (selected)
				browser.runtime.sendMessage({action: 'open bypass', tab_id: tab_id, target: same_tab,
											 link: selected.querySelector('.original').getAttribute('raw-url')});
		}
	});
}


function add_listeners()
{
	document.querySelector('#open_editor').onclick = () =>
	{
		var selected = document.querySelector('#history .selected');
		if (!selected)
			return;

		browser.runtime.sendMessage({action: 'set prepopulate', link: selected.firstChild.getAttribute('raw-url')}).then(() =>
		{
			browser.runtime.openOptionsPage();
			window.close();
		});
	}

	document.querySelector('#options').onclick = () =>
	{
		browser.runtime.openOptionsPage();
		window.close();
	}

	document.addEventListener('keyup', e =>
	{
		var selected = document.querySelector('#history .selected');
		if (e.key === 'ArrowUp')
		{
			if (selected === null)
				document.querySelector('#history').lastChild.click()
			else if (selected.previousSibling)
				selected.previousSibling.click()
			document.querySelector('#history .selected').scrollIntoView(true)
		}
		else if (e.key === 'ArrowDown')
		{
			if (selected === null)
				document.querySelector('#history').firstChild.click()
			else if (selected.nextSibling)
				selected.nextSibling.click()
			document.querySelector('#history .selected').scrollIntoView(false)
		}
		else
			return;

		e.stopPropagation();
		e.preventDefault();
	});

	document.addEventListener('copy', e =>
	{
		var selected = document.querySelector('#history .selected');

		if (selected)
		{
			e.clipboardData.setData('text/plain', selected.childNodes[0].getAttribute('raw-url') + '\n'
												+ selected.childNodes[1].getAttribute('raw-url'));
			e.preventDefault();
		}
	});
}

apply_i18n();
add_listeners()
Prefs.loaded.then(populate_popup);

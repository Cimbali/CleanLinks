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


function set_selected(evt)
{
	var selected = document.querySelector('#history .selected');
	if (selected) selected.classList.remove('selected');

	var target = evt.target;
	while (target && target.tagName !== 'P')
		target = target.parentNode;

	if (target) target.classList.add('selected');
	document.querySelector('#openonce').disabled = !target;
	document.querySelector('#whitelist').disabled = !target;
	document.querySelector('#open_editor').disabled = !target;
}

// N/A, stroke \u0336, low line \u0335, slashed through \u0338, double low line \u0333, overline \u305
const utf8_markers = {deleted: '\u0336', inserted: '\u0332', whitelist: '\u0338', embedded: '\u0333'};
const css_classes = {deleted: 'del', inserted: 'ins', whitelist: 'keep', embedded: 'url'};


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
	let dest_base = clean_url.origin.slice(clean_url.protocol.length + 2);
	let clean_encoded = [
		clean_url.protocol.slice(0, -1) + '://' + dest_base,
		clean_url.protocol.slice(0, -1) + encodeURIComponent('://') + dest_base,
		encodeURIComponent(clean_url.origin),
		encodeURIComponent(clean_url.origin).replace(/\./g, '%2E'),
		dest_base,
		encodeURIComponent(dest_base),
		encodeURIComponent(dest_base).replace(/\./g, '%2E'),
	]

	for (let needle of clean_encoded)
	{
		let pos = haystack.indexOf(needle)
		if (pos !== -1)
			return [pos, pos + needle.length];
	}

	// TODO: base 64 encoded base
}


function add_option(orig, clean, classes)
{
	var history = document.querySelector('#history');
	let option = document.createElement('p');

	option.setAttribute('value', '' + history.querySelectorAll('p').length);
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

	append_decorated(option, orig.origin)

	if (rules.whitelist_path)
		append_decorated(option, orig.pathname, 'whitelist')

	else if ('rewrite' in rules && rules.rewrite.length)
	{
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

		let [embed_start, embed_end] = embed_url_pos(modified_path, clean) || [], embed_range = undefined;
		if (embed_start !== undefined && embed_end !== undefined)
			embed_range = new Range()

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
		let embed_pos = embed_url_pos(orig.pathname, clean);
		if (embed_pos)
		{
			let [match_start, match_end] = embed_pos
			append_decorated(option, orig.pathname.substring(0, match_start))
			append_decorated(option, orig.pathname.substring(match_start, match_end), 'embedded')
			append_decorated(option, orig.pathname.substring(match_end))
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
			decorate = 'deleted';
		else
			[embed_start, embed_end] = embed_url_pos(keyval, clean) || [];

		if (embed_start !== undefined && embed_end !== undefined)
		{
			append_decorated(option, keyval.substring(0, embed_start))
			append_decorated(option, keyval.substring(embed_start, embed_end), 'embedded')
			append_decorated(option, keyval.substring(embed_end))
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

	history.appendChild(option);
}


function filter_from_input(input)
{
	var opts = Array.from(document.querySelectorAll('#history p.' + input.name));
	var displ = input.checked ? 'block' : 'none';
	opts.forEach(opt => opt.style.display = displ);
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
			response.forEach(clean => add_option(clean.orig, clean.url,
												'dropped' in clean ? ['dropped', clean.type] : [clean.type]));

			Array.from(document.querySelectorAll('#filters input')).forEach(input =>
			{
				filter_from_input(input);
				input.onchange = () => filter_from_input(input)
			});

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
			var selected = document.querySelector('#history p.selected');
			var id = parseInt(selected.getAttribute('value'));
			browser.runtime.sendMessage({action: 'whitelist', item: id, tab_id: tab_id});
			// remove selected element, and renumber remaining ones (should be in sendMessage.then())
			selected.remove();
			document.querySelectorAll('#history p').forEach((opt, idx) => { opt.setAttribute('value', '' + idx) });
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
											 link: selected.childNodes[0].innerText});
		}
	});

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
Prefs.loaded.then(populate_popup);

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

	if (target)
		target.classList.add('selected');

	document.querySelector('#openonce').disabled = !target;
	document.querySelector('#whitelist').disabled = !target || !target.hasAttribute('actions');
	document.querySelector('#blacklist').disabled = !target || !target.hasAttribute('actions');
	document.querySelector('#open_editor').disabled = !target;
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
		document.querySelector('button#blacklist').disabled = true;
		document.querySelector('button#clearlist').disabled = true;
		return;
	}

	let location_search = new URLSearchParams(document.location.search.substring(1)), resolve_tab_id;
	if (location_search.has('tab'))
		resolve_tab_id = Promise.resolve(parseInt(location_search.get('tab')));
	else
		resolve_tab_id = browser.tabs.query({active: true, currentWindow: true}).then(tab_list => tab_list[0].id)

	resolve_tab_id.then(tab_id =>
	{
		browser.runtime.sendMessage({action: 'cleaned list', tab_id: tab_id}).then(response =>
		{
			const history = document.getElementById('history');
			for (let clean of response)
			{
				let classes = [clean.type];
				if ('dropped' in clean)
					classes.push('dropped')
				else if (clean.type === 'promoted')
					classes.push('clicked')

				const link_elem = document.createElement('p');
				link_elem.onclick = set_selected
				history.appendChild(cleaned_link_item(link_elem, clean.orig, clean.url, classes));
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

		document.querySelector('#refresh').onclick = () =>
		{
			browser.tabs.reload(tab_id);
		}

		document.querySelector('#whitelist').onclick = () =>
		{
			Rules.add(JSON.parse(document.querySelector('#history p.selected').getAttribute('actions'))).then(() =>
				browser.runtime.sendMessage({action: 'rules'})
			)
		}

		document.querySelector('#blacklist').onclick = () =>
		{
			let rules = JSON.parse(document.querySelector('#history p.selected').getAttribute('actions'));

			rules.remove = rules.whitelist.slice();
			delete rules.whitelist;

			Rules.add(rules).then(() => browser.runtime.sendMessage({action: 'rules'}))
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
			{
				const url = selected.querySelector('.original').getAttribute('raw-url');
				browser.runtime.sendMessage({action: 'open bypass', link: url})
								.then(() => browser.tabs.update(tab_id, {url: url}));
			}
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

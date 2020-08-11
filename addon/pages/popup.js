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


const cleaned_items_list = [];

function set_selected(evt)
{
	const selected = document.querySelector('#history .selected');
	if (selected) selected.classList.remove('selected');

	let target = evt.target;
	while (target && target.tagName !== 'P')
		target = target.parentNode;

	if (target)
		target.classList.add('selected');

	document.querySelector('#copy').disabled = !target;
	document.querySelector('#openonce').disabled = !target;
	document.querySelector('#whitelist').disabled = !target || !target.hasAttribute('actions');
	document.querySelector('#blacklist').disabled = !target || !target.hasAttribute('actions');
	document.querySelector('#open_editor').disabled = !target;
}


function filter_from_input(opt_iterable)
{
	let filter_cat = {}, filter_act = {};
	for (let input of document.querySelectorAll('#filter_categories input'))
		filter_cat[input.name] = input.checked;

	for (let input of document.querySelectorAll('#filter_actions input'))
		filter_act[input.name] = input.checked;

	// By default, apply to all “opt”s in #history
	if (opt_iterable === undefined || opt_iterable instanceof Event)
		opt_iterable = cleaned_items_list;

	for (const { page, link } of opt_iterable)
	{
		// There is a single category per item, that must be selected,
		// and there are a number of actions of which any one can be selected
		let category_selected = false, action_matched = false;

		for (const class_name of link.classList)
		{
			if (class_name in filter_cat)
				category_selected = filter_cat[class_name]
			else if (class_name in filter_act)
				action_matched = action_matched || filter_act[class_name];
		}

		// Always remove when filtering to guarantee ordering
		const is_first_link = page.children.length === 0 || page.firstChild.isSameNode(link);

		if (link.parentNode)
			page.removeChild(link);

		if (is_first_link || category_selected && action_matched && !page.classList.contains('closed'))
			page.appendChild(link);
	}
}


function toggle_expand(evt)
{
	if (evt.target.classList.contains('closed'))
		evt.target.classList.remove('closed');
	else
		evt.target.classList.add('closed');

	filter_from_input();
}


function add_cleaning_action(link_elem, action)
{
	link_elem.classList.add(action);
	const cleaned = link_elem.querySelector('.cleaned');
	const span = cleaned.insertBefore(document.createElement('span'), cleaned.firstChild);
	span.classList.add('icon')
	span.classList.add(action)
}


function link_parent(history, url)
{
	const last_parent = history.lastChild;
	if (last_parent && last_parent.querySelector('p').textContent === url)
		return history.lastChild;

	const item = document.createElement('div');
	if (url !== undefined)
	{
		item.appendChild(document.createElement('p')).appendChild(document.createTextNode(url));
		item.firstChild.classList.add('noclean-parent');
	}
	item.addEventListener('click', toggle_expand);
	return history.appendChild(item);
}


function append_link(history, link, start_closed)
{
	const link_elem = cleaned_link_item(document.createElement('p'), link.orig, link.url);

	link_elem.classList.add(link.type);
	if (link.type === 'promoted')
		link_elem.classList.add('clicked')

	if ('dropped' in link)
		add_cleaning_action(link_elem, 'dropped');

	const { embed, remove, rewrite, javascript } = link.cleaned;
	if (embed)
		add_cleaning_action(link_elem, 'embed');
	if (remove && remove.length !== 0)
		add_cleaning_action(link_elem, 'remove');
	if (rewrite)
		add_cleaning_action(link_elem, 'rewrite');
	if (javascript)
		add_cleaning_action(link_elem, 'javascript');

	link_elem.addEventListener('click', set_selected);

	const item = { page: link_parent(history, link.parent), link: link_elem };
	cleaned_items_list.push(item);

	if (start_closed)
		item.page.classList.add('closed');

	filter_from_input([item])

	document.querySelector('button#clearlist').disabled = false;
}


async function populate_popup()
{
	document.querySelector('#title a').prepend(document.createTextNode(`${title} v${version} — `));
	document.querySelector('#homepage').setAttribute('href', homepage);
	document.querySelector('#homepage').setAttribute('title', `${title} ${_('homepage')}`);

	if (Prefs.values.httpall)
		document.querySelector('#history').classList.add('hierarchy')
	else
		document.querySelector('#history').classList.add('one-level')

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

	const tab_id = await resolve_tab_id;

	await browser.runtime.sendMessage({action: 'check tab enabled', tab_id: tab_id}).then(answer =>
	{
		const enabled = document.querySelector('input#enabled');
		enabled.checked = answer.enabled;
		enabled.onchange = () => browser.runtime.sendMessage({action: 'toggle', tab_id: tab_id});
		document.querySelector('#toggle_off').addEventListener('click', e => { enabled.checked = false; enabled.onchange(); })
		document.querySelector('#toggle_on').addEventListener('click', e => { enabled.checked = true; enabled.onchange(); })
	})

	await browser.runtime.sendMessage({action: 'cleaned list', tab_id: tab_id}).then(response =>
	{
		const history = document.getElementById('history');
		for (const clean of response)
			append_link(history, clean, Prefs.values.httpall);

		if (history.lastChild)
		{
			history.lastChild.classList.remove('closed');
			filter_from_input(cleaned_items_list.filter(({ page }) => page.isSameNode(history.lastChild)))
		}

		for (input of document.querySelectorAll('.filters input'))
			input.onchange = filter_from_input

		document.querySelector('button#clearlist').disabled = response.length === 0;
	});

	return tab_id
}


async function add_tab_listeners(tab_id)
{
	document.querySelector('#clearlist').addEventListener('click', e =>
	{
		const history = document.getElementById('history');
		const count = cleaned_items_list.length;

		browser.runtime.sendMessage({action: 'clearlist', tab_id: tab_id}).catch(() => {}).then(() =>
		{
			for (const { page, link } of cleaned_items_list.splice(0, count))
				if (link.parentNode)
					page.removeChild(link);

			// Do not remove pages that still have links to show
			for (const page of Array.from(history.children))
				if (cleaned_items_list.find(({ page: keep }) => page.isSameNode(keep)) === undefined)
					history.removeChild(page)
		});
	});

	document.querySelector('#refresh').addEventListener('click', e =>
	{
		browser.tabs.reload(tab_id);
	});

	document.querySelector('#whitelist').addEventListener('click', e =>
	{
		Rules.add(JSON.parse(document.querySelector('#history p.selected').getAttribute('actions'))).then(() =>
			browser.runtime.sendMessage({action: 'rules'})
		)
	});

	document.querySelector('#blacklist').addEventListener('click', e =>
	{
		let rules = JSON.parse(document.querySelector('#history p.selected').getAttribute('actions'));

		rules.remove = rules.whitelist.slice();
		delete rules.whitelist;

		Rules.add(rules).then(() => browser.runtime.sendMessage({action: 'rules'}))
	});

	document.querySelector('#openonce').addEventListener('click', e =>
	{
		const selected = document.querySelector('#history .selected');
		if (selected)
		{
			const url = selected.querySelector('.original').getAttribute('raw-url');
			browser.runtime.sendMessage({action: 'open bypass', link: url})
							.then(() => browser.tabs.update(tab_id, {url: url}));
		}
	});

	// last one: start appending newly cleaned links
	browser.runtime.onMessage.addListener(message =>
	{
		if (message.action === 'notify' && message.tab_id === tab_id)
			append_link(document.getElementById('history'), message);
		else
			return Promise.resolve('Popup page ignored unknown message ' + message.action)
	});
}


async function add_listeners()
{
	const android = (await browser.runtime.getPlatformInfo()).os === 'android';

	document.querySelector('#open_editor').addEventListener('click', e =>
	{
		const selected = document.querySelector('#history .selected');
		if (!selected)
			return;

		// On javascript links, edit rules for parent page
		const link = selected.classList.contains('javascript') ?
						selected.parentNode.firstChild.textContent :
						selected.firstChild.getAttribute('raw-url');

		browser.runtime.sendMessage({ action: 'set prepopulate', link })
			.then(() => browser.runtime.openOptionsPage())
			.then(() => { if (!android) window.close(); });
	});

	document.querySelector('#options').addEventListener('click', e =>
	{
		browser.runtime.openOptionsPage();
		if (!android)
			window.close();
	});

	document.addEventListener('keyup', e =>
	{
		const selected = document.querySelector('#history p.selected span.original');
		const cleaned = document.querySelectorAll('#history span.original');
		const pos = selected ? Array.from(cleaned).findIndex(p => selected.isSameNode(p)) : -1;

		if (e.key === 'ArrowUp')
			cleaned[pos < 1 ? cleaned.length - 1 : pos - 1].parentNode.click();
		else if (e.key === 'ArrowDown')
			cleaned[(pos + 1) % cleaned.length].parentNode.click();
		else
			return;

		document.querySelector('#history .selected').scrollIntoView(false)
		e.stopPropagation();
		e.preventDefault();
	});

	document.querySelector('#copy').addEventListener('click', e =>
	{
		const selected = document.querySelector('#history .selected');
		if (selected)
		{
			const text = selected.querySelector('.original').getAttribute('raw-url') + '\n'
						+ selected.querySelector('.cleaned').getAttribute('raw-url');
			navigator.clipboard.writeText(text);
		}
	});

	document.addEventListener('copy', e =>
	{
		const selected = document.querySelector('#history .selected');

		if (selected)
		{
			e.clipboardData.setData('text/plain', selected.querySelector('.original').getAttribute('raw-url') + '\n'
												+ selected.querySelector('.cleaned').getAttribute('raw-url'));
			e.preventDefault();
		}
	});
}

apply_i18n();
add_listeners()
Prefs.loaded.then(populate_popup).then(add_tab_listeners);

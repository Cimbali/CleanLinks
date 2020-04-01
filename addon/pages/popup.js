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
		opt_iterable = document.querySelectorAll('#history p');

	for (let opt of opt_iterable)
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


function add_cleaning_action(link_elem, action)
{
	link_elem.classList.add(action);
}


function append_link(history, link)
{
	const link_elem = cleaned_link_item(document.createElement('p'), link.orig, link.url);

	link_elem.classList.add(link.type);
	if ('dropped' in link)
		link_elem.classList.add('dropped')
	else if (link.type === 'promoted')
		link_elem.classList.add('clicked')

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
	filter_from_input([link_elem])

	history.appendChild(link_elem);
	document.querySelector('button#clearlist').disabled = false;
}


async function populate_popup()
{
	document.querySelector('#title a').prepend(document.createTextNode(`${title} v${version} — `));
	document.querySelector('#homepage').setAttribute('href', homepage);
	document.querySelector('#homepage').setAttribute('title', `${title} ${_('homepage')}`);

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
		for (let clean of response)
			append_link(history, clean);

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
		const count = history.children.length;

		browser.runtime.sendMessage({action: 'clearlist', tab_id: tab_id}).catch(() => {}).then(() =>
		{
			for (let i = 0; i < count; i++)
				history.firstChild.remove();
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

		const link = selected.firstChild.getAttribute('raw-url');
		browser.runtime.sendMessage({action: 'set prepopulate', link })
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
		const selected = document.querySelector('#history .selected');
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

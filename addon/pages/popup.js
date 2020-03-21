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


function append_link(history, link)
{
	let classes = [link.type];
	if ('dropped' in link)
		classes.push('dropped')
	else if (link.type === 'promoted')
		classes.push('clicked')

	const link_elem = cleaned_link_item(document.createElement('p'), link.orig, link.url, classes);
	link_elem.onclick = set_selected
	filter_from_input([link_elem])

	history.appendChild(link_elem);
	document.querySelector('button#clearlist').disabled = false;
}


async function populate_popup()
{
	document.querySelector('#title a').prepend(document.createTextNode(title + ' v' + version));
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
		document.querySelector('#toggle_off').onclick = () => enabled.checked = false;
		document.querySelector('#toggle_on').onclick = () => enabled.checked = true;
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

	return tab_id
}


function start_appending_new_links(tab_id)
{
	browser.runtime.onMessage.addListener(message =>
	{
		if (message.action === 'notify' && message.tab_id === tab_id)
			append_link(document.getElementById('history'), message);
		else
			return Promise.resolve('Popup page ignored unknown message ' + message.action)
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
		});
	}

	document.querySelector('#options').onclick = () =>
	{
		browser.runtime.openOptionsPage();
	}

	document.querySelector('#clearlist').onclick = () =>
	{
		browser.runtime.sendMessage({action: 'clearlist', tab_id: tab_id});
		// remove cleared (all) elements (should be in sendMessage.then())
		const history = document.getElementById('history');
		while (history.lastChild)
			history.lastChild.remove();
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
Prefs.loaded.then(populate_popup).then(start_appending_new_links);

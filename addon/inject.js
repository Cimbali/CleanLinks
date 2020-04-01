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

'use strict'

function highlight_link(node, remove)
{
	// parse and apply ;-separated list of key:val style properties
	let css_property_list = ('' + Prefs.values.hlstyle).split(';').map(r => r.split(':').map(s => s.trim()));
	for (let [prop, val] of css_property_list)
		node.style.setProperty(prop, remove ? '' : val, 'important');
}


function find_target_frame(wnd, target)
{
	if (target === '_top')
		return wnd.top || wnd;
	else if (target === '_parent')
		return wnd.parent || wnd;
	else if (target !== '_self')
		return Array.from(wnd.frames).find(f => f.name === target) || wnd;
	else
		return wnd;
}


function event_do_click(url, node, evt)
{
	if (evt.button == 0 && evt.altKey)
		return false; // alt+click, do nothing

	evt.stopPropagation();
	evt.preventDefault();

	// NB: use default _self target if we don’t want to follow target attributes
	const target = Prefs.values.gotarget && node.hasAttribute('target') && node.getAttribute('target') || '_self';

	const open_new_tab = evt.ctrlKey || evt.button == 1 || evt.metaKey || target === '_blank';
	const open_new_win = evt.shiftKey;

	// same tab => find the correct frame
	const wnd = find_target_frame(node.ownerDocument.defaultView || window, target);

	if (open_new_tab || open_new_win)
		browser.runtime.sendMessage({ action: 'open url', link: url, target: open_new_tab ? new_tab : new_window })
			.catch(() => { wnd.top.location = url; })

	else if (wnd)
		wnd.location = url;

	else
		browser.runtime.sendMessage({ action: 'open url', link: url, target: same_tab })

	return true;
}


function find_click_target(node)
{
	do
	{
		if (node.nodeName === 'A')
			return { node, href: node.href };

	}
	while (['A', 'BODY', 'HTML'].indexOf(node.nodeName) === -1 && (node = node.parentNode));

	return {}
}


// NB: this is not great to decode obfuscated javascript codes, but at least returns if there are events
function find_click_event(node)
{
	const searched_events = ['click', 'mousedown', 'touchstart', 'mouseup']
	do
	{
		const actions = (node.hasAttribute('jsaction') && node.getAttribute('jsaction').split(';') || [])
								.filter(val => val.trim().length !== 0)
								.map(val => val.trim().split(':', 2))
								.map(act => act.length === 1 ? ['click'].concat(act) : act);

		let jsaction;
		for (const event_type of searched_events)
			if (node.hasAttribute(`on${event_type}`) && node[`on${event_type}`])
			{
				const func = node[`on${event_type}`].toString();
				return { node, func: func.slice(func.indexOf('{') + 1, func.lastIndexOf('}')), event_type }
			}
			else if (jsaction = actions.find(([evt, func]) => evt === event_type))
			{
				const [evt, func] = jsaction;
				return { node, func, event_type };
			}
	}
	while (node.nodeName !== 'HTML' && (node = node.parentNode));

	return {}
}


function on_pre_click(evt)
{
	const { href, node } = find_click_target(evt.target);

	// This is a valid link: cancel onmousedown trickeries by stopping the event.
	if (href)
	{
		evt.stopPropagation();
		evt.preventDefault();
	}
}


function on_click(evt)
{
	const { href, func, node, event_type } = { ...find_click_event(evt.target), ...find_click_target(evt.target) };

	const text_link = href || func;
	log(`click on ${node.nodeName} ${node} with URL "${text_link}" and event ${event_type}`)

	if (!text_link)
		return;

	last_clicked = node;
	try
	{
		let url = new URL(text_link, window.location)
		browser.runtime.sendMessage({action: 'highlight', link: url.href}).catch(() => {});
	}
	catch (e)
	{
		browser.runtime.sendMessage({action: 'highlight', link: text_link}).catch(() => {});
	}


	const base = (node.ownerDocument.defaultView || window).location.href;
	let cleaned_link = extract_javascript_link(text_link, base);

	// report that we cleaned the javascript from the node’s href
	if (cleaned_link && href)
		event_type = 'href';

	try
	{
		// NB: if there is an identified javascript event (i.e. event_type defined), or if we
		// need to override the link’s target attribute, we need to prevent the click event,
		// and perform the action of activating the link manually, even if the link is clean.
		if (href && !cleaned_link && (event_type || !Prefs.values.gotarget))
			cleaned_link = new URL(href, base);
	}
	catch(e) {}

	if (!cleaned_link)
		return;

	log(`Cleaning javascript ${text_link} to ${cleaned_link}`)
	if (event_do_click(cleaned_link, node, evt) && event_type)
		// Only notify if we managed to clean, and we did not come here only to override target
		browser.runtime.sendMessage({
			action: 'notify',
			url: cleaned_link,
			orig: text_link,
			type: 'clicked',
			parent: base,
			cleaned: {javascript: event_type}
		}).catch(() => {});
}


let tab_enabled = false;
let last_clicked = null;

function toggle_active(enabled)
{
	if (tab_enabled === enabled)
		return;

	tab_enabled = enabled;

	if (enabled)
	{
		window.addEventListener('click', on_click, {capture: true});
		window.addEventListener('mousedown', on_pre_click, {capture: true});
		window.addEventListener('touchstart', on_pre_click, {capture: true});
	}
	else
	{
		window.removeEventListener('click', on_click, {capture: true});
		window.removeEventListener('mousedown', on_pre_click, {capture: true});
		window.removeEventListener('touchstart', on_pre_click, {capture: true});
	}
}

browser.runtime.sendMessage({action: 'check tab enabled'})
	.then(answer => answer !== undefined && toggle_active(answer.enabled))
	.catch(() => {});


browser.runtime.onMessage.addListener(message =>
{
	if (message.action === 'reload options')
		return Prefs.reload();
	else if (message.action === 'toggle')
	{
		toggle_active(message.active);
		return Promise.resolve({});
	}
	else if (message.action === 'highlight')
	{
		if (last_clicked !== null)
			highlight_link(last_clicked, false);

		last_clicked = null;
		return Promise.resolve({});
	}
	else
		return Promise.reject('Unexpected message: ' + String(message));
});
console.log('successfully injected');

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

let tab_enabled = false;
let highlight_node = null;
let pre_cleaned_node = null;


function highlight_link(node, remove)
{
	// parse and apply ;-separated list of key:val style properties
	const css_property_list = ('' + Prefs.values.hlstyle).split(';').map(r => r.split(':').map(s => s.trim()));
	for (const [prop, val] of css_property_list)
		node.style.setProperty(prop, remove ? '' : val, 'important');

	return node;
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
	const target = node.getAttribute('target') || '_self';
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
		{
			const href = node.getAttribute('href');
			// only return the href if it’s not an obvious NOP
			if (href === '#' || href.match(/^javascript:(void\(0?\)|\/\/)?;?$/))
				return { node }
			else
				return { node, href: node.href };
		}
	}
	while (['A', 'BODY', 'HTML'].indexOf(node.nodeName) === -1 && (node = node.parentNode));

	return {}
}


// NB: this is not great to decode obfuscated javascript codes, but at least returns if there are events
function find_click_event(node, searched_events)
{
	if (searched_events === undefined)
		searched_events = ['click', 'mousedown', 'touchstart', 'mouseup', 'touchend'];

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


function find_text_link(node)
{
	const selection = node.ownerDocument && node.ownerDocument.defaultView.getSelection();

	if (!selection || !selection.isCollapsed || selection.rangeCount !== 1)
		return;

	// A) Find node’s text content and click position therein

	// sanitize node content: remove 0-space tags, replace other tags with spaces
	let text = node.innerHTML.replace(/<\/?wbr>/ig, '').replace(/<[^>]+?>/g, ' ');
	let pos = text.indexOf(selection.focusNode.data) + selection.focusOffset;

	// Alternate/fallback with textContent (do we need this?)
	// NB: textContent squashes tags completely, such as <br /> -- this could lead to wrong links.
	if (pos === -1)
	{
		text = node.textContent;
		pos = text.indexOf(selection.focusNode.textContent) + selection.focusOffset;
	}

	// B) Extract clicked word and verify it looks like an (absolute) URL
	// move start of selection backwards until start of data or a boundary character
	while (pos !== -1)
		if (' "\'<>\n\r\t()[]|'.includes(text[pos]))
			break;
		else
			pos--;


	const [matched, ] = text.substring(pos + 1).match(/^\s*(?:\w+:\/\/|www\.)[^\s">]{4,}/) || [];

	if (!matched)
		return;

	// C) Return parsed URL and its position in the document
	const url = matched.trim().replace(/[\ \"\'\<\>\n\r\	\(\)\[\]\|]+$/, '');
	const protocol = matched.includes('://') ? '' : node.ownerDocument.defaultView.location.protocol + '//';

	const range = new Range();

	let start = node.textContent.indexOf(url), end = start + url.length;
	for (const child of node.childNodes)
	{
		if (start === 0)
			range.setStartBefore(child);
		else if (start > 0 && child.textContent.length > start)
			range.setStart(child, start);
		else if (child.textContent.length === start)
			range.setStartAfter(child);

		if (end === 0)
			range.setEndBefore(child);
		else if (end > 0 && child.textContent.length > end)
			range.setEnd(child, end);
		else if (child.textContent.length === end)
			range.setEndAfter(child);


		start -= child.textContent.length;
		end -= child.textContent.length;
	}

	return { text_link: protocol + url, range };
}


function on_pre_click(evt)
{
	if (!tab_enabled)
		return;

	const { href, node } = find_click_target(evt.target);

	// Not a valid link: nothing to protect
	if (!href)
		return;

	const { event_type } = find_click_event(evt.target, ['mousedown', 'touchstart']);

	// Protect the link by cancelling onmousedown trickeries by stopping the event.
	if (event_type)
	{
		evt.stopPropagation();
		evt.preventDefault();

		pre_cleaned_node = node;
	}
}


function on_post_click()
{
	if (pre_cleaned_node)
		pre_cleaned_node = null;
}


function on_click(evt)
{
	if (evt.button == 0 && evt.altKey)
		return; // alt+click, do nothing

	const { href, func, node, event_type } = { ...find_click_event(evt.target), ...find_click_target(evt.target) };
	const { text_link, range } = Prefs.values.text_links && !node && find_text_link(evt.target) || {};

	const raw_link = href || func || text_link;

	if (node && !Prefs.values.gotarget && (node.getAttribute('target') || '_self') !== '_self')
		node.removeAttribute('target');

	if (!tab_enabled || !raw_link)
		return;


	const base = (node && node.ownerDocument.defaultView || window).location.href;
	let cleaned_link = extract_javascript_link(raw_link, base);

	// report that we cleaned the javascript from the node’s href
	if (href && cleaned_link)
		event_type = 'href';

	// If there is an identified javascript event (i.e. event_type defined) on a ckean link,
	// still prevent the click event, and perform the action of activating the link manually.
	else if (href && event_type)
		cleaned_link = (() => { try { return new URL(href, base); } catch {} })();

	else if (raw_link && !node)
		cleaned_link = (() => { try { return new URL(raw_link, base); } catch {} })();


	// report as cleaned links where we prevented a mousedown event
	if (!cleaned_link && !event_type && node && node.isSameNode(pre_cleaned_node))
		event_type = 'mousedown';


	// Only notify if did not come here only to override target
	let notify = Promise.resolve();
	if (event_type)
	{
		log(`Cleaning javascript ${raw_link} to ${cleaned_link} with event ${event_type}`)

		notify = browser.runtime.sendMessage({
			action: 'notify',
			url: cleaned_link.href,
			orig: raw_link,
			type: 'clicked',
			parent: base,
			cleaned: {javascript: event_type}
		});

		if (Prefs.values.highlight)
			highlight_link(node || range.commonAncestorContainer);
	}
	else
	{
		const url = (() => { try { return new URL(raw_link, base).href; } catch { return raw_link; } })();

		log(`Notifying non-javascript link ${url} clicked`)

		if (node)
		{
			highlight_node = node;
			notify = browser.runtime.sendMessage({action: 'highlight', link: url});
		}
		// text-based link
		else if (Prefs.values.highlight)
			try
			{
				// no guarantees the range isn’t split across a tag so we can’t surround it properly
				range.surroundContents(highlight_link(document.createElement('span')));
			}
			catch {}
	}

	if (cleaned_link)
	{
		// Now we replace the click with our click function
		evt.stopPropagation();
		evt.preventDefault();

		notify.catch(err => console.error('Notification failed:', err));
		notify.then(() => event_do_click(cleaned_link.href, node || evt.target, evt));
	}
}


browser.runtime.sendMessage({action: 'check tab enabled', url: window.location.href})
	.then(answer => ({ enabled: tab_enabled } = answer || { enabled: false }))
	.catch(() => {});


browser.runtime.onMessage.addListener(message =>
{
	if (message.action === 'reload options')
		return Prefs.reload();
	else if (message.action === 'toggle')
	{
		tab_enabled = message.active;
		return Promise.resolve({});
	}
	else if (message.action === 'highlight')
	{
		if (highlight_node !== null)
			highlight_link(highlight_node, false);

		highlight_node = null;
		return Promise.resolve({});
	}
	else
		return Promise.reject('Unexpected message: ' + String(message));
});


window.addEventListener('click', on_click, {capture: true});
window.addEventListener('mousedown', on_pre_click, {capture: true});
window.addEventListener('touchstart', on_pre_click, {capture: true});
window.addEventListener('mouseup', on_post_click, {capture: true});
window.addEventListener('touchend', on_post_click, {capture: true});

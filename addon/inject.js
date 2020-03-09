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

/*
function highlight_link(node, remove)
{
	// parse and apply ;-separated list of key:val style properties
	('' + Prefs.values.hlstyle).split(';').forEach(function (r)
	{
		let [prop, val] = r.split(':').map(s => s.trim());
		node.style.setProperty(prop, remove ? '' : val, 'important');
	});
}
*/

function event_do_click(url, node, evt)
{
	if (evt.button == 0 && evt.altKey)
		return false; // alt+click, do nothing

	let wnd = window;
	let open_newtab = evt.ctrlKey || evt.button == 1 || evt.metaKey;
	let open_newwin = evt.shiftKey;

	if (/*Prefs.values.gotarget && */ evt.button == 0 && !(evt.shiftKey || evt.ctrlKey || evt.metaKey || evt.altKey))
	{
		let target = node.hasAttribute('target') && node.getAttribute('target') || '_self';
		if ("_blank" == target)
			open_newtab = true;
		else
		{
			let frames = content.frames;
			wnd = node.ownerDocument.defaultView;

			switch (target)
			{
				case '_top':
					wnd = wnd.top;
					break;
				case '_parent':
					wnd = wnd.parent;
					break;
				case '_self':
					break;
				default:
					wnd = Array.from(frames).find(f => f.name == target);
			}

			if (wnd)
			{
				evt.stopPropagation();
				evt.preventDefault();

				wnd.location = url;
				return true;
			}
		}
	}

	evt.stopPropagation();
	evt.preventDefault();

	browser.runtime.sendMessage({
		action: 'open url',
		link: url,
		target: open_newtab ? new_tab : (open_newwin ? new_window : same_tab)
	}).catch(() =>
	{
		// Could not find a target window or assigning a location to it failed
		node.setAttribute('href', url);
		node.click();

		// Alternately: window.content.location = url;
	});

	return true;
}


function on_click(evt)
{
	let node = evt.target, text_link = '', url;

	do
	{
		if (node.nodeName === 'A')
		{
			if (node.href.startsWith('javascript:'))
			{
				text_link = node.href
				break;
			}
			else if (node.href !== '#')
				return;
		}

		for (let evttype of ['onclick', 'onmouseup', 'onmousedown'])
			if (node[evttype] !== null)
			{
				text_link = node[evttype].toString();
				text_link = text_link.slice(text_link.indexOf('{') + 1, text_link.lastIndexOf('}'))
				break;
			}

	} while (!text_link && ['A', 'BODY', 'HTML'].indexOf(node.nodeName) === -1 && (node = node.parentNode));

	if (!text_link)
		return;

	var cleaned_link = extract_javascript_link(text_link, window.location);

	if (!cleaned_link || cleaned_link === text_link)
		return;

	log('Cleaning ' + text_link + ' to ' + cleaned_link)
	if (event_do_click(cleaned_link, node, evt))
	{
		// instead of blinking the URL bar, tell the background to show a notification.
		browser.runtime.sendMessage({action: 'notify', url: cleaned_link, orig: text_link, type: 'clicked'});
	}
}


let tab_enabled = true;

Prefs.loaded.then(() =>
{
	if (tab_enabled)
		window.addEventListener('click', on_click, true);
})

browser.runtime.onMessage.addListener(message =>
{
	if (message.action === 'reload options')
		return Prefs.reload();
	else if (message.action === 'toggle')
	{
		if (tab_enabled == message.enabled)
			return Promise.resolve({});
		else
			tab_enabled = message.enabled;

		if (message.enabled)
			window.addEventListener('click', on_click, true);
		else
			window.removeEventListener('click', on_click, true);

		return Promise.resolve({});
	}
	else
		return Promise.reject('Unexpected message: ' + String(message));
})

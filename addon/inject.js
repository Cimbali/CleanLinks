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

function eventDoClick(url, node, evt)
{
	if (evt.button == 0 && evt.altKey)
		return false; // alt+click, do nothing

	let wnd = window;
	let open_newtab = evt.ctrlKey || evt.button == 1;
	let open_newwin = evt.shiftKey;

	if (prefValues.gotarget && evt.button == 0 && !(evt.shiftKey || evt.ctrlKey || evt.metaKey || evt.altKey))
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
				wnd.location = url;
				return true;
			}
		}
	}

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


/* TODO: use if on mobile? was cleanlinks.mob
function eventDoClick(url)
{
	window.content.location = url;
	return true;
}
*/


function onClick(evt)
{
	let node = evt.target,
		textLink = null;

	if (node.nodeName != 'A' && !evt.altKey && prefValues.textcl)
		textLink = textFindLink(node);

	if (node.nodeName != 'A' && !textLink)
		do {
			node = node.parentNode;
		} while (node && ['A', 'BODY', 'HTML'].indexOf(node.nodeName) === -1);

	if (textLink || (node && node.nodeName == 'A')) // && !handledElsewhere(node)
	{
		switch (textLink || node.ownerDocument.location.hostname)
		{
			case 'twitter.com':
				if (node.hasAttribute('data-expanded-url'))
					textLink = node.getAttribute('data-expanded-url');
				break;
			case 'www.facebook.com':
				if (('' + node.getAttribute('onmouseover')).indexOf('LinkshimAsyncLink') !== -1)
					textLink = node.href;
		}

		// clean text on pre-clean for a tratement with baseUI
		let link = textLink || node.href;
		let cleanedLink = cleanLink(link, node.baseURI);
		if (textLink || link != cleanedLink)
		{
			evt.stopPropagation();
			evt.preventDefault();

			if (eventDoClick(cleanedLink, node, evt))
			{
				if (prefValues.highlight)
					highlightLink(node);

				// instead of blinking the URL bar, tell the background to show a notification.
				browser.runtime.sendMessage({action: 'notify', url: cleanedLink, orig: link, type: 'clicked'});
			}
		}
		else if(!textLink && node.hasAttribute(attr_cleaned_link))
		{
			browser.runtime.sendMessage({
				action: 'notify',
				url: evt.target.href,
				orig: evt.target.getAttribute(attr_cleaned_link),
				type: 'pre-cleaned'
			});
		}
	}
}

loadOptions().then(() =>
{
	if (prefValues.enabled)
		window.addEventListener('click', onClick, true);
})

browser.runtime.onMessage.addListener(message =>
{
	if (message.action == 'reload options')
	{
		var had_onclick = prefValues.enabled;
		return loadOptions().then(() =>
		{
			if (!had_onclick && prefValues.enabled)
				window.addEventListener('click', onClick, true);
			else if (had_onclick && !prefValues.enabled)
				window.removeEventListener('click', onClick, true);
		});
	}
	else
		return Promise.reject('Unexpected message: ' + String(message));
})

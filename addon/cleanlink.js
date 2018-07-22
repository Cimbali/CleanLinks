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

const _ = browser.i18n.getMessage
const attr_cleaned_count = 'data-cleanedlinks';
const attr_cleaned_link = 'data-cleanedlink';
const str_cleanlink_touch = "\n\n- " + _("browser_touch");

const title = browser.runtime.getManifest().name;
const version = browser.runtime.getManifest().version;
const homepage = browser.runtime.getManifest().homepage_url;
const copyright = browser.runtime.getManifest().author;

const icon_default = '';
const icon_disabled = '-';
const icon_fire = '~';
const icon_green = '!';

const same_tab = 0;
const new_tab = 1;
const new_window = 2;

var prefValues = {
	enabled   : true,
	skipwhen  : new RegExp('/ServiceLogin|imgres\\?|searchbyimage\\?|watch%3Fv|auth\\?client_id|signup|bing\\.com/widget|'
		+ 'oauth|openid\\.ns|\\.mcstatic\\.com|sVidLoc|[Ll]ogout|submit\\?url=|magnet:|google\\.com/recaptcha/'),
	remove    : /(?:ref|aff)\\w*|utm_\\w+|(?:merchant|programme|media)ID/,
	skipdoms  : ['accounts.google.com', 'docs.google.com', 'translate.google.com',
				'login.live.com', 'plus.google.com', 'twitter.com',
				'static.ak.facebook.com', 'www.linkedin.com', 'www.virustotal.com',
				'account.live.com', 'admin.brightcove.com', 'www.mywot.com',
				'webcache.googleusercontent.com', 'web.archive.org', 'accounts.youtube.com',
				'signin.ebay.com'],
	highlight : true,                                          // highlight cleaned links
	hlstyle   : 'background:rgba(252,252,0,0.6); color: #000', // style for highlighted cleaned links
	progltr   : true,                                          // http-on-examine-response: clean links on Location: redirect headers?
	httpomr   : true,                                          // http-on-modify-request: skip redirects
	cbc       : true,                                          // Context menus to clean links
	gotarget  : false,                                         // whether we respect target attributes on links that are being cleaned
	textcl    : false,                                         // search for & clean links in selected text
	ignhttp   : false,                                         // ignore non-http(s?) links
	cltrack   : true,                                          // whether we track the link cleaning
	switchToTab : true,                                        // Should be a copy of the browser preference: switch to a new tab when we open a link?
	notifications: false,                                      // Send notifications when tracking links?
	notiftime : 800,                                           // Duration of a notification in ms
	debug     : false
}


function log()
{
	if (prefValues.debug) console.log.apply(null, arguments)
}


function serializeOptions()
{
	return Object.keys(prefValues).reduce((serializedVals, param) =>
	{
		if (prefValues[param] instanceof RegExp)
			serializedVals[param] = prefValues[param].source;
		else if (Array.isArray(prefValues[param]))
			serializedVals[param] = prefValues[param].join(',');
		else
			serializedVals[param] = prefValues[param];

		return serializedVals;
	}, {});
}


function loadOptions()
{
	// return the promise so it can be chained
	return browser.storage.local.get('configuration').then(data =>
	{
		if ('configuration' in data) {
			for (var param in data.configuration) {
				if (typeof prefValues[param] == 'number')
					prefValues[param] = parseInt(data.configuration[param]);
				else if (typeof prefValues[param] == 'boolean')
				{
					prefValues[param] = data.configuration[param] === true
									|| data.configuration[param] === 'true'
									|| data.configuration[param] === 'on';
				}
				else if (typeof prefValues[param] == 'string')
					prefValues[param] = data.configuration[param] || '';
				else if (prefValues[param] instanceof RegExp)
					prefValues[param] = new RegExp(data.configuration[param] || '.^');
				else if (Array.isArray(prefValues[param]))
					prefValues[param] = (data.configuration[param] || '').split(',').map(s => s.trim()).filter(s => s.length > 0);
			}
		}
	});
}


function highlightLink(node, remove)
{
	// parse and apply ;-separated list of key:val style properties
	('' + prefValues.hlstyle).split(';').forEach(function (r)
	{
		let [prop, val] = r.split(':').map(s => s.trim());
		node.style.setProperty(prop, remove ? '' : val, 'important');
	});
}


function cleanLink(link, base)
{
	if (!link || link.startsWith("view-source:") || (prefValues.skipwhen && prefValues.skipwhen.test(link)))
	{
		log('not cleaning', link, ': empty, source, or matches skipwhen');
		return link;
	}

	let s = 0, origLink = link;

	var [all, quote, linkParam] = link.match(/^javascript:.+(["'])(.*?https?(?:\:|%3a).+?)\1/) || [];
	if (all)
	{
		link = linkParam;
		s++;
	}

	if (typeof base == 'undefined')
	{
		if (/^https?:/.test(link))
			base = link;
		else if (window)
		{
			base = new URL(window.location);
			base.hash = '';
		}
	}

	if (typeof base === 'string')
		base = new URL(base);

	let linkURL;
	if (prefValues.skipdoms)
	{
		try
		{
			linkURL = new URL(link, 'href' in base ? base.href : base);

			if (prefValues.skipdoms.indexOf(linkURL.host) !== -1)
			{
				log('not cleaning', link, ': host in skipdoms');
				return link;
			}
		}
		catch (e) {}
	}

	if (prefValues.ignhttp && !(/^https?:/.test(typeof linkURL != 'undefined' ? linkURL.href : link)))
	{
		log('not cleaning', link, ': ignoring non-http(s) links');
		return link;
	}

	if (/\.google\.[a-z.]+\/search\?(?:.+&)?q=http/i.test(link)
		|| /^https?:\/\/www\.amazon\.[\w.]+\/.*\/voting\/cast\//.test(link)
	)
	{
		log('not cleaning', link, ': google search/amazon vote')
		return link;
	}

	let isYahooLink = /\.yahoo.com$/.test(base.host);

	let [base64match] = link.match(/\b(?:aHR0|d3d3)[A-Z0-9+=\/]+/i) || [];
	if (base64match)
	{
		try
		{
			if (isYahooLink)
				base64match = base64match.replace(/\/RS.*$/, '');

			let decoded = decodeURIComponent(atob(base64match));
			if (decoded)
				link = '=' + decoded;
		}
		catch (e)
		{
			log('Invalid base64 data in link', link, ':' , r, '-- error is', e);
		}
	}
	else
	{
		switch (base.host)
		{
			case 'www.tripadvisor.com':
				if (link.indexOf('-a_urlKey') !== -1)
					link = '=' + decodeURIComponent(link.replace(/_+([a-f\d]{2})/gi, '%$1')
						.replace(/_|%5f/ig, '')).split('-aurl.').pop().split('-aurlKey').shift();
				break;
			default:
				switch (linkURL && linkURL.host || (link.match(/^\w+:\/\/([^/]+)/) || []).pop())
				{
					case 'redirect.disqus.com':
						if (link.indexOf('/url?url=') !== -1)
							link = '=' + link.match(/url\?url=([^&]+)/).pop().split(/%3a[\w-]+$/i).shift();
						break;
				}
		}
	}

	let lmt = 4;
	while (--lmt)
	{
		var [all, capture] = link.match(/(?:.\b|3D)([a-z]{2,}(?:\:|%3a)(?:\/|%2f){2}.+)$/i) ||
							link.match(/(?:[?=]|[^\/]\/)(www\..+)$/i) || []
		if (!all)
			break;

		link = capture;
		let pos;
		if ((pos = link.indexOf('&')) !== -1)
			link = link.substr(0, pos);
		link = decodeURIComponent(link);
		log('decoded URI Component =', link)

		if ((pos = link.indexOf('html&')) !== -1 || (pos = link.indexOf('html%')) !== -1)
			link = link.substr(0, pos + 4);
		else if ((pos = link.indexOf('/&')) !== -1) // || (pos = link.indexOf('/%')) !== -1)
			link = link.substr(0, pos);
		if (link.indexOf('://') == -1)
			link = 'http://' + link;
		if (link.indexOf('/', link.indexOf(':') + 2) == -1)
			link += '/';
		++s;
	}

	link = link.replace(/^h[\w*]+(ps?):/i, 'htt$1:');

	if (origLink != link)
	{
		try
		{
			new URL(link);
		}
		catch (e)
		{
			log('not cleaning', origLink, ': yielded invalid link :', link)
			link = origLink;
		}
	}

	if (isYahooLink)
		link = link.replace(/\/R[KS]=\d.*$/, '');

	prefValues.remove.lastIndex = 0;
	if (s || prefValues.remove.test(link))
	{
		let pos, ht = null;
		if ((pos = link.indexOf('#')) !== -1)
			ht = link.substr(pos), link = link.substr(0, pos);

		link = link.replace(/&amp;/g, '&').replace(prefValues.remove, '').replace(/[?&]$/, '')
			+ (ht && /^[\w\/#!-]+$/.test(ht) ? ht : '');
	}

	log('cleaning', origLink, ':', link)
	return link;
}

function textFindLink(node)
{
	let pos, selection = node.ownerDocument && node.ownerDocument.defaultView.getSelection();

	// if selection has a node with data, and we can get the offset in that data
	if (selection && selection.isCollapsed && selection.focusNode && selection.focusNode.data && (pos = selection.focusOffset))
	{
		// unsanitized content of selection
		let content = selection.focusNode.data.substr(--pos);

		// sanitize selection: remove 0-space tags, replace other tags with spaces
		let text = node.innerHTML.replace(/<\/?wbr>/ig, '').replace(/<[^>]+?>/g, ' ');

		// recover position of selection in sanitized text
		pos = text.indexOf(content) + 1;
		if (pos === 0)
		{
			text = node.textContent;
			pos = text.indexOf(content) + 1;
		}

		// tools to modify boundaries of selection, until a reasonable url
		let boundaryChars = ' "\'<>\n\r\t()[]|',
			protectedBoundaryChars = boundaryChars.replace(/(.)/g, '\\$1'),
			trimEndRegex = RegExp("[" + protectedBoundaryChars + "]+$");

		// move start of selection backwards until start of data or a boundary character
		while (pos && boundaryChars.indexOf(text[pos]) === -1)
			--pos;

		text = (pos && text.substr(++pos) || text)
		text = text.match(/^\s*(?:\w+:\/\/|www\.)[^\s">]{4,}/)

		if (text)
		{
			text = text.shift().trim().replace(trimEndRegex, '');
			if (text.indexOf('://') === -1)
				text = 'http://' + text;
		}

		return text;
	}

	return undefined;
}

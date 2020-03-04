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

const same_tab = 0;
const new_tab = 1;
const new_window = 2;

var prefValues = {
	highlight : true,                                          // highlight cleaned links
	hlstyle   : 'background:rgba(252,252,0,0.6); color: #000', // style for highlighted cleaned links
	progltr   : true,                                          // http-on-examine-response: clean links on Location: redirect headers?
	httpall   : true,                                          // http capture all traffic, not just main frame
	cbc       : true,                                          // Context menus to clean links
	gotarget  : false,                                         // whether we respect target attributes on links that are being cleaned
	textcl    : false,                                         // search for & clean links in selected text
	ignhttp   : false,                                         // ignore non-http(s?) links
	cltrack   : true,                                          // whether we track the link cleaning
	switchToTab : true,                                        // Should be a copy of the browser preference: switch to a new tab when we open a link?
	notifications: false,                                      // Send notifications when tracking links?
	notiftime : 800,                                           // Duration of a notification in ms
	debug     : true
}


function log()
{
	if (prefValues.debug) console.log.apply(null, arguments)
}

function apply_i18n()
{
	for (let elem of document.querySelectorAll('[i18n_text]'))
		elem.prepend(document.createTextNode(_(elem.getAttribute('i18n_text'))));

	for (let elem of document.querySelectorAll('[i18n_title]'))
		elem.setAttribute('title', _(elem.getAttribute('i18n_title')));
}

// Here only because it needs inclusion in both background and injected scripts
function extractJavascriptLink(textLink, baseURL)
{
	var [all, quote, cleanedLink] = textLink.match(/^(?:javascript:)?.+(["'])(.*?https?(?:\:|%3a).+?)\1/) || [];

	console.log('matched: ' + cleanedLink)
	try {
		return new URL(cleanedLink, baseURL).href
	} catch (e) {
		return;
	}
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


function upgradeOptions(options)
{
	if ('httpomr' in options) {
		options['httpall'] = options['httpomr'];
		delete options['httpomr'];
	}
}


function loadOptions()
{
	// return the promise so it can be chained
	return browser.storage.sync.get('configuration').then(data =>
	{
		if ('configuration' in data) {
			upgradeOptions(data.configuration);

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
				{
					try {
						prefValues[param] = new RegExp(data.configuration[param] || '.^');
					} catch (e) {
						log('Error parsing regex ' + (data.configuration[param] || '.^') + ' : ' + e.message);
					}
				}
				else if (Array.isArray(prefValues[param]))
					prefValues[param] = (data.configuration[param] || '').split(',').map(s => s.trim()).filter(s => s.length > 0);
			}
		}
		return prefValues;
	});
}

function clearOptions()
{
	return browser.storage.sync.remove('configuration');
}

const prefs = {values: prefValues, serialize: serializeOptions, load: loadOptions, clear: clearOptions}

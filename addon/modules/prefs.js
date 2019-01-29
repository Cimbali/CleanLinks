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
const icon_fire = '~';
const icon_green = '!';

const same_tab = 0;
const new_tab = 1;
const new_window = 2;

var prefValues = {
	enabled   : true,
	skipwhen  : new RegExp('/ServiceLogin|imgres\\?|searchbyimage\\?|watch%3Fv|auth\\?client_id|signup|bing\\.com/widget|'
		+ 'oauth|openid\\.ns|\\.mcstatic\\.com|sVidLoc|[Ll]ogout|submit\\?url=|magnet:|google\\.com/recaptcha/|'
		+ '\\.google\\.[a-z.]+\\/search\\?(.+&)?q=http|^https?:\\/\\/www\\.amazon\\.[a-z.]+\\/.*\\/voting\\/cast\\/'),
	remove    : /\b((?:ref|aff)\w*|utm_\w+|(?:merchant|programme|media)ID)|fbclid/,
	skipdoms  : ['accounts.google.com', 'docs.google.com', 'translate.google.com',
				'login.live.com', 'plus.google.com', 'twitter.com',
				'static.ak.facebook.com', 'www.linkedin.com', 'www.virustotal.com',
				'account.live.com', 'admin.brightcove.com', 'www.mywot.com',
				'webcache.googleusercontent.com', 'web.archive.org', 'accounts.youtube.com',
				'signin.ebay.com'],
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
	var check_storages = key => new Promise(found =>
	{
		browser.storage.local.get(key).then(data =>
		{
			if (key in data)
			{
				browser.storage.local.clear();
				browser.storage.sync.set(data);
				found(data);
			}
			else
				browser.storage.sync.get(key).then(data => found(data))
		})
	});

	// return the promise so it can be chained
	return check_storages('configuration').then(data =>
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
	});
}

const prefs = {values: prefValues, serialize: serializeOptions, load: loadOptions}

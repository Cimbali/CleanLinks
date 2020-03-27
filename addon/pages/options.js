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

const Queue = {
	chain: Promise.resolve(),
	add: callable => { Queue.chain = Queue.chain.then(callable); }
};


function update_page(options)
{
	document.querySelector('input[name="hlstyle"]').disabled = !options.highlight;
}


function save_options()
{
	let options = {}
	for (let field of Array.from(document.querySelectorAll('input')))
	{
		if (typeof Prefs.values[field.name] == 'boolean')
			options[field.name] = field.checked;
		else if (field.name in Prefs.values)
			options[field.name] = field.value;
	}

	browser.storage.sync.set({configuration: options}).then(() =>
	{
		update_page(options);

		browser.runtime.sendMessage({action: 'options'});
		Prefs.reload();
	});
}


function reset_options()
{
	// clear options storage, reload everything
	Prefs.reset().then(() =>
	{
		browser.runtime.getBackgroundPage().then(page =>
		{
			page.location.reload();
			window.location.reload();
		})
	})
}


function populate_options()
{
	const values = Prefs.serialize();
	for (const [pref, value] of Object.entries(values))
	{
		const input = document.querySelector(`[name=${pref}]`);
		if (!input)
			continue;

		if (typeof value == 'boolean')
			input.checked = value;
		else
			input.value = value;

		input.onchange = save_options
		input.onkeyup = delayed_call(save_options)
	}

	update_page(values);
}


function add_listeners()
{
	document.querySelector('button[name="reset_options"]').onclick = reset_options;

	browser.runtime.onMessage.addListener(message =>
	{
		if (message.action === 'reload options')
			return Prefs.reload().then(populate_options());
		else
			return Promise.resolve('Options page ignored unknown message ' + message.action)
	});
}


apply_i18n();
add_listeners();
Prefs.loaded.then(populate_options);

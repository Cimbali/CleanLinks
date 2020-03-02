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

const default_actions = {'url_ok': [], 'strip': [], 'rewrite': []}

function update_page(prefs)
{
	document.querySelector('input[name="notiftime"]').disabled = !prefs.notifications;
	document.querySelector('input[name="hlstyle"]').disabled = !prefs.highlight;
}

function save_options()
{
	var prefs = Array.from(document.querySelectorAll('input, textarea')).reduce((prefs, field) =>
	{
		if (typeof prefValues[field.name] == 'boolean')
			prefs[field.name] = field.checked;
		else if (prefValues[field.name] instanceof RegExp)
		{
			var error_span = document.querySelector('span#' + field.name + '_error');
			try {
				var r = new RegExp(field.value || '.^');
				prefs[field.name] = field.value;
				error_span.innerText = '';
			} catch (e) {
				prefs[field.name] = prefValues[field.name].source;
				error_span.innerText = 'Error parsing RegExp: ' + e.message;
			}
		}
		else if (field.name in prefs)
			prefs[field.name] = field.value;

		return prefs
	}, {})

	update_page(prefs);

	browser.storage.sync.set({configuration: prefs}).then(() =>
	{
		browser.runtime.sendMessage({action: 'options'});
		loadOptions();
	});
}


// for onKeyUp: save after 400ms of inactivity
var delayed_save = (function(callback)
{
	browser.alarms.onAlarm.addListener(callback);
	return function()
	{
		browser.alarms.clear('save');
		browser.alarms.create('save', {when: Date.now() + 400});
	}
})


function reset_options()
{
	// clear options storage, reload everything
	browser.storage.sync.clear().then(() =>
		browser.runtime.getBackgroundPage().then(page =>
		{
			page.location.reload();
			window.location.reload();
		})
	)
}


function populate_options()
{
	var values = serializeOptions();
	for (var pref in values)
	{
		var input = document.querySelector('[name=' + pref + ']');
		if (!input)
			continue;

		var value = values[pref];
		if (typeof value == 'boolean')
			input.checked = value;
		else
			input.value = value;

		input.onchange = save_options
		input.onkeyup = delayed_save(save_options)
	}

	document.querySelector('button[name="reset"]').onclick = reset_options;
	update_page(prefValues);
}


function remove_rule_item(list, element)
{
	let selection = document.getElementById('rule_selector');
	let selectedOpt = selection[selection.selectedIndex];

	let rule = JSON.parse(selectedOpt.value);
	let pos = rule[list].indexOf(element);
	if (pos === -1)
		return;
	rule[list].splice(pos, 1)
	selectedOpt.value = JSON.stringify(rule);
}


function show_rule_item(list, element)
{
	let span = document.createElement('span');
	span.appendChild(document.createTextNode(element));
	span.onclick = () => {
		remove_rule_item(list, element)
		span.remove()
	}
	document.querySelector('.' + list + '_list').appendChild(span)
}


function add_rule_item(list, element)
{
	let selection = document.getElementById('rule_selector');
	let selectedOpt = selection[selection.selectedIndex];

	let rule = JSON.parse(selectedOpt.value);
	let pos = rule[list].indexOf(element);
	if (pos === -1)
	{
		rule[list].push(element)
		selectedOpt.value = JSON.stringify(rule);
		show_rule_item(list, element)
	}
}


function name_rule(rule)
{
	return rule.domain + '.' + rule.suffix + (rule.path.startsWith('/') ? '' : '/') + rule.path;
}


function load_rule()
{
	for (let list of document.querySelectorAll('span.whitelist')) {
		while (list.lastChild) {
			list.removeChild(list.lastChild)
		}
	}

	let rule = JSON.parse(document.getElementById('rule_selector').value);
	if (Object.keys(rule).length === 0)
	{
		document.querySelector('input[name="domain"]').value = '';
		document.querySelector('input[name="suffix"]').value = '';
		document.querySelector('input[name="path"]').value = '';
	}
	else
	{
		document.querySelector('input[name="domain"]').value = rule.domain
		document.querySelector('input[name="suffix"]').value = rule.suffix;
		document.querySelector('input[name="path"]').value = rule.path

		for (let list of Object.keys(default_actions))
			for (let val of rule[list])
				show_rule_item(list, val);
	}
}


function erase_rule()
{
	let select = document.getElementById('rule_selector');
	let selectedOpt = select[select.selectedIndex];
	select[0].checked = true;
	if (select.selectedIndex == 0) {
		selectedOpt.value = '{}';
	} else {
		select.selectedIndex = 0;
		selectedOpt.remove()
	}
	load_rule();
}


function save_rule()
{
	let select = document.getElementById('rule_selector');
	let selectedOpt = select[select.selectedIndex];

	let rule = Object.assign(JSON.parse(selectedOpt.value), {
		domain: document.querySelector('input[name="domain"]').value || '*',
		suffix: document.querySelector('input[name="suffix"]').value || '*',
		path: document.querySelector('input[name="path"]').value || '*',
	});

	if (select.selectedIndex === 0) {
		select[0].value = "{}"
		selectedOpt = select.appendChild(new Option(name_rule(rule), JSON.stringify(rule), false, true))
	} else {
		selectedOpt.replaceChild(document.createTextNode(name_rule(rule)), selectedOpt.firstChild);
	}
	console.log(select.selectedIndex, rule)
}


function populate_rules(serialized_rules)
{
	let select = document.getElementById('rule_selector')
	for (let rule of serialized_rules)
		select.appendChild(new Option(name_rule(rule), JSON.stringify({...default_actions, ...rule})))

	select.onchange = load_rule

	for (const list of Object.keys(default_actions))
	{
		let button = document.getElementById(list + '_add');
		let input = document.querySelector('input[name="' + list + '_edit"]');
		button.onclick = () =>
		{
			if (input.value)
			{
				add_rule_item(list, input.value);
				input.value = '';
			}
		}
	}

	for (let input of document.querySelectorAll('#rule_editor input'))
	{
		if (input.getAttribute('name') === 'ignhttp')
			continue;

		input.onchange = save_rule
		input.onkeyup = delayed_save(save_rule)
	}

	document.getElementById('remove_rule').onclick = erase_rule
}


apply_i18n();
prefs.load().then(populate_options);
Rules.serialize().then(populate_rules)

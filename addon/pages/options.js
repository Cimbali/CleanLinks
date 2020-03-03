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
	add: function(async_callable) {
		this.chain = this.chain.then(async_callable)
	}
};


function update_page(prefs)
{
	document.querySelector('input[name="notiftime"]').disabled = !prefs.notifications;
	document.querySelector('input[name="hlstyle"]').disabled = !prefs.highlight;
}


function check_regexp(expr, error_span)
{
	try {
		var r = new RegExp(expr);
		error_span.innerText = '';
		return true;
	} catch (e) {
		error_span.innerText = 'Error parsing RegExp: ' + e.message;
		return false;
	}
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
			if (check_regexp(field.value || '.^', document.getElementById('path_error')))
				prefs[field.name] = field.value;
			else
				prefs[field.name] = prefValues[field.name].source;
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
	prefs.clear().then(() =>
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

	document.querySelector('button[name="reset_options"]').onclick = reset_options;
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


function show_rule_item(list, element, elemtype)
{
	let span = document.createElement('span');
	span.appendChild(document.createTextNode(element));
	if (elemtype !== 'inherit') {
		span.onclick = () => {
			remove_rule_item(list, element)
			span.remove()
		}
	}
	document.getElementById(list + '_' + elemtype + 'list').appendChild(span)
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
		show_rule_item(list, element, 'item')
	}

	return true;
}


function name_rule(rule)
{
	let domain = rule.domain.substr(1), path = rule.path;

	if (domain.startsWith('.'))
		domain = domain.substr(1)
	else if (domain !== '*')
		domain = '*.' + domain

	if (!(path.startsWith('/')))
		path = '/' + path
	if (path === '/*')
		path = ''

	return domain + rule.suffix + path;
}


function load_rule()
{
	for (let list of document.querySelectorAll('span.itemlist, span.inheritlist')) {
		while (list.lastChild) {
			list.removeChild(list.lastChild)
		}
	}

	let rule = JSON.parse(document.getElementById('rule_selector').value);
	if (document.getElementById('rule_selector').selectedIndex !== 0)
	{
		const subdomains = !rule.domain.startsWith('..')
		document.querySelector('input[name="domain"]').value = rule.domain.substr(subdomains ? 1 : 2)
		document.querySelector('input[name="subdomains"]').checked = subdomains;
		document.querySelector('input[name="suffix"]').value = rule.suffix.substr(1)
		document.querySelector('input[name="path"]').value = rule.path === '/*' ? '' : rule.path;

		for (let list of Object.keys(default_actions))
		{
			for (let val of rule[list])
				show_rule_item(list, val, 'item');
			for (let val of rule.inherited[list])
				show_rule_item(list, val, 'inherit');
		}

		document.getElementById('remove_rule').disabled = false
	}
	else
	{
		document.querySelector('input[name="domain"]').value = '';
		document.querySelector('input[name="suffix"]').value = '';
		document.querySelector('input[name="path"]').value = '';
		document.querySelector('input[name="subdomains"]').checked = true;

		document.getElementById('remove_rule').disabled = true
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
		Rules.remove(JSON.parse(selectedOpt.getAttribute('orig-value')))
		select.selectedIndex--;
		selectedOpt.remove()
	}
	load_rule();
}


function save_rule()
{
	let select = document.getElementById('rule_selector');
	let selectedOpt = select[select.selectedIndex];

	let rule = Object.assign(JSON.parse(selectedOpt.value), {
		domain: '.' + (document.querySelector('input[name="domain"]').value || '*'),
		suffix: '.' + (document.querySelector('input[name="suffix"]').value || '*'),
		path: document.querySelector('input[name="path"]').value || '/*',
	});


	if (rule.path !== '/*' && !check_regexp(rule.path, document.getElementById('path_error')))
		return;

	if (!document.querySelector('input[name="subdomains"]').checked && rule.domain !== '.*')
		rule.domain = '.' + rule.domain;

	// Perform the update operation immediately in the DOM
	let replacing = null;
	if (select.selectedIndex === 0) {
		select[0].value = JSON.stringify(default_actions)
		selectedOpt = select.appendChild(new Option(name_rule(rule), JSON.stringify(rule), false, true))
	} else {
		replacing = JSON.parse(selectedOpt.getAttribute('orig-value'));
		selectedOpt.replaceChild(document.createTextNode(name_rule(rule)), selectedOpt.firstChild);
	}
	selectedOpt.setAttribute('orig-value', JSON.stringify(rule));

	if (replacing === null) {
		Queue.add(async () => await Rules.add(rule));
	} else {
		Queue.add(async () => await Rules.update(replacing, rule));
	}
}


function reset_rules()
{
	// clear rules storage, reload everything
	Rules.clear().then(() =>
	{
		browser.runtime.getBackgroundPage().then(page =>
		{
			page.location.reload();
			window.location.reload();
		})
	})
}

function populate_rules(serialized_rules)
{
	let select = document.getElementById('rule_selector')
	for (let rule of serialized_rules)
	{
		let opt = select.appendChild(new Option(name_rule(rule), JSON.stringify({...default_actions, ...rule})))
		opt.setAttribute('orig-value', opt.getAttribute('value'))
	}
	select[0].value = JSON.stringify(default_actions)

	select.onchange = load_rule

	for (const list of Object.keys(default_actions))
	{
		let button = document.getElementById(list + '_add');
		let input = document.querySelector('input[name="' + list + '_edit"]');
		button.onclick = () =>
		{
			if (input.value && check_regexp(input.value, document.getElementById(list + '_edit_error')))
			{
				add_rule_item(list, input.value);
				input.value = '';
				save_rule()
			}
		}

		let check_val = () => check_regexp(input.value, document.getElementById(list + '_edit_error'));
		input.onchange = check_val;
		input.onkeyup = delayed_save(check_val);
	}

	for (let input of document.querySelectorAll('#rule_editor input'))
	{
		if (input.getAttribute('name') === 'ignhttp' || input.classList.contains('noautosave'))
			continue;

		if (input.onchange !== null) input.onchange = save_rule
		if (input.onkeyup !== null) input.onkeyup = delayed_save(save_rule)
	}

	document.getElementById('remove_rule').onclick = erase_rule
	document.querySelector('button[name="reset_rules"]').onclick = reset_rules
}


apply_i18n();
prefs.load().then(populate_options);
Rules.serialize().then(populate_rules)

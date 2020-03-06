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


function update_page(options)
{
	document.querySelector('input[name="hlstyle"]').disabled = !options.highlight;
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
	let options = {}
	for (let field of Array.from(document.querySelectorAll('input, textarea')))
	{
		if (typeof Prefs.values[field.name] == 'boolean')
			options[field.name] = field.checked;
		else if (Prefs.values[field.name] instanceof RegExp)
		{
			var error_span = document.querySelector('span#' + field.name + '_error');
			if (check_regexp(field.value || '.^', document.getElementById('path_error')))
				options[field.name] = field.value;
			else
				options[field.name] = Prefs.values[field.name].source;
		}
		else if (field.name in Prefs)
			options[field.name] = field.value;
	}

	update_page(options);

	browser.storage.sync.set({configuration: options}).then(() =>
	{
		browser.runtime.sendMessage({action: 'options'});
		Prefs.reload();
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
	var values = Prefs.serialize();
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
	update_page(values);
}


function remove_rule_item(list, element)
{
	let selection = document.getElementById('rule_selector');
	let selected_opt = selection[selection.selectedIndex];

	let rule = JSON.parse(selected_opt.value);
	let pos = rule[list].indexOf(element);
	if (pos === -1)
		return;
	rule[list].splice(pos, 1)
	selected_opt.value = JSON.stringify(rule);
}


function show_rule_item(list, element, elemtype)
{
	let span = document.createElement('span'), text = element;
	if (list === 'rewrite')
		text = element.search + ' → ' + element.replace

	span.appendChild(document.createTextNode(text));
	if (elemtype !== 'inherit') {
		span.onclick = () => {
			remove_rule_item(list, element)
			span.remove()
		}
	}
	document.getElementById(list + '_' + elemtype + 'list').appendChild(span)
}


function add_rule_item(list, element, replace, flags)
{
	let selection = document.getElementById('rule_selector');
	let selected_opt = selection[selection.selectedIndex];

	if (list === 'rewrite')
		element = {search: element, replace: replace, flags: flags}

	let rule = JSON.parse(selected_opt.value);
	let pos = rule[list].indexOf(element);
	if (pos === -1)
	{
		rule[list].push(element)
		selected_opt.value = JSON.stringify(rule);
		show_rule_item(list, element, 'item')
	}

	return true;
}


function name_rule(rule)
{
	let domain = rule.domain.substring(1), path = rule.path;

	if (domain.startsWith('.'))
		domain = domain.substring(1)
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

	if (document.getElementById('rule_selector').selectedIndex === 0)
	{
		document.querySelector('input[name="domain"]').value = '';
		document.querySelector('input[name="suffix"]').value = '';
		document.querySelector('input[name="path"]').value = '';
		document.querySelector('input[name="subdomains"]').checked = true;
		document.querySelector('input[name="whitelist_path"]').checked = false;

		document.getElementById('remove_rule').disabled = true
		return;
	}

	let rule = JSON.parse(document.getElementById('rule_selector').value);
	console.log(document.getElementById('rule_selector').value)
	const subdomains = !rule.domain.startsWith('..')
	document.querySelector('input[name="domain"]').value = rule.domain.substring(subdomains ? 1 : 2)
	document.querySelector('input[name="subdomains"]').checked = subdomains;
	document.querySelector('input[name="suffix"]').value = rule.suffix.substring(1)
	document.querySelector('input[name="path"]').value = rule.path === '/*' ? '' : rule.path;
	document.querySelector('input[name="whitelist_path"]').checked = rule.whitelist_path

	for (let [list, action] of Object.entries(default_actions))
	{
		if (!Array.isArray(action))
			continue;

		for (let val of rule[list])
			show_rule_item(list, val, 'item');
		for (let val of rule.inherited[list])
			show_rule_item(list, val, 'inherit');
	}

	document.getElementById('remove_rule').disabled = false
}


function filter_rules()
{
	let search = document.getElementById('rule_filter').value;
	Array.from(document.querySelectorAll('#rule_selector option')).forEach((opt, idx) =>
	{
		if (idx !== 0)
		{
			console.log(opt.text, search, opt.text.match(search) ? 'match': 'NO')
			opt.style.display = !search || opt.text.match(search) ? 'block' : 'none';
		}
	});
}


function erase_rule()
{
	let select = document.getElementById('rule_selector');
	let selected_opt = select[select.selectedIndex];
	select[0].checked = true;
	if (select.selectedIndex == 0) {
		selected_opt.value = '{}';
	} else {
		Rules.remove(JSON.parse(selected_opt.getAttribute('orig-value')))
		select.selectedIndex--;
		selected_opt.remove()
	}
	load_rule();
}


function save_rule()
{
	let select = document.getElementById('rule_selector');
	let selected_opt = select[select.selectedIndex];

	let rule = Object.assign(JSON.parse(selected_opt.value), {
		domain: '.' + (document.querySelector('input[name="domain"]').value || '*'),
		suffix: '.' + (document.querySelector('input[name="suffix"]').value || '*'),
		path: document.querySelector('input[name="path"]').value || '/*',
		whitelist_path: document.querySelector('input[name="whitelist_path"]').checked
	});


	if (rule.path !== '/*' && !check_regexp(rule.path, document.getElementById('path_error')))
		return;

	if (!document.querySelector('input[name="subdomains"]').checked && rule.domain !== '.*')
		rule.domain = '.' + rule.domain;

	// Perform the update operation immediately in the DOM
	let replacing = null;
	if (select.selectedIndex === 0) {
		select[0].value = JSON.stringify(default_actions)
		selected_opt = select.appendChild(new Option(name_rule(rule), JSON.stringify(rule), false, true))
	} else {
		replacing = JSON.parse(selected_opt.getAttribute('orig-value'));
		selected_opt.replaceChild(document.createTextNode(name_rule(rule)), selected_opt.firstChild);
	}

	let rule_str = JSON.stringify(rule)
	selected_opt.setAttribute('value', rule_str);
	selected_opt.setAttribute('orig-value', rule_str);

	// Then the same operation [old rule -> new rule] to the rule storage, the ensure operations happen in the same order
	if (replacing === null) {
		Queue.add(async () => await Rules.add(rule));
	} else {
		Queue.add(async () => await Rules.update(replacing, rule));
	}
}


function import_rules()
{
	let get_json = this.files[0].text();
	return get_json.then(data => Rules.replace(JSON.parse(data))).catch(err => console.error('Error importing rules', err))
			.then(() => window.location.reload());
}


function export_rules()
{
	return Rules.loaded.then(rules =>
	{
		let blob = new Blob([JSON.stringify(rules)], {type : 'data:application/json;charset=utf-8'})
		browser.downloads.download({filename: 'clean_links_rules.json', url: URL.createObjectURL(blob)});
	})
}


function reset_rules()
{
	// clear rules storage, reload everything
	Rules.reset().then(() =>
	{
		browser.runtime.sendMessage({action: 'rules'}).then(page =>
		{
			window.location.reload();
		})
	})
}

function populate_rules()
{
	let serialized_rules = Rules.serialize()
	let select = document.getElementById('rule_selector')
	for (let rule of serialized_rules)
	{
		let opt = select.appendChild(new Option(name_rule(rule), JSON.stringify({...default_actions, ...rule})))
		opt.setAttribute('orig-value', opt.getAttribute('value'))
	}
	select[0].value = JSON.stringify(default_actions)

	select.onchange = load_rule

	for (const list of ['remove', 'whitelist'])
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

	{
		let button = document.getElementById('rewrite_add');
		let input_s = document.querySelector('input[name="search_edit"]');
		let input_r = document.querySelector('input[name="replace_edit"]');
		let flags_g = document.querySelector('input[name="rewrite_repeat"]');
		let flags_i = document.querySelector('input[name="rewrite_icase"]');
		button.onclick = () =>
		{
			if (input_s.value && check_regexp(input_s.value, document.getElementById('search_edit_error')))
			{
				let flags = (flags_g.checked ? 'g' : '') + (flags_g.checked ? 'i' : '');
				add_rule_item('rewrite', input_s.value, input_r.value, flags);
				input_s.value = input_r.value = '';
				flags_g.checked = flags_i.checked = true;
				save_rule()
			}
		}

		let check_val = () => check_regexp(input_s.value, document.getElementById('search_edit_error'));
		input_s.onchange = check_val;
		input_s.onkeyup = delayed_save(check_val);
	}

	document.querySelector('input[name="whitelist_path"]').onchange = save_rule
	document.getElementById('rule_filter').onchange = filter_rules
	document.getElementById('rule_filter').onkeyup = delayed_save(filter_rules)

	for (let input of document.querySelectorAll('#rule_editor input'))
	{
		if (input.getAttribute('name') === 'ignhttp' || input.classList.contains('noautosave'))
			continue;

		if (input.onchange !== null) input.onchange = save_rule
		if (input.onkeyup !== null) input.onkeyup = delayed_save(save_rule)
	}

	document.getElementById('remove_rule').onclick = erase_rule
	document.querySelector('button[name="reset_rules"]').onclick = reset_rules
	document.querySelector('button[name="export_rules"]').onclick = export_rules
	document.querySelector('button[name="import_rules"]').onclick = () => document.getElementById('import_rules').click()
	document.getElementById("import_rules").onchange = import_rules
}


apply_i18n();
Prefs.loaded.then(populate_options);
Rules.loaded.then(populate_rules)

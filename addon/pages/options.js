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

let unsaved_changes = false;


function update_page(options)
{
	document.querySelector('input[name="hlstyle"]').disabled = !options.highlight;
}


function check_regexp(expr, error_span)
{
	try
	{
		var r = new RegExp(expr);
		error_span.innerText = '';
		return true;
	}
	catch (e)
	{
		error_span.innerText = _('Error Processing Regular expression:') + ' ' + e.message;
		return false;
	}
}


function actions_differ(rule, orig_rule)
{
	for (let [action, val] of Object.entries(default_actions))
	{
		if (Array.isArray(val) && orig_rule[action].length !== rule[action].length)
			return true;
		else if (Array.isArray(val))
		{
			orig_rule[action].sort()
			rule[action].sort()

			if (undefined !== rule[action].find((item, idx) => item !== orig_rule[action][idx]))
				return true;
		}
		else if (orig_rule[action] !== rule[action])
			return true;
	}

	return false;
}


function save_options()
{
	let options = {}
	for (let field of Array.from(document.querySelectorAll('input, textarea')))
	{
		if (typeof Prefs.values[field.name] == 'boolean')
			options[field.name] = field.checked;
		else if (field.name in Prefs)
			options[field.name] = field.value;
	}

	browser.storage.sync.set({configuration: options}).then(() =>
	{
		update_page(options);

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

	rule_changed();
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


function validate_item(list)
{
	let input_name = list !== 'rewrite' ? list + '_edit' : 'search_edit';
	let input = document.querySelector('input[name="' + input_name + '"]');
	let error_span = document.getElementById(input_name + '_error');

	if (!input.value)
	{
		error_span.innerText = _('Empty expression!');
	}
	else if (check_regexp(input.value, error_span))
	{
		let args = [input.value];
		input.value = '';

		if (list === 'rewrite')
		{
			let replace = document.querySelector('input[name="replace_edit"]');
			let flags_g = document.querySelector('input[name="rewrite_repeat"]');
			let flags_i = document.querySelector('input[name="rewrite_icase"]');

			args.push(replace.value, (flags_g.checked ? 'g' : '') + (flags_i.checked ? 'i' : ''));

			replace.value = '';
			flags_g.checked = flags_i.checked = true;
		}

		add_rule_item(list, ...args);
		rule_changed()
		document.getElementById(list + '_editor').style.display = 'none';
	}
}


function name_rule(rule)
{
	let domain = rule.domain || '*.*', path = rule.path || '';

	if (domain.startsWith('.'))
		domain = domain.substring(1)
	else if (domain !== '*.*')
		domain = '*.' + domain

	if (path && !path.startsWith('/'))
		path = '/' + path

	return domain + path;
}


function no_rule_loaded()
{
	document.querySelector('input[name="domain"]').value = '';
	document.querySelector('input[name="path"]').value = '';
	document.querySelector('input[name="subdomains"]').checked = true;
	document.querySelector('input[name="whitelist_path"]').checked = false;

	document.querySelector('input[name="domain"]').disabled = true;
	document.querySelector('input[name="path"]').disabled = true;
	document.querySelector('input[name="subdomains"]').disabled = true;
	document.querySelector('input[name="whitelist_path"]').disabled = true;

	document.getElementById('remove_rule').disabled = true
}


function load_rule()
{
	for (let list of document.querySelectorAll('span.itemlist, span.inheritlist'))
		while (list.lastChild)
			list.removeChild(list.lastChild);

	let select = document.getElementById('rule_selector');
	let rule = {domain: '*.*', path: '', inherited: {...default_actions}, ...JSON.parse(select.value)};
	const subdomains = !rule.domain.startsWith('.');
	document.querySelector('input[name="domain"]').value = rule.domain.substring(subdomains ? 0 : 1)
	document.querySelector('input[name="subdomains"]').checked = subdomains;
	document.querySelector('input[name="path"]').value = rule.path;
	document.querySelector('input[name="whitelist_path"]').checked = rule.whitelist_path

	document.querySelector('input[name="domain"]').disabled = false;
	document.querySelector('input[name="path"]').disabled = false;
	document.querySelector('input[name="subdomains"]').disabled = false;
	document.querySelector('input[name="whitelist_path"]').disabled = false;

	for (let [list, action] of Object.entries(default_actions))
	{
		if (!Array.isArray(action))
			continue;

		for (let val of rule[list])
			show_rule_item(list, val, 'item');
		for (let val of rule.inherited[list])
			show_rule_item(list, val, 'inherit');
	}

	document.getElementById('remove_rule').disabled = false;

	if (select[select.selectedIndex].hasAttribute('orig-value'))
		rule_pristine();
}


function filter_rules()
{
	let search = document.getElementById('rule_filter').value;
	for (let opt of document.querySelectorAll('#rule_selector option'))
		opt.style.display = !search || opt.text.match(search) ? 'block' : 'none';
}


function erase_rule()
{
	let select = document.getElementById('rule_selector');
	let selected_opt = select[select.selectedIndex];

	if (selected_opt.hasAttribute('orig-value'))
		Rules.remove(JSON.parse(selected_opt.getAttribute('orig-value')))

	let next_up = selected_opt.previousSibling;
	while (next_up !== null && next_up.style.display === 'none')
		next_up = next_up.previousSibling;

	if (next_up !== null)
	{
		next_up.selected = true;
		load_rule();
	}
	else
	{
		select.selectedIndex = -1;
		no_rule_loaded();
	}

	selected_opt.remove()
}


function parse_rule(select)
{
	if (select.value === '')
		return no_rule_loaded();

	let rule = Object.assign(JSON.parse(select.value),
	{
		domain: document.querySelector('input[name="domain"]').value || '*.*',
		path: document.querySelector('input[name="path"]').value || '',
		whitelist_path: document.querySelector('input[name="whitelist_path"]').checked,
	});

	if (rule.path !== '' && !check_regexp(rule.path, document.getElementById('path_error')))
		return;

	if (!document.querySelector('input[name="subdomains"]').checked && rule.domain !== '.*')
		rule.domain = '.' + rule.domain;

	return rule
}


function rule_changed()
{
	/* some smarter checks */
	let select = document.getElementById('rule_selector');
	if (select.selectedIndex === -1)
		return rule_pristine();

	let opt = select[select.selectedIndex];
	let rule = {...default_actions, ...parse_rule(select)};
	let orig_rule = opt.hasAttribute('orig-value') ? {...default_actions, ...JSON.parse(opt.getAttribute('orig-value'))} : null;
	let same_node = orig_rule && (orig_rule.domain || '*.*') === rule.domain && (orig_rule.path || '') === rule.path;

	if (!same_node && Rules.exists(rule))
		document.getElementById('rule_error').innerText = _('Rule $RULE_NAME$ already exists', name_rule(rule));
	else
		document.getElementById('rule_error').innerText = '';

	unsaved_changes = !same_node || actions_differ(rule, orig_rule || default_actions);

	document.getElementById('save_rule').disabled = !unsaved_changes;
	document.getElementById('add_rule').disabled = unsaved_changes;
}


function rule_pristine()
{
	unsaved_changes = false;
	document.getElementById('save_rule').disabled = !unsaved_changes;
	document.getElementById('add_rule').disabled = unsaved_changes;
	document.getElementById('rule_error').innerText = '';
}


function insert_rule()
{
	let opt = new Option(name_rule(default_actions), JSON.stringify(default_actions), false, true);
	document.getElementById('rule_selector').appendChild(opt);
	load_rule();
}


function save_rule()
{
	let select = document.getElementById('rule_selector');
	let selected_opt = select[select.selectedIndex];

	let rule = parse_rule(select);

	if (!rule)
		return;

	// Perform the update operation immediately in the DOM
	let replacing = null;
	if (selected_opt.hasAttribute('orig-value'))
	{
		replacing = JSON.parse(selected_opt.getAttribute('orig-value'));
		selected_opt.replaceChild(document.createTextNode(name_rule(rule)), selected_opt.firstChild);
	}

	let rule_str = JSON.stringify(rule);
	selected_opt.setAttribute('value', rule_str);
	selected_opt.setAttribute('orig-value', rule_str);

	// Then the same operation [old rule -> new rule] to the rule storage, the ensure operations happen in the same order
	if (replacing === null)
		Queue.add(() => Rules.add(rule));
	else
		Queue.add(() => Rules.update(replacing, rule));

	rule_pristine();
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


function prepopulate_rule(link)
{
	let url = new URL(link)
	document.getElementById('rule_selector').selectedIndex = 0;
	document.querySelector('input[name="domain"]').value = url.hostname;
	document.querySelector('input[name="path"]').value = url.pathname;

	rule_changed();
}


function populate_rules()
{
	let select = document.getElementById('rule_selector'), restore_selection = select.value;
	select.onchange = null;

	while (select.lastChild)
		select.lastChild.remove();

	for (let rule of Rules.serialize())
	{
		let opt = select.appendChild(new Option(name_rule(rule), JSON.stringify({...default_actions, ...rule})))
		opt.setAttribute('orig-value', opt.getAttribute('value'))
		opt.setAttribute('parents', rule.parents.map(name_rule).join(', '));
	}

	for (const list of ['remove', 'whitelist', 'rewrite'])
	{
		let editor = document.querySelector('#' + list + '_editor');
		let input_name = list !== 'rewrite' ? list + '_edit' : 'search_edit';
		let input = document.querySelector('input[name="' + input_name + '"]');

		document.getElementById(list + '_add').onclick = () =>
		{
			for (let item of document.querySelectorAll('.editor'))
				item.style.display = item.id === list + '_editor' ? 'block' : 'none';
			input.select();
		}

		input.addEventListener('keyup', e =>
		{
			if (e.key === 'Enter')
			{
				e.stopPropagation();
				e.preventDefault();
				validate_item(list);
			}
		});

		editor.querySelector('.ok').onclick = () =>
		{
			validate_item(list);
		}
		editor.querySelector('.cancel').onclick = () =>
		{
			editor.style.display = 'none';
		}

		let check_val = () => check_regexp(input.value, document.getElementById(input_name + '_error'));
		input.onchange = check_val;
		input.onkeyup = delayed_save(check_val);
	}

	if (restore_selection === '')
		no_rule_loaded();
	else
		select.value = restore_selection;

	filter_rules();
	select.onchange = load_rule
}


function add_listeners()
{
	document.querySelector('input[name="domain"]').onchange = rule_changed
	document.querySelector('input[name="domain"]').onkeyup = delayed_save(rule_changed)
	document.querySelector('input[name="path"]').onchange = rule_changed
	document.querySelector('input[name="path"]').onkeyup = delayed_save(rule_changed)
	document.querySelector('input[name="subdomains"]').onchange = rule_changed
	document.querySelector('input[name="whitelist_path"]').onchange = rule_changed

	document.getElementById('rule_filter').onchange = filter_rules
	document.getElementById('rule_filter').onkeyup = delayed_save(filter_rules)
	document.getElementById('remove_rule').onclick = erase_rule
	document.getElementById('save_rule').onclick = save_rule
	document.getElementById('add_rule').onclick = insert_rule
	document.querySelector('button[name="reset_rules"]').onclick = reset_rules
	document.querySelector('button[name="export_rules"]').onclick = export_rules
	document.querySelector('button[name="import_rules"]').onclick = () => document.getElementById('import_rules').click()
	document.getElementById("import_rules").onchange = import_rules

	document.addEventListener('keyup', e =>
	{
		if (e.key === 'Escape')
			for (let item of document.querySelectorAll('.editor'))
				if (item.style.display !== 'none')
				{
					e.stopPropagation();
					e.preventDefault();
					item.style.display = 'none';
				}
	});

	document.addEventListener('beforeunload', evt =>
	{
		if (unsaved_changes)
			evt.preventDefault();
	});

	browser.runtime.sendMessage({action: 'get prepopulate'}).then(answer =>
	{
		if ('link' in answer)
			prepopulate_rule(answer.link)
	})

	browser.runtime.onMessage.addListener(message =>
	{
		console.log('Options page message', message);
		if (message.action === 'set prepopulate')
		{
			prepopulate_rule(message.link);
			return browser.runtime.sendMessage({action: 'get prepopulate'})
		}
		else if (message.action === 'rules')
			Rules.reload().then(populate_rules);
		else if (message.action === 'reload options')
			Prefs.reload().then(populate_options());
	});
}


apply_i18n();
Prefs.loaded.then(populate_options);
Rules.loaded.then(populate_rules).then(add_listeners)

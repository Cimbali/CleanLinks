function recursive_find(rules, keys)
{
	if (!keys.length)
	{
		console.log('Leaf: returning ' + JSON.stringify(rules))
		return rules
	}

	var search = keys.shift();

	let matches = Object.keys(rules).filter(val => val === '*' || search.match(RegExp(val)))
	return matches.reduce((acc, val) => acc.concat(recursive_find(rules[val], [...keys])), [])
}


function find_rules(url, all_rules)
{
	// use public domain not really TLD
	var tld = '.' + publicSuffixList.getPublicSuffix(url.hostname);
	var domain = url.hostname.substr(0, url.hostname.length - tld.length);

	let aggregated = {}, action_list = recursive_find(all_rules, [tld, domain, url.pathname])
	for (let actions of action_list)
		for (let key of Object.keys(actions))
			aggregated[key] = actions[key].concat(key in aggregated ? aggregated[key] : [])

	return aggregated;
}

// rules have 4 depths: TLD, domain, path, action type
const load_rules = Promise.resolve({
	"*": {
		"*": {
			"*": {
				"strip": ["^utm_"],
				"rewrite": ["/ref="]
			}
		},
		"accounts.google": {
			"/signin/.*/identifier(/.+)?|/ServiceLogin": {
				"url_ok": ["continue"]
			}
		},
		"www.google": { // i.e. *google.com
			"/search": {
				"url_ok": ["q"]
			}
		}
	}
})

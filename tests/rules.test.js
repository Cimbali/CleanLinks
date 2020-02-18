// Writing rules:
// - strict imbrication: any level optional, but ordering must be respected
//   domain > port > path > query params
// - first char of rule key determines type:
//     . domain part
//     : port
//     / path

function ext_path(cur_path, new_bit)
{
	if (new_bit[0] == '.')
		return new_bit + cur_path;
	else
		return cur_path + new_bit;
}

function print_rules(rules, path)
{
	if (path == undefined)
		path = ''

	if ("actions" in rules)
		console.log({['*' + path]: rules.actions})

	for (let key in rules)
		if (key != "actions")
		  print_rules(rules[key], ext_path(path, key));
}


const all_rules = {
	"actions": "set1",
	".co.uk": {
		".google": { // i.e. *google.co.uk
			":443": { // i.e. *google.co.uk
				"actions": "set5"
			}
		}
	},
	".com": {
		".google": { // i.e. *google.com
			"actions": "set6",
			"/search": {
				"actions": "set7"
			}
		}
	},
	".*": {
		".google": { // i.e. *google.*
			"/*": { // i.e. *google.*/*
				"actions": "set3"
			},
			"/search": {
				"/$": {
					"actions": "set2"
				},
			},
			"/signin": {
				"/**": {
					"/identifier": {
						"actions": "set8"
					}
				}
			}
		}
	},
}
let google_login = new URL("https://accounts.google.co.uk/signin/v2/sl/foo/bar/baz/qux/identifier")
let google_search = new URL("https://google.com/search?client=firefox-b-ab&q=some+search+terms")
let dummy_url = new URL("https://a.b.c.de/")


describe('find_rules', function() {
	console.log(all_rules);
	print_rules(all_rules);

	it('should work', done =>
	{
		console.log(google_login.href);
		let result = find_rules(google_login, all_rules)
		console.log(result)
		expect(result).to.equal(['set1', 'set3', 'set8'])
		done();
	});
	it('should work', done =>
	{
		console.log(google_search.href);
		let result = find_rules(google_search, all_rules)
		console.log(result)
		expect(result).to.equal(['set1', 'set6', 'set7'])
		done();
	});
	it('should work', done =>
	{
		console.log(dummy_url.href);
		let result = find_rules(dummy_url, all_rules)
		console.log(result)
		expect(result).to.equal(['set1'])
		done();
	});
});

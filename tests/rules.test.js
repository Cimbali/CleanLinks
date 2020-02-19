const all_rules = {
	"*": {
		"*": {
			"*": {
				"check": ["all"],
				"ignore": ["don’t look at me"]
			}
		},
		"accounts.google": {
			"/signin/.*/identifier(/.+)?": {
				"check": ["accounts.google.*/signin/**/identifier"]
			}
		}
	},
	".co.uk": {
		"google": { // i.e. *google.co.uk
			"*": {
				"check": ["google.co.uk"]
			}
		}
	},
	".com": {
		"google": { // i.e. *google.com
			"/search": {
				"check": ["google.com/search"]
			}
		}
	},
}

let google_login = new URL("https://accounts.google.co.uk/signin/v2/sl/foo/bar/baz/qux/identifier")
let google_search = new URL("https://google.com/search?client=firefox-b-ab&q=some+search+terms")
let dummy_url = new URL("https://a.b.c.de/")


describe('find_rules', function() {
	it('should work', () =>
	{
		return publicSuffixList.loaded.then(() =>
		{
			let result = find_rules(google_login, all_rules)
			const exp = ['all', 'google.co.uk', 'accounts.google.*/signin/**/identifier']
			console.log(google_login.href + '\nfound: ' + JSON.stringify(result) + '\nexpected: ' + exp);
			expect(result.check).to.have.members(exp)
		})
	});
	it('should work', () =>
	{
		return publicSuffixList.loaded.then(() =>
		{
			let result = find_rules(google_search, all_rules)
			const exp = ['all', 'google.com/search']
			console.log(google_search.href + '\nfound: ' + JSON.stringify(result) + '\nexpected: ' + exp);
			expect(result.check).to.have.members(exp)
		});
	});
	it('should only match global rules', () =>
	{
		return publicSuffixList.loaded.then(() =>
		{
			let result = find_rules(dummy_url, all_rules)
			expect(result.check).to.have.members(['all'])
		});
	});
});

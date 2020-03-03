let so_login = new URL("https://stackoverflow.com/users/login?ssrc=head&returnurl=https%3a%2f%2fstackoverflow.com%2f")
let google_search = new URL("https://www.google.com/search?client=firefox-b-ab&q=some+search+terms")
let amazon_url = new URL("https://www.amazon.es/gp/product/B06Y1VKRXJ/ref=ppx_od_dt_b_asin_title_s00?ie=UTF8&psc=1")


describe('find_rules', function() {
	it('should return correct continue whitelist for SO login', () =>
	{
		return load_rules.then(all_rules =>
		{
			let result = find_rules(so_login, all_rules)
			console.log(so_login.href + '\nfound: ' + JSON.stringify(result))
			expect(result.whitelist).to.have.members(['returnurl'])
		});
	});
	it('should return correct continue whitelist for google search', () =>
	{
		return load_rules.then(all_rules =>
		{
			let result = find_rules(google_search, all_rules)
			console.log(google_search.href + '\nfound: ' + JSON.stringify(Object.keys(result)))
			expect(result.whitelist).to.have.members(['q'])
		});
	});
	it('should return correct continue whitelist for amazon product pages', () =>
	{
		return load_rules.then(all_rules =>
		{
			let result = find_rules(amazon_url, all_rules)
			console.log(amazon_url.href + '\nfound: ' + JSON.stringify(Object.keys(result)))
			expect(result.rewrite).to.have.members(['/ref=[^/]*'])
		});
	});
});

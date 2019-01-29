function match_before_path(capture)
{
	var [before_path] = capture.match(decoded_url_beforepath) || [''];
	return before_path;
}

describe('match_before_path', function() {
	it('should match only the URL parts before the path', done =>
	{
		expect(match_before_path('https://www.airbnb.co.uk/rooms/123456789')).to.equal('https://www.airbnb.co.uk');
		expect(match_before_path('https://static2.s-trojmiasto.pl/zdj/c/n/9/2079/1100x0/2079199-Wizualizacja-obrotowej-kladki-Sw-Ducha.jpg')).to.equal('https://static2.s-trojmiasto.pl');
		expect(match_before_path('https://ko.wikipedia.org/wiki/%EC%9C%84%ED%82%A4%EB%B0%B1%EA%B3%BC:%EB%8C%80%EB%AC%B8')).to.equal('https://ko.wikipedia.org');
		expect(match_before_path('http://foo.com/blah_blah')).to.equal('http://foo.com');
		expect(match_before_path('http://foo.com/blah_blah/')).to.equal('http://foo.com');
		expect(match_before_path('http://foo.com/blah_blah_(wikipedia)')).to.equal('http://foo.com');
		expect(match_before_path('http://foo.com/blah_blah_(wikipedia)_(again)')).to.equal('http://foo.com');
		expect(match_before_path('http://www.example.com/wpstyle/?p=364')).to.equal('http://www.example.com');
		expect(match_before_path('https://www.example.com/foo/?bar=baz&inga=42&quux')).to.equal('https://www.example.com');
		expect(match_before_path('http://userid:password@example.com:8080/')).to.equal('http://userid:password@example.com:8080');
		expect(match_before_path('http://userid@example.com')).to.equal('http://userid@example.com');
		expect(match_before_path('http://userid@example.com/foo/bar.baz?qux=stuff')).to.equal('http://userid@example.com');
		expect(match_before_path('http://userid@example.com:8080')).to.equal('http://userid@example.com:8080');
		expect(match_before_path('http://userid@example.com:8080/')).to.equal('http://userid@example.com:8080');
		expect(match_before_path('http://userid:password@example.com')).to.equal('http://userid:password@example.com');
		expect(match_before_path('http://userid:password@example.com/')).to.equal('http://userid:password@example.com');
		expect(match_before_path('http://142.42.1.1/')).to.equal('http://142.42.1.1');
		expect(match_before_path('http://142.42.1.1:8080/')).to.equal('http://142.42.1.1:8080');
		expect(match_before_path('http://j.mp')).to.equal('http://j.mp');
		expect(match_before_path('ftp://foo.bar/baz')).to.equal('ftp://foo.bar');
		expect(match_before_path('http://foo.bar/?q=Test%20URL-encoded%20stuff')).to.equal('http://foo.bar');
		expect(match_before_path('http://1337.net')).to.equal('http://1337.net');
		expect(match_before_path('http://a.b-c.de')).to.equal('http://a.b-c.de');
		expect(match_before_path('http://223.255.255.254')).to.equal('http://223.255.255.254');
		expect(match_before_path('http://[FEDC:BA98:7654:3210:FEDC:BA98:7654:3210]:80/index.html')).to.equal('http://[FEDC:BA98:7654:3210:FEDC:BA98:7654:3210]:80');
		expect(match_before_path('http://[1080:0:0:0:8:800:200C:417A]/index.html')).to.equal('http://[1080:0:0:0:8:800:200C:417A]');
		expect(match_before_path('http://[3ffe:2a00:100:7031::1]')).to.equal('http://[3ffe:2a00:100:7031::1]');
		expect(match_before_path('http://[1080::8:800:200C:417A]/foo?baz=bar:qux')).to.equal('http://[1080::8:800:200C:417A]');
		expect(match_before_path('http://[::192.9.5.5]/ipng')).to.equal('http://[::192.9.5.5]');
		expect(match_before_path('http://[::FFFF:129.144.52.38]:80/index.html')).to.equal('http://[::FFFF:129.144.52.38]:80');
		expect(match_before_path('http://[2010:836B:4179::836B:4179]')).to.equal('http://[2010:836B:4179::836B:4179]');
		done();
	});
});

describe('cleanLink', function() {
	it('should clean the link to the target in path', done =>
	{
		expect(cleanLink('http://www.foobar.com/track=ftp://gnu.org')).to.equal('ftp://gnu.org/');
		done();
	});
	it('should clean the link to the base 64 encoded URL', done =>
	{
		expect(cleanLink('http://example.com/aHR0cDovL3d3dy5nb29nbGUuY29t?arg=val')).to.equal('http://www.google.com/');
		done();
	});
	it('should clean the link to the simple javascript function argument', done =>
	{
		expect(cleanLink("javascript:window.open('http://somesite.com/')")).to.equal('http://somesite.com/');
		done();
	});
	it('should clean the link to the complex javascript function argument', done =>
	{
		expect(cleanLink("javascript:func(\"arg1\", 'arg2', 'http://somesite.com', 'target=\"_self\"')")).to.equal('http://somesite.com/');
		done();
	});
	it('should clean the link to the javascript function relative path argument', done =>
	{
		expect(cleanLink("javascript:displayWindowzdjecie('/_misc/zdj_wym.php?url_zdjecie=https://static2.s-trojmiasto.pl/zdj/c/n/9/2079/1100x0/2079199-Wizualizacja-obrotowej-kladki-Sw-Ducha.jpg',1100,778);"))
			.to.equal('https://static2.s-trojmiasto.pl/zdj/c/n/9/2079/1100x0/2079199-Wizualizacja-obrotowej-kladki-Sw-Ducha.jpg');
		done();
	});
	it('should clean the link to the URL-encoded URL in parameters', done =>
	{
		expect(cleanLink('https://l.messenger.com/l.php?u=https%3A%2F%2Fwww.airbnb.co.uk%2Frooms%2F123456789&h=ATO7e0WkmJSY2jU_U6fyz6-MmwWZvfV4NAQwuaK1aB9QwmXdOZuHbPceKl8FCqHYTbEpoSWufsOmj36S4K0DI6BLpuIyGoRK_OcE5UHyPnY'))
			.to.equal('https://www.airbnb.co.uk/rooms/123456789');
		done();
	});
	it('should clean the link to the Doubly encoded URL in path and parameters', done =>
	{
		expect(cleanLink('http://two.level.redir.ect/https%3A%2F%2Fl.messenger.com%2Fl.php%3Fu%3Dhttps%253A%252F%252Fwww.airbnb.co.uk%252Frooms%252F123456789%26h%3DATO7e0WkmJSY2jU_U6fyz6-MmwWZvfV4NAQwuaK1aB9QwmXdOZuHbPceKl8FCqHYTbEpoSWufsOmj36S4K0DI6BLpuIyGoRK_OcE5UHyPnY'))
			.to.equal('https://www.airbnb.co.uk/rooms/123456789');
		done();
	});
	it('should preserve a link without redirects', done =>
	{
		let link = 'https://assets-cdn.github.com/assets/frameworks-95aff0b550d3fe338b645a4deebdcb1b.css'
		expect(cleanLink(link)).to.equal(link);
		done();
	});
	it('should strip the utm parameters', done =>
	{
		expect(cleanLink('https://www.aboutamazon.com/?keep=this&utm_source=gateway&utm_medium=footer'))
			.to.equal('https://www.aboutamazon.com/?keep=this');
		done();
	});
	it('should manage fb mobile URLs with all the path in the hash', done =>
	{
		let link = 'https://m.facebook.com/home.php#!/photo.php?fbid=1234567890&id=1234567890&set=a.1234567890&source=1234567890&refid=1234567890&_ft_=qid.1234567890%1234567890Amf_story_key.1234567890%1234567890Aog_action_id.1234567890%1234567890Atop_level_post_id.1234567890%1234567890Asrc.1234567890%1234567890Aphoto_id.1234567890&__tn__=EH-R'
		expect(cleanLink(link)).to.equal(link);
		done();
	});
	it('should keep valid encoded characters in cleaned links', done =>
	{
		let link ='https://www.google.com/url?sa=t&rct=j&url=https%3A%2F%2Fzh.wikipedia.org%2Fzh%2F%25E6%25B1%2589%25E8%25AF%25AD&source=web'
		expect(cleanLink(link)).to.equal('https://zh.wikipedia.org/zh/%E6%B1%89%E8%AF%AD');
		done();
	});
});

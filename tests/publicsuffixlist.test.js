let tests = {'publicsuffix.org': 'org', 'www.popsugar.co.uk': 'co.uk', 'www.perkins.pvt.k12.ma.us': 'pvt.k12.ma.us',
			'outgoing.prod.mozaws.net': 'net', 'subdomain.gitlab.io': 'gitlab.io'}

describe('PublicSuffixList.get_public_suffix', function()
{
	Object.keys(tests).forEach(domain =>
	{
		it('should identify public domain ' + tests[domain], done =>
		{
			PublicSuffixList.loaded.then(() =>
			{
				expect(PublicSuffixList.get_public_suffix(domain)).to.equal(tests[domain])
				done();
			}).catch(err => {console.error(err); done();});
		});
	});
});

// from https://gist.github.com/enepomnyaschih/72c423f727d395eeaa09697058238727
describe('base64utf8encode', function()
{
	it('should correctly encode UTF8 strings ', done =>
	{
		// Man = 0x4D, 0x61, 0x6E = TWFu (example from https://en.wikipedia.org/wiki/Base64)
		// Space = 0x20 = 0010 0000
		// Ё = 1101 0000 1000 0001
		// 𤭢 = 1111 0000 1010 0100 1010 1101 1010 0010
		// So, we get sixtets: 001000 001101 000010 000001 111100 001010 010010 101101 101000 10____
		//                     I      N      C      B      8      K      S      t      o      g = =
		const utf8encoder = new TextEncoder();
		const bytearr = utf8encoder.encode("Man Ё𤭢")

		expect(Base64Encoder.encode(bytearr)).to.equal("TWFuINCB8KStog==");
		done()
	});
	it('should correctly compute the size of arrays', done =>
	{
		expect(Base64Encoder.decodeSize("TWFuINCB8KStog==")).to.equal(10);
		done()
	});
	it('should correctly decode UTF8 strings ', done =>
	{
		// Reverse the previous test
		const bytearr = Base64Encoder.decode("TWFuINCB8KStog==")

		const utf8decoder = new TextDecoder();
		expect(utf8decoder.decode(bytearr)).to.equal("Man Ё𤭢");
		done()
	});
});

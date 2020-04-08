module.exports = config => Object.assign(config,
{
	basePath: '../',
	frameworks: [
		'mocha',
		'chai',
		'sinon-chrome'
	],

	plugins: [
		'karma-firefox-launcher',
		'karma-mocha',
		'karma-chai',
		'karma-sinon-chrome'
	],

	files: [
		// Help setup shim environments
		'tests/setup.js',

		// The files to be tested have to be served
		"addon/modules/browser-polyfill.js",
		"addon/modules/common.js",
		"addon/modules/punycode.js",
		"addon/modules/publicsuffixlist.js",
		"addon/modules/rules.js",
		"addon/modules/cleanlink.js",

		{type: 'css', included: false, served: true, nocache: true, pattern: "addon/data/*"},
		{type: 'html', included: false, served: true, nocache: true, pattern: "addon/pages/*.html"},
		{type: 'css', included: false, served: true, nocache: false, pattern: "addon/manifest.json"},

		// The tests, finally
		'tests/*.test.js',
	],

	proxies: {
		// css URLs don’t get rewritten
		'/icons/': 'http://localhost:9876/base/addon/icons/',
	},

	reporters: ['progress'],
	colors: true,
	restartOnFileChange: true,
	logLevel: config.LOG_INFO,
	autoWatch: true,
	browsers: ['FirefoxHeadless'],
	singleRun: false,
	concurrency: Infinity,
});

const scheme_ports =
{
	'acap': 674,
	'afp': 548,
	'dict': 2628,
	'dns': 53,
	'ftp': 21,
	'git': 9418,
	'gopher': 70,
	'http': 80,
	'https': 443,
	'imap': 143,
	'ipp': 631,
	'ipps': 631,
	'irc': 194,
	'ircs': 6697,
	'ldap': 389,
	'ldaps': 636,
	'mms': 1755,
	'msrp': 2855,
	'mtqp': 1038,
	'nfs': 111,
	'nntp': 119,
	'nntps': 563,
	'pop': 110,
	'prospero': 1525,
	'redis': 6379,
	'rsync': 873,
	'rtsp': 554,
	'rtsps': 322,
	'rtspu': 5005,
	'sftp': 22,
	'smb': 445,
	'snmp': 161,
	'ssh': 22,
	'svn': 3690,
	'telnet': 23,
	'ventrilo': 3784,
	'vnc': 5900,
	'wais': 210,
	'ws': 80,
	'wss': 443,
}

const char_prefixes =
{
	null: 'protocol',
	'.': 'domain',
	'/': 'path',
	':': 'port',
	'?': 'param'
}

let SerializedRule = class SerializedRule
{
	constructor()
	{
		this.protocol = []
		this.domain = []
		this.path = []
		this.port = []
		this.param = []
		this.actions = {}
	}
}

function serialize_rules(rules, obj)
{
	if (obj === undefined)
		obj = new SerializedRule()

	if ('actions' in rules)
	{
		obj.actions = rules.actions
		console.log(obj)
	}

	for (let key in rules)
		if (key != "actions")
		{
			var prop = char_prefixes[key[0]]
			// error: assign() shallow copies
			serialize_rules(rules[key], Object.assign(obj, {[prop]: obj[prop].concat([key])}))
		}
}


function ext_path(cur_path, new_bit)
{
	if (new_bit[0] == '.')
		return new_bit + cur_path;
	else
		return cur_path + new_bit;
}

// Perform a DFS search in rules (passed as this), looking for the key find_bits[0].
// Along every node, collect any actions we find.
// If we find find_bits[0], continue the DFS and pass along any supplementary parameters.
// Then, shift the supplementary parameters to replace find_bits, and perform that same DFS.
//
// You can see this as a 2D search, suppose the URL is a.b/c/d, then
// - The URL will be split in [[.b, .a], [/c, /d]]
// - The following graph gets walked (supposing there is always a node corresponding to each partial match),
//   from left to right matching increasing matches along the first dimension, or top down removing a dimension
// '*' [[.b, .a], [/c, /d]]  ----> '*.b'  [[.a], [/c, /d]]  -----> '*.a.b'  [[], [/c, /d]]
//  |                                |                                 |
//  |                                |                                 V
//  |                                V                               '*.a.b' [[/c, /d]] --> '*.a.b/c' [[/d]] --> '*.a.b/c/d' [[]]
//  V                              '*.b'  [[/c, /d]]  ---> '*.b/c' [[/d]]  ---> '*.b/c/d' [[]]
// '*' [[/c, d]]  ----> '*/c' [[/d]]  ----> '*/c/d' [[]]
//
// This has the advantage that any dimension can be added easily (with its own leading character), e.g. filter on ports:
// use [[.b, .a], [:80], [/c, /d]]

function recursive_find(path, find_bits)
{
	var actions = [];
	var extra_dimensions = Array.prototype.slice.call(arguments, 2);

	// Dimensions diminish in-place, i.e. at the same node
	if (extra_dimensions.length)
		actions.push(...recursive_find.call(this, path, ...extra_dimensions))

	// Waiting for no dimenions left to check for actions allows to skip not duplicate actions.
	else if ('actions' in this)
		actions.push([path, this.actions]);

	// if current dimension non-zero, diminish it
	if (Array.isArray(find_bits) && find_bits.length)
	{
		var this_bit = find_bits.shift();
		if (this_bit in this)
			actions.push(...recursive_find.call(this[this_bit], ext_path(path, this_bit), find_bits, ...extra_dimensions));
	}
	else
	{
		var keys = Object.keys(find_bits);
		if (!keys.length)
			return actions;

		// find a key in common, or use any single key just to guarantee advancement
		var this_bit = keys.find(bit => bit in this);
		var next_path = path, next_rules = this;
		if (this_bit !== undefined)
		{
			path = ext_path(path, this_bit);
			next_rules = this[this_bit];
			//var this_val = find_bits[this_bit];
		}
		else
			this_bit = keys[0];

		delete find_bits[this_bit];
		actions.push(...recursive_find.call(next_rules, next_path, find_bits, ...extra_dimensions));
	}

	var type = this_bit[0];

	// all types of wildcards
	if ((type + '*') in this)
		actions.push(...recursive_find.call(this[type + '*'], ext_path(path, type + '*'), find_bits, ...extra_dimensions));

	if ((type + '**') in this)
	{
		actions.push(...recursive_find.call(this, ext_path(path, type + '**'), find_bits, ...extra_dimensions));
		actions.push(...recursive_find.call(this[type + '**'], ext_path(path, type + '**'), find_bits, ...extra_dimensions));
	}

	return actions;
}


async function find_rules(url, all_rules)
{
	await publicSuffixList.loaded()

	var protocol = url.protocol.split(':').shift();
	var public_suffix = publicSuffixList.getPublicSuffix(url.hostname);
	console.log(public_suffix)
	var private_prefix = url.hostname.substr(0, url.hostname.length - public_suffix.length - 1);
	var hostname_bits = private_prefix.split('.').map(bit => '.' + bit).reverse();

	var find_args = ['', ['.' + public_suffix, ...hostname_bits, '.$']];

	if (url.port.length)
		find_args.push([':' + url.port])
	else if (protocol in scheme_ports)
		find_args.push([':' + scheme_ports[protocol]]);

	find_args.push([...url.pathname.substr(1).split('/').map(bit => '/' + bit), '/$']);

	return recursive_find.apply(all_rules, find_args);
}


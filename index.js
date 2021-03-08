var async = require('async-chainable');
var events = require('events');
var stream = require('stream');

var _fieldTranslations = { // Map of MEDLINE fields to RefLib fields - See https://www.nlm.nih.gov/bsd/mms/medlineelements.html for details
	'PMID': {reflib: 'recNo'},
	'AB  ': {reflib: 'abstract'},
	'AID ': {reflib: 'doi'},
	'FAU ': {reflib: 'authors', isArray: true},
	'AD  ': {reflib: 'affiliation', isArray: true},
	'DP  ': {reflib: 'date'},
	'ISBN': {reflib: 'isbn'},
	'JT  ': {reflib: 'journal'},
	'LA  ': {reflib: 'language'},
	'PG  ': {reflib: 'pages'},
	'PT  ': {reflib: 'type'},
	'PL  ': {reflib: 'address'},
	'TI  ': {reflib: 'title'},
	'VI  ': {reflib: 'volume'},
	'OT  ': {reflib: 'keywords', isArray: true},
};

var _fieldTranslationsReverse = Object.fromEntries(
	Object.entries(_fieldTranslations) // Calculate the key/val lookup - this time with the key being the reflib key
		.map(([key, props]) => [props.reflib, {...props, medline: key}])
);

// Lookup object of MEDLINE => RefLib types
var _typeTranslations = {
	'CASE REPORTS': 'case',
	'CLASSICAL ARTICLE': 'classicalWork',
	'DICTIONARY': 'dictionary',
	'JOURNAL ARTICLE': 'journalArticle',
	'LEGAL CASES': 'legalRuleOrRegulation',
	'LEGISLATION': 'legalRuleOrRegulation',
	'LETTER': 'personalCommunication',
	'NEWSPAPER ARTICLE': 'newspaperArticle',
	'TECHNICAL REPORT': 'report',
	'VIDEO-AUDIO MEDIA': 'filmOrBroadcast',
	'WEBCASTS': 'web',
};
var _typeTranslationsReverse = Object.fromEntries(
	Object.entries(_typeTranslations)
		.map(([key, val]) => [val, key])
)

function parse(content) {
	var emitter = new events.EventEmitter();

	var parser = function(content) { // Perform parser in async so the function will return the emitter otherwise an error could be thrown before the emitter is ready
		var ref = {};
		var refField; // Currently appending ref field
		content = content.replace(/\r\n/g, "\n"); // Normalise any Windows CRLF newlines to LFs.
		(content + "\n").split("\n").forEach(function(line) {
			var bits = /^(....)- (.*)$/.exec(line);
			if (bits) {
				if (_fieldTranslations[bits[1]]) { // Only accept known fields
					refField = _fieldTranslations[bits[1]];
					if (refField.isArray) {
						if (!ref[refField.reflib]) {
							ref[refField.reflib] = [bits[2]];
						} else {
							ref[refField.reflib].push(bits[2]);
						}
					} else {
						ref[refField.reflib] = bits[2];
					}
				} else {
					refField = null;
				}
			} else if (refField && line.startsWith('      ')) {
				if (refField.isArray) {
					ref[refField.reflib][ref[refField.reflib].length-1] += ' ' + line.substr(6)
                                } else {
					ref[refField.reflib] += ' ' + line.substr(6);
				}
			} else if (!line && Object.keys(ref).length > 0) {
				ref.type = ref.type && _typeTranslations[ref.type] ? _typeTranslations[ref.type] : 'unknown';
				emitter.emit('ref', ref);
				ref = {};
			}
		});
		emitter.emit('end');
	};

	if (typeof content == 'string') {
		setTimeout(function() { parser(content) });
	} else if (Buffer.isBuffer(content)) {
		setTimeout(function() { parser(content.toString('utf-8')) });
	} else if (content instanceof stream.Stream) {
		var buffer = '';
		content
			.on('data', function(data) {
				buffer += data.toString('utf-8');
			})
			.on('end', function() {
				parser(buffer);
			});
	} else {
		throw new Error('Unknown item type to parse: ' + typeof content);
	}

	return emitter;
};

function _pusher(stream, isLast, child, settings) {
	var buffer = '';
	if (child.type) child.type = _typeTranslationsReverse[child.type] || settings.defaultType;

	Object.entries(child)
		.forEach(([key, data]) => {
			if (!_fieldTranslationsReverse[key]) return // Known translation? - if not skip
			var field = _fieldTranslationsReverse[key];
			if (field.isArray) {
				data.map(item =>
					buffer += field.medline + '- ' + item + '\n'
				);
			} else {
				buffer += field.medline + '- ' + data + '\n';
			}
		})

	stream.write(buffer + (isLast ? '' : '\n\n'));
};

function output(options) {
	var settings = {
		stream: null,
		defaultType: 'journalArticle', // Assume this reference type if we are not provided with one
		content: [],
		...options,
	};
	async()
		// Sanity checks {{{
		.then(function(next) {
			if (!settings.content) return next('No content has been provided');
			next();
		})
		// }}}
		// References {{{
		.then(function(next) {
			if (typeof settings.content == 'function') { // Callback
				var batchNo = 0;
				var fetcher = function() {
					settings.content(function(err, data, isLast) {
						if (err) return emitter.error(err);
						if (Array.isArray(data) && data.length > 0) { // Callback provided array
							data.forEach((d, dIndex) =>
								_pusher(settings.stream, isLast && dIndex == data.length-1, d, settings)
							);
							setTimeout(fetcher);
						} else if(!Array.isArray(data) && typeof data == 'object') { // Callback provided single ref
							_pusher(settings.stream, isLast, data, settings);
							setTimeout(fetcher);
						} else { // End of stream
							next();
						}
					}, batchNo++);
				};
				fetcher();
			} else if (Array.isArray(settings.content)) { // Array of refs
				settings.content.forEach(function(d, dIndex) {
					_pusher(settings.stream, dIndex == settings.content.length -1, d, settings);
				});
				next();
			} else if (typeof settings.content == 'object') { // Single ref
				_pusher(settings.stream, true, data, settings);
				next();
			}
		})
		// }}}
		// Stream end {{{
		.then(function(next) {
			settings.stream.end();
			next();
		})
		// }}}
		// End {{{
		.end(function(err) {
			if (err) throw new Error(err);
		});
		// }}}

	return settings.stream;
}

module.exports = {
	output: output,
	parse: parse,
};

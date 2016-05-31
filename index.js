var _ = require('lodash');
var async = require('async-chainable');
var events = require('events');

var _fieldTranslations = { // Map of MEDLINE fields to RefLib fields
	'PMID': {reflib: 'recNo'},
	'AB  ': {reflib: 'abstract'},
	'AID ': {reflib: 'doi'},
	'FAU ': {reflib: 'authors', isArray: true},
	'DP  ': {reflib: 'date'},
	'ISBN': {reflib: 'isbn'},
	'JT  ': {reflib: 'journal'},
	'LA  ': {reflib: 'language'},
	'PG  ': {reflib: 'pages'},
	'PT  ': {reflib: 'type'},
	'PL  ': {reflib: 'address'},
	'TI  ': {reflib: 'title'},
	'VI  ': {reflib: 'volume'},
	'OT  ': {reflib: 'tags', isArray: true},
};

var _fieldTranslationsReverse = _(_fieldTranslations) // Calculate the key/val lookup - this time with the key being the reflib key
	.map(function(tran, id) {
		tran.medline = id;
		return tran;
	})
	.mapKeys(function(tran) {
		return tran.reflib;
	})
	.value();

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
var _typeTranslationsReverse = _(_typeTranslations)
	.mapValues(function(trans, id) {
		return {reflib: trans, medline: id};
	})
	.mapKeys(function(trans) {
		return trans.reflib;
	})
	.mapValues(function(trans) {
		return trans.medline;
	})
	.value();

function parse(content) {
	var emitter = new events.EventEmitter();
	var library = [];

	setTimeout(function() { // Perform parser in async so the function will return the emitter otherwise an error could be thrown before the emitter is ready
		var ref = {};
		var refField; // Currently appending ref field
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
			} else if (refField && _.startsWith(line, '      ')) {
				ref[refField.reflib] += ' ' + line.substr(6);
			} else if (!line) {
				if (!_.isEmpty(ref)) {
					ref.type = ref.type && _typeTranslations[ref.type] ? _typeTranslations[ref.type] : 'unknown';
					emitter.emit('ref', ref);
				}
				ref = {};
			}
		});
		emitter.emit('end');
	});

	return emitter;
};

function _pusher(stream, isLast, child, settings) {
	var buffer = '';
	if (child.type) child.type = _typeTranslationsReverse[child.type] || settings.defaultType;

	_(child)
		.omitBy(function(data, key) {
			return !_fieldTranslationsReverse[key]; // Known translation?
		})
		.forEach(function(data, key) {
			var field = _fieldTranslationsReverse[key];
			if (field.isArray) {
				data.map(function(item) {
					buffer += field.medline + '- ' + item + '\n';
				});
			} else {
				buffer += field.medline + '- ' + data + '\n';
			}
		})

	stream.write(buffer + (isLast ? '' : '\n\n'));
};

function output(options) {
	var settings = _.defaults(options, {
		stream: null,
		defaultType: 'journalArticle', // Assume this reference type if we are not provided with one
		content: [],
	});
	async()
		// Sanity checks {{{
		.then(function(next) {
			if (!settings.content) return next('No content has been provided');
			next();
		})
		// }}}
		// References {{{
		.then(function(next) {
			if (_.isFunction(settings.content)) { // Callback
				var batchNo = 0;
				var fetcher = function() {
					settings.content(function(err, data, isLast) {
						if (err) return emitter.error(err);
						if (_.isArray(data) && data.length > 0) { // Callback provided array
							data.forEach(function(d, dIndex) {
								_pusher(settings.stream, isLast && dIndex == data.length-1, d, settings);
							});
							setTimeout(fetcher);
						} else if(!_.isArray(data) && _.isObject(data)) { // Callback provided single ref
							_pusher(settings.stream, isLast, data, settings);
							setTimeout(fetcher);
						} else { // End of stream
							next();
						}
					}, batchNo++);
				};
				fetcher();
			} else if (_.isArray(settings.content)) { // Array of refs
				settings.content.forEach(function(d, dIndex) {
					_pusher(settings.stream, dIndex == settings.content.length -1, d, settings);
				});
				next();
			} else if (_.isObject(settings.content)) { // Single ref
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
